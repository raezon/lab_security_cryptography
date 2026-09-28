package main

// DataCorp Secure — console web des TP1, TP2, TP3.
//   - liste toutes les étapes des trois énoncés et les exécute dans dc-toolbox
//     (sortie en direct, vérification automatique du critère ✅) ;
//   - démonstrations interactives : chiffrement en transit (TLS), applicatif
//     (Vault transit, enveloppe) et au repos (octets lus sur les disques).

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed static
var staticFS embed.FS

var (
	docker    *Docker
	vault     *Vault
	toolbox   = env("TOOLBOX_CONTAINER", "dc-toolbox")
	pgBox     = env("POSTGRES_CONTAINER", "dc-postgres")
	minioBox  = env("MINIO_CONTAINER", "dc-minio")
	vaultBox  = env("VAULT_CONTAINER", "dc-vault")
	stateFile = env("STATE_FILE", "/data/state.json")
	runMu     sync.Mutex // une seule étape à la fois : elles modifient l'état partagé du lab
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Secrets d'amorçage du .env, transmis aux étapes qui en ont besoin
// (remplacent les « read -rsp … (voir .env) » des énoncés).
func labEnv() []string {
	out := []string{"PAGER=cat", "PSQL_PAGER=cat", "TERM=dumb", "MC_NO_COLOR=1", "HOME=/root"}
	for _, k := range []string{"POSTGRES_PASSWORD", "VAULT_DB_ADMIN_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
		"RABBITMQ_ADMIN_USER", "RABBITMQ_ADMIN_PASSWORD", "AUDIT_TOKEN"} {
		out = append(out, k+"="+os.Getenv(k))
	}
	return out
}

// ------------------------------------------------------------------ état des étapes

type StepState struct {
	Status string    `json:"status"` // ok | ko
	Code   int       `json:"code"`
	At     time.Time `json:"at"`
	Checks []Check   `json:"checks"`
}

type Check struct {
	Pattern string `json:"pattern"`
	OK      bool   `json:"ok"`
}

var (
	stateMu sync.Mutex
	state   = map[string]StepState{}
)

func loadState() {
	if b, err := os.ReadFile(stateFile); err == nil {
		json.Unmarshal(b, &state)
	}
}

func saveState() {
	b, _ := json.MarshalIndent(state, "", " ")
	os.WriteFile(stateFile, b, 0o600)
}

// ------------------------------------------------------------------ flux NDJSON

type stream struct {
	mu  sync.Mutex
	w   http.ResponseWriter
	buf bytes.Buffer
}

func newStream(w http.ResponseWriter) *stream {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	return &stream{w: w}
}

func (s *stream) event(v any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(v)
	s.w.Write(append(b, '\n'))
	if f, ok := s.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *stream) Write(p []byte) (int, error) {
	s.buf.Write(p)
	s.event(map[string]string{"t": "out", "d": string(p)})
	return len(p), nil
}

// Restaure la session de la toolbox si le conteneur a été recréé ou Vault redémarré :
// l'état (~/.vault-token, alias mc) vit dans la couche inscriptible du conteneur.
const sessionRestore = `if [ -r /lab/work/vault-init.json ] && ! vault token lookup >/dev/null 2>&1; then
  [ "$(vault status -format=json 2>/dev/null | jq -r .sealed)" = true ] && /lab/scripts/vault-unseal.sh >/dev/null && echo "[console] Vault descellé (redémarrage détecté)"
  vault login -no-print "$(jq -r .root_token /lab/work/vault-init.json)" && echo "[console] session Vault restaurée (toolbox recréée)"
fi
if ! mc alias list dc 2>/dev/null | grep -q "AccessKey : ." && vault kv get kv/datacorp/break-glass/minio >/dev/null 2>&1; then
  mc alias set dc https://minio:9000 "$(vault kv get -field=username kv/datacorp/break-glass/minio)" "$(vault kv get -field=password kv/datacorp/break-glass/minio)" >/dev/null && echo "[console] alias mc « dc » restauré"
fi
` + asFn + `
[ -f /root/.minio-alias ] && source /root/.minio-alias
cd /lab
`

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func stepScript(st *Step) string {
	var sb strings.Builder
	sb.WriteString(sessionRestore)
	for _, c := range st.Run {
		fmt.Fprintf(&sb, "printf '\\n\\033[1;36m$ %%s\\033[0m\\n' %s\n%s\n", shellQuote(c), c)
	}
	return sb.String()
}

func handleRun(w http.ResponseWriter, r *http.Request) {
	st := findStep(r.PathValue("id"))
	if st == nil {
		http.Error(w, "étape inconnue", 404)
		return
	}
	if !runMu.TryLock() {
		http.Error(w, "une autre étape est en cours d'exécution", 409)
		return
	}
	defer runMu.Unlock()
	s := newStream(w)
	s.event(map[string]string{"t": "start", "id": st.ID})
	code, err := docker.Exec(r.Context(), toolbox, "", labEnv(), []string{"bash", "-c", stepScript(st)}, s)
	if err != nil {
		s.Write([]byte("\n[console] erreur : " + err.Error() + "\n"))
	}
	out := s.buf.String()
	res := StepState{Code: code, At: time.Now(), Status: "ok"}
	for _, p := range st.Expect {
		ok := regexp.MustCompile(p).MatchString(out)
		res.Checks = append(res.Checks, Check{Pattern: p, OK: ok})
		if !ok {
			res.Status = "ko"
		}
	}
	stateMu.Lock()
	state[st.ID] = res
	saveState()
	stateMu.Unlock()
	vaultTokenCache.reset() // l'étape a pu (ré)ouvrir une session Vault
	s.event(map[string]any{"t": "end", "code": code, "status": res.Status, "checks": res.Checks})
}

func handleExec(w http.ResponseWriter, r *http.Request) {
	var req struct{ Cmd string }
	json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.Cmd) == "" {
		http.Error(w, "commande vide", 400)
		return
	}
	s := newStream(w)
	script := sessionRestore + req.Cmd
	code, err := docker.Exec(r.Context(), toolbox, "", labEnv(), []string{"bash", "-c", script}, s)
	if err != nil {
		s.Write([]byte("\n[console] erreur : " + err.Error() + "\n"))
	}
	vaultTokenCache.reset()
	s.event(map[string]any{"t": "end", "code": code})
}

// ------------------------------------------------------------------ jeton Vault

type tokenCache struct {
	mu  sync.Mutex
	tok string
	at  time.Time
}

var vaultTokenCache tokenCache

func (c *tokenCache) reset() { c.mu.Lock(); c.tok = ""; c.mu.Unlock() }

// Le jeton de la session d'administration ouverte dans la toolbox (TP1 étape 2).
func (c *tokenCache) get(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tok != "" && time.Since(c.at) < time.Minute {
		return c.tok, nil
	}
	out, _, err := docker.ExecOutput(ctx, toolbox, nil,
		`cat /root/.vault-token 2>/dev/null || jq -r .root_token /lab/work/vault-init.json 2>/dev/null`)
	tok := strings.TrimSpace(out)
	if err != nil || tok == "" || tok == "null" {
		return "", fmt.Errorf("pas de session Vault : exécutez d'abord TP1 · étape 2 (ouvrir le coffre)")
	}
	c.tok, c.at = tok, time.Now()
	return tok, nil
}

// ------------------------------------------------------------------ handlers JSON

func writeJSON(w http.ResponseWriter, v any, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(v)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	cs, err := docker.ListProject(ctx, env("COMPOSE_PROJECT", "datacorp"))
	seal, verr := vault.call(ctx, "GET", "sys/seal-status", nil)
	if verr != nil {
		seal = map[string]any{"error": verr.Error()}
	}
	stateMu.Lock()
	st := map[string]StepState{}
	for k, v := range state {
		st[k] = v
	}
	stateMu.Unlock()
	writeJSON(w, map[string]any{"containers": cs, "vault": seal, "steps": st}, err)
}

func handleTLS(w http.ResponseWriter, r *http.Request) {
	test := r.URL.Query().Get("test")
	if test == "" {
		test = "normal"
	}
	res := make([]TLSResult, len(endpoints))
	var wg sync.WaitGroup
	for i, ep := range endpoints {
		wg.Add(1)
		go func() { defer wg.Done(); res[i] = probeTLS(ep, test) }()
	}
	wg.Wait()
	writeJSON(w, res, nil)
}

func handleTransit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	op := r.PathValue("op")
	var in struct {
		Plaintext  string `json:"plaintext"`
		Ciphertext string `json:"ciphertext"`
		Version    int    `json:"version"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	const key = "datacorp-pii"
	var out any
	var err error
	switch op {
	case "key":
		var m map[string]any
		if m, err = vault.call(ctx, "GET", "transit/keys/"+key, nil); err == nil {
			out = data(m)
		}
	case "encrypt":
		body := map[string]any{"plaintext": b64(in.Plaintext)}
		if in.Version > 0 {
			body["key_version"] = in.Version
		}
		var m map[string]any
		if m, err = vault.call(ctx, "POST", "transit/encrypt/"+key, body); err == nil {
			out = data(m)
		}
	case "decrypt":
		var m map[string]any
		if m, err = vault.call(ctx, "POST", "transit/decrypt/"+key, map[string]any{"ciphertext": in.Ciphertext}); err == nil {
			d := data(m)
			d["decoded"] = unb64(fmt.Sprint(d["plaintext"]))
			out = d
		}
	case "rewrap":
		var m map[string]any
		if m, err = vault.call(ctx, "POST", "transit/rewrap/"+key, map[string]any{"ciphertext": in.Ciphertext}); err == nil {
			out = data(m)
		}
	case "rotate":
		if _, err = vault.call(ctx, "POST", "transit/keys/"+key+"/rotate", map[string]any{}); err == nil {
			var m map[string]any
			if m, err = vault.call(ctx, "GET", "transit/keys/"+key, nil); err == nil {
				out = data(m)
			}
		}
	case "envelope":
		out, err = vault.envelope(ctx, key, in.Plaintext)
	case "hmac":
		var m map[string]any
		if m, err = vault.call(ctx, "POST", "transit/hmac/"+key+"/sha2-256", map[string]any{"input": b64(in.Plaintext)}); err == nil {
			out = data(m)
		}
	default:
		err = fmt.Errorf("opération inconnue %q", op)
	}
	if err != nil && strings.Contains(err.Error(), "403") {
		vaultTokenCache.reset()
	}
	writeJSON(w, out, err)
}

// ---- au repos : PostgreSQL

func pgQuery(ctx context.Context, sql string) (string, error) {
	var buf bytes.Buffer
	code, err := docker.Exec(ctx, pgBox, "postgres", nil, []string{"psql", "-d", "datacorp", "-qAt", "-c", sql}, &buf)
	if err == nil && code != 0 {
		err = fmt.Errorf("psql : %s", strings.TrimSpace(buf.String()))
	}
	return strings.TrimSpace(buf.String()), err
}

func handleRestPostgres(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if r.Method == http.MethodPost {
		if _, err := pgQuery(ctx, "VACUUM FULL rh.employes"); err != nil {
			writeJSON(w, nil, err)
			return
		}
	}
	if _, err := pgQuery(ctx, "CHECKPOINT"); err != nil {
		writeJSON(w, nil, err)
		return
	}
	info, err := pgQuery(ctx, `SELECT pg_relation_filepath('rh.employes') || '|' ||
		(SELECT count(*) FROM rh.employes) || '|' ||
		(SELECT count(*) FROM rh.employes WHERE iban LIKE 'vault:%') || '|' ||
		coalesce((SELECT n_dead_tup FROM pg_stat_user_tables WHERE relid = 'rh.employes'::regclass), 0)`)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	p := strings.Split(info, "|")
	path := "/var/lib/postgresql/data/" + p[0]
	b, err := docker.ReadFile(ctx, pgBox, path, 64<<20)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	writeJSON(w, map[string]any{
		"file": path, "size": len(b), "rows": p[1], "encryptedRows": p[2], "deadTuples": p[3],
		"entropy": entropy(b),
		"findings": []Finding{
			scan(b, reNIR, "NIR (n° de sécurité sociale) en clair", true),
			scan(b, reIBANClear, "IBAN en clair (FR76…)", true),
			scan(b, reVaultCT, "IBAN chiffrés par Vault (vault:vN:…)", false),
		},
	}, nil)
}

// ---- au repos : MinIO SSE-S3

func handleRestMinio(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	iban := "FR7630006000011234567890189"
	payload := fmt.Sprintf(`{"reference":"TX-DEMO-REPOS","iban_contrepartie":"%s","montant":4250.00,"beneficiaire":"Jeanne Martin"}`, iban)
	script := `set -e
mc alias set demo https://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing demo/demo-clair demo/demo-chiffre >/dev/null
mc encrypt set sse-s3 demo/demo-chiffre >/dev/null
printf '%s' ` + shellQuote(payload) + ` | mc pipe demo/demo-clair/virement.json >/dev/null
printf '%s' ` + shellQuote(payload) + ` | mc pipe demo/demo-chiffre/virement.json >/dev/null
echo "== demo-clair (pas de chiffrement au repos)"; mc encrypt info demo/demo-clair || true
mc stat demo/demo-clair/virement.json | grep -E "Name|Size|Encrypt" || true
echo; echo "== demo-chiffre (SSE-S3, clé maître MINIO_KMS_SECRET_KEY)"; mc encrypt info demo/demo-chiffre
mc stat demo/demo-chiffre/virement.json | grep -E "Name|Size|Encrypt|X-Amz-Server-Side"
echo; echo "== relecture via l'API S3 (HTTPS, déchiffrement transparent)"; mc cat demo/demo-chiffre/virement.json; echo`
	out, code, err := docker.ExecOutput(ctx, toolbox, labEnv(), script)
	if err == nil && code != 0 {
		err = fmt.Errorf("mc : %s", out)
	}
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	res := map[string]any{"payload": payload, "mc": out}
	// Les données sont dans <objet>/<uuid>/part.1 (upload en flux), ou inline dans
	// xl.meta pour les petits objets envoyés d'un bloc : on lit tout le répertoire.
	reIBAN := regexp.MustCompile(regexp.QuoteMeta(iban))
	for _, b := range []string{"demo-clair", "demo-chiffre"} {
		dir := "/data/" + b + "/virement.json"
		files, err := docker.ReadTree(ctx, minioBox, dir, 1<<20, 10)
		if err != nil {
			res[b] = map[string]any{"error": err.Error()}
			continue
		}
		name, raw := "", []byte(nil)
		for n, content := range files {
			if strings.HasSuffix(n, "part.1") || (name == "" && reIBAN.Match(content)) {
				name, raw = n, content
			}
		}
		if name == "" {
			for n, content := range files {
				if strings.HasSuffix(n, "xl.meta") {
					name, raw = n, content
				}
			}
		}
		res[b] = map[string]any{"file": "/data/" + b + "/" + strings.TrimPrefix(name, "virement.json/"), "size": len(raw),
			"finding": scan(raw, reIBAN, "IBAN du virement", true), "entropy": entropy(raw),
			"dump": hexdump(raw, 0, min(len(raw), 256))}
	}
	writeJSON(w, res, nil)
}

// ---- au repos : stockage de Vault (barrière)

func handleRestVault(w http.ResponseWriter, r *http.Request) {
	files, err := docker.ReadTree(r.Context(), vaultBox, "/vault/file", 1<<20, 500)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	secret := os.Getenv("POSTGRES_PASSWORD")
	type sample struct {
		Path    string  `json:"path"`
		Raw     string  `json:"raw"`
		Hexdump string  `json:"hexdump"`
		Entropy float64 `json:"entropy"`
	}
	var samples []sample
	var names []string
	leak := false
	for name, b := range files {
		names = append(names, name)
		if secret != "" && bytes.Contains(b, []byte(secret)) {
			leak = true
		}
		var rec struct{ Key, Value string }
		if json.Unmarshal(b, &rec) == nil && rec.Value != "" && len(samples) < 3 &&
			(strings.Contains(name, "logical") || strings.Contains(name, "_keyring")) {
			v := []byte(unb64(rec.Value))
			samples = append(samples, sample{Path: name, Raw: truncate(string(b), 220),
				Hexdump: hexdump(v, 0, min(len(v), 80)), Entropy: entropy(v)})
		}
	}
	writeJSON(w, map[string]any{"count": len(files), "names": names, "samples": samples,
		"secretFound": leak, "secretLabel": "mot de passe superutilisateur PostgreSQL (rangé en TP1 · étape 3)"}, nil)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ------------------------------------------------------------------ main

func main() {
	docker = NewDocker(env("DOCKER_SOCK", "/var/run/docker.sock"))
	vault = NewVault(vaultTokenCache.get)
	loadState()

	mux := http.NewServeMux()
	sub, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /", http.FileServerFS(sub))
	mux.Handle("GET /img/", http.StripPrefix("/img/", http.FileServer(http.Dir(env("IMAGES_DIR", "/lab/tp/images")))))

	mux.HandleFunc("GET /api/catalog", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, catalog, nil) })
	mux.HandleFunc("GET /api/status", handleStatus)
	mux.HandleFunc("POST /api/reset", func(w http.ResponseWriter, r *http.Request) {
		stateMu.Lock()
		state = map[string]StepState{}
		saveState()
		stateMu.Unlock()
		writeJSON(w, map[string]bool{"ok": true}, nil)
	})
	mux.HandleFunc("POST /api/run/{id}", handleRun)
	mux.HandleFunc("POST /api/exec", handleExec)

	mux.HandleFunc("GET /api/tls", handleTLS)
	mux.HandleFunc("GET /api/plaintext", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, plaintextTests(), nil) })
	mux.HandleFunc("GET /api/wire", func(w http.ResponseWriter, r *http.Request) {
		secret := r.URL.Query().Get("secret")
		if !regexp.MustCompile(`^[A-Za-z0-9 ]{4,40}$`).MatchString(secret) {
			secret = "FR7630001007941234567890185"
		}
		writeJSON(w, wireDemo(r.URL.Query().Get("mode"), secret), nil)
	})
	mux.HandleFunc("POST /api/transit/{op}", handleTransit)
	mux.HandleFunc("GET /api/rest/postgres", handleRestPostgres)
	mux.HandleFunc("POST /api/rest/postgres", handleRestPostgres)
	mux.HandleFunc("POST /api/rest/minio", handleRestMinio)
	mux.HandleFunc("GET /api/rest/vault", handleRestVault)
	mux.HandleFunc("GET /api/access", handleAccess)
	mux.HandleFunc("POST /api/access/dynamic/{kind}", handleDynamic)

	addr := env("LISTEN", ":8085")
	log.Printf("console DataCorp Secure sur %s (toolbox=%s)", addr, toolbox)
	srv := &http.Server{Addr: addr, Handler: logRequests(mux), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/status" {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}
		h.ServeHTTP(w, r)
	})
}
