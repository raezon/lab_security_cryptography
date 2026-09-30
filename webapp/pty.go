package main

// Vrai terminal interactif : xterm.js ⇄ WebSocket ⇄ `docker exec -it` (TTY) dans la
// toolbox. Chaque étudiant a son shell, dans son dossier personnel : ls, cd, vim,
// psql interactif, complétion, historique, variables… tout est permis.
//
// Vérification des TP sans imposer LA commande : le shell émet deux marqueurs
// invisibles (séquences OSC 697) — PS0 avant l'exécution d'une commande et
// PROMPT_COMMAND après (code retour + commande tapée). La console capture la
// sortie entre les deux et la compare au résultat attendu de l'étape en cours.
// N'importe quelle commande qui produit le bon résultat est acceptée.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ------------------------------------------------------------------ docker exec -it

func (d *Docker) ExecTTY(ctx context.Context, container string, env, cmd []string) (string, net.Conn, io.Reader, error) {
	resp, err := d.do(ctx, "POST", "/containers/"+container+"/exec", map[string]any{
		"AttachStdin": true, "AttachStdout": true, "AttachStderr": true, "Tty": true,
		"Cmd": cmd, "Env": env, "WorkingDir": "/lab",
	})
	if err != nil {
		return "", nil, nil, err
	}
	var created struct{ Id string }
	json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	conn, err := net.Dial("unix", d.sock)
	if err != nil {
		return "", nil, nil, err
	}
	body := `{"Detach":false,"Tty":true}`
	fmt.Fprintf(conn, "POST /v1.41/exec/%s/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\n"+
		"Connection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: %d\r\n\r\n%s", created.Id, len(body), body)
	br := bufio.NewReader(conn)
	r, err := http.ReadResponse(br, nil)
	if err != nil {
		conn.Close()
		return "", nil, nil, err
	}
	if r.StatusCode != http.StatusSwitchingProtocols && r.StatusCode != http.StatusOK {
		conn.Close()
		return "", nil, nil, fmt.Errorf("docker exec start : %s", r.Status)
	}
	return created.Id, conn, br, nil
}

func (d *Docker) ResizeExec(ctx context.Context, id string, cols, rows int) {
	if r, err := d.do(ctx, "POST", fmt.Sprintf("/exec/%s/resize?h=%d&w=%d", id, rows, cols), nil); err == nil {
		r.Body.Close()
	}
}

// ------------------------------------------------------------------ shell de l'étudiant

// Initialisation du shell (écrite dans ~/.labrc) : session Vault/MinIO du lab,
// liens vers /lab, invite colorée et marqueurs de vérification.
func labRC(kind string) string {
	var sb strings.Builder
	sb.WriteString(`[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion
export PATH=/lab/scripts/bin:$PATH PAGER=less LESS=-R PSQL_PAGER=less
HISTSIZE=5000; HISTFILESIZE=10000; shopt -s histappend checkwinsize
alias ls='ls --color=auto' ll='ls -alF --color=auto' la='ls -A --color=auto' grep='grep --color=auto'
`)
	sb.WriteString(coffreFn)
	if kind == "coffre" {
		sb.WriteString(`export VAULT_ADDR="http://127.0.0.1:$LAB_COFFRE_PORT"; unset VAULT_TOKEN VAULT_CACERT
cd "$HOME"
coffre start
printf '\n\e[1;33m 🔐 Votre coffre Vault personnel\e[0m — personne d'autre ne le voit, le vrai coffre du lab n'est pas touché.\n'
printf '    VAULT_ADDR=%s\n' "$VAULT_ADDR"
printf '    Essayez : \e[1mvault status\e[0m · \e[1mvault operator init -key-shares=5 -key-threshold=3\e[0m · \e[1mvault operator unseal\e[0m · \e[1mvault operator seal\e[0m\n'
printf '    Et : \e[1mcoffre restart\e[0m (panne/redémarrage → il se referme) · \e[1mcoffre reset\e[0m (tout effacer)\n\n'
PS1='\[\e[38;5;114m\]${LAB_PRENOM}\[\e[0m\]@\[\e[38;5;215m\]coffre-perso\[\e[0m\]:\[\e[38;5;222m\]\w\[\e[0m\]\$ '
`)
	} else {
		sb.WriteString(strings.Replace(sessionRestore, "cd /lab\n", "", 1))
		sb.WriteString(`for d in scripts work pipeline vault-policies minio-policies; do [ -e "$HOME/$d" ] || ln -s "/lab/$d" "$HOME/$d"; done
cd "$HOME"
aide() { cat <<'EOF'
Commandes du lab (en plus de toutes les commandes Linux) :
  vault …              coffre-fort du lab (partagé)       vault-cles     clés + jeton root
  sql "SELECT …"       requête PostgreSQL (admin)         sql-as bruno "…"  en tant qu'un personnage
  mc ls dc             stockage MinIO                     logs audit|echecs|minio|vault|tout
  psql                 client PostgreSQL interactif       python3 /lab/pipeline/producer.py 10
  coffre start|status|restart|reset   votre coffre Vault PERSONNEL (onglet « Mon coffre »)
Votre dossier : ~ (liens vers scripts, work, pipeline). Tout ce que vous créez ici n'est qu'à vous.
EOF
}
printf '\e[1;36m DataCorp Secure\e[0m · poste de travail de \e[1m%s\e[0m\n' "$LAB_NAME"
printf ' Dossier perso : \e[38;5;222m%s\e[0m — vos fichiers, votre historique, vos variables.\n' "$HOME"
printf ' Tapez \e[1maide\e[0m pour les commandes du lab, \e[1mclear\e[0m pour effacer. Toutes les commandes sont permises.\n\n'
PS1='\[\e[38;5;114m\]${LAB_PRENOM}\[\e[0m\]@\[\e[38;5;75m\]toolbox\[\e[0m\]:\[\e[38;5;222m\]\w\[\e[0m\]\$ '
`)
	}
	sb.WriteString(`PS0=$'\e]697;RUN\a'
PROMPT_COMMAND='__rc=$?; history -a; printf "\e]697;END;%s;%s\a" "$__rc" "$(HISTTIMEFORMAT= history 1 | base64 -w0)"'
`)
	return sb.String()
}

func interactiveEnv(s *Student, kind string) []string {
	var e []string
	for _, v := range studentEnv(s) {
		if strings.HasPrefix(v, "TERM=") || strings.HasPrefix(v, "PAGER=") || strings.HasPrefix(v, "PSQL_PAGER=") ||
			strings.HasPrefix(v, "MC_NO_COLOR=") || strings.HasPrefix(v, "HOME=") {
			continue
		}
		e = append(e, v)
	}
	home := s.Home()
	if kind == "coffre" {
		home += "/coffre-home" // jeton Vault séparé : ne remplace pas la session du vrai coffre
	}
	return append(e, "TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8", "HOME="+home,
		"LAB_PRENOM="+strings.ReplaceAll(slug(s.Prenom), "-", ""), "LAB_RC="+labRC(kind))
}

// ------------------------------------------------------------------ session WebSocket

var (
	termMu     sync.Mutex
	termCount  = map[string]int{}
	termTotal  int
	maxPerUser = 4
	maxTerms   = 80
	termIdle   = 45 * time.Minute
)

var (
	oscStart = []byte("\x1b]697;")
	ansiRe   = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\r`)
)

type termSess struct {
	s       *Student
	ws      *WSConn
	carry   []byte
	running bool
	capture bytes.Buffer
	mu      sync.Mutex
	step    string
	task    int
}

func handleTerm(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		http.Error(w, "session inconnue : rechargez la page", 401)
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind != "coffre" {
		kind = "toolbox"
	}
	termMu.Lock()
	if termCount[s.ID] >= maxPerUser || termTotal >= maxTerms {
		termMu.Unlock()
		http.Error(w, "trop de terminaux ouverts : fermez un onglet", 429)
		return
	}
	termCount[s.ID]++
	termTotal++
	termMu.Unlock()
	defer func() { termMu.Lock(); termCount[s.ID]--; termTotal--; termMu.Unlock() }()

	ws, err := wsUpgrade(w, r)
	if err != nil {
		log.Printf("terminal : %v", err)
		return
	}
	defer ws.Close()

	tid := randHex(4)
	pidFile := `"$HOME/.term-` + tid + `.pid"`
	env := interactiveEnv(s, kind)
	env = append(env, "LAB_COFFRE="+s.Home()+"/coffre", "LAB_COFFRE_PORT="+strconv.Itoa(s.Port))
	cmd := []string{"bash", "-c", `mkdir -p "$HOME" && printf '%s\n' "$LAB_RC" > "$HOME/.labrc" && echo $$ > ` + pidFile +
		` && unset LAB_RC && exec bash --rcfile "$HOME/.labrc" -i`}
	id, conn, out, err := docker.ExecTTY(context.Background(), toolbox, env, cmd)
	if err != nil {
		ws.Text([]byte(`{"t":"error","msg":` + strconv.Quote("terminal indisponible : "+err.Error()) + `}`))
		return
	}
	log.Printf("[%s] terminal %s ouvert (%s)", s.Name(), kind, tid)
	if c, _ := strconv.Atoi(r.URL.Query().Get("cols")); c > 0 {
		rows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
		docker.ResizeExec(context.Background(), id, c, max(rows, 5))
	}
	if kind == "coffre" {
		touchCoffre(s)
	} else {
		go func() {
			tenantMu.Lock()
			need := !s.LegacyRevoked && s.Steps[legacyStep].Status != "ok"
			tenantMu.Unlock()
			if need {
				ensureLegacy(context.Background(), s, false)
			}
		}()
	}
	ts := &termSess{s: s, ws: ws, step: r.URL.Query().Get("step"), task: -1}
	if t, err := strconv.Atoi(r.URL.Query().Get("task")); err == nil {
		ts.task = t
	}

	idle := time.AfterFunc(termIdle, func() {
		ws.Text([]byte(`{"t":"error","msg":"terminal fermé après 45 min d'inactivité (ressources partagées) : rouvrez-le"}`))
		conn.Close()
		ws.c.Close()
	})
	defer idle.Stop()

	done := make(chan struct{})
	go func() { // toolbox -> navigateur
		defer close(done)
		buf := make([]byte, 32<<10)
		for {
			n, err := out.Read(buf)
			if n > 0 {
				if clean := ts.feed(buf[:n]); len(clean) > 0 && ws.Binary(clean) != nil {
					return
				}
			}
			if err != nil {
				ws.Text([]byte(`{"t":"exit"}`))
				ws.c.Close()
				return
			}
		}
	}()

	for { // navigateur -> toolbox
		op, msg, err := ws.Read()
		if err != nil {
			break
		}
		if op == opBinary {
			conn.Write(msg)
			continue
		}
		var m struct {
			T          string
			D          string
			Cols, Rows int
			Step       string
			Task       int
		}
		if json.Unmarshal(msg, &m) != nil {
			continue
		}
		switch m.T {
		case "i":
			idle.Reset(termIdle)
			if kind == "coffre" {
				touchCoffre(s)
			}
			conn.Write([]byte(m.D))
		case "resize":
			if m.Cols > 0 && m.Rows > 0 && m.Cols < 1000 && m.Rows < 500 {
				docker.ResizeExec(context.Background(), id, m.Cols, m.Rows)
			}
		case "target":
			ts.mu.Lock()
			ts.step, ts.task = m.Step, m.Task
			ts.mu.Unlock()
		}
	}
	conn.Close()
	<-done
	// ferme le shell et tout ce qu'il a lancé (vim, psql…) : rien ne reste en mémoire
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	docker.ExecOutput(ctx, toolbox, []string{"HOME=" + envValue(env, "HOME")},
		`f=`+pidFile+`; p=$(cat "$f" 2>/dev/null) && { pkill -HUP -s "$p"; kill -HUP "$p"; } 2>/dev/null; rm -f "$f"`)
	cancel()
	log.Printf("[%s] terminal %s fermé (%s)", s.Name(), kind, tid)
}

func envValue(env []string, k string) string {
	for _, v := range env {
		if strings.HasPrefix(v, k+"=") {
			return v[len(k)+1:]
		}
	}
	return ""
}

// feed retire les marqueurs du flux (renvoie ce qu'on affiche) et capture la
// sortie de la commande en cours.
func (ts *termSess) feed(p []byte) []byte {
	data := append(ts.carry, p...)
	ts.carry = nil
	var out []byte
	for {
		i := bytes.Index(data, oscStart)
		if i < 0 {
			k := partialSuffix(data, oscStart)
			out = append(out, data[:len(data)-k]...)
			ts.keep(data[:len(data)-k])
			if k > 0 {
				ts.carry = append([]byte(nil), data[len(data)-k:]...)
			}
			return out
		}
		out = append(out, data[:i]...)
		ts.keep(data[:i])
		j := bytes.IndexByte(data[i:], 0x07)
		if j < 0 {
			if len(data)-i < 8192 {
				ts.carry = append([]byte(nil), data[i:]...)
			}
			return out
		}
		ts.marker(string(data[i+len(oscStart) : i+j]))
		data = data[i+j+1:]
	}
}

func partialSuffix(data, pat []byte) int {
	for k := min(len(pat)-1, len(data)); k > 0; k-- {
		if bytes.HasSuffix(data, pat[:k]) {
			return k
		}
	}
	return 0
}

func (ts *termSess) keep(b []byte) {
	if !ts.running || len(b) == 0 {
		return
	}
	ts.capture.Write(b)
	if ts.capture.Len() > 512<<10 { // garde la fin
		tail := append([]byte(nil), ts.capture.Bytes()[ts.capture.Len()-256<<10:]...)
		ts.capture.Reset()
		ts.capture.Write(tail)
	}
}

var histNum = regexp.MustCompile(`^\s*\d+\*?\s+`)

func (ts *termSess) marker(m string) {
	if m == "RUN" {
		ts.running = true
		ts.capture.Reset()
		return
	}
	if !strings.HasPrefix(m, "END;") || !ts.running {
		return
	}
	ts.running = false
	parts := strings.SplitN(m[4:], ";", 2)
	code, _ := strconv.Atoi(parts[0])
	cmd := ""
	if len(parts) == 2 {
		if b, err := base64.StdEncoding.DecodeString(parts[1]); err == nil {
			cmd = strings.TrimSpace(histNum.ReplaceAllString(string(b), ""))
		}
	}
	output := ansiRe.ReplaceAllString(ts.capture.String(), "")
	ts.capture.Reset()
	vaultTokenCache.reset()
	if cmd == "" {
		return
	}
	log.Printf("[%s] $ %s (code %d)", ts.s.Name(), truncate(strings.ReplaceAll(cmd, "\n", " ; "), 300), code)
	go ts.evaluate(cmd, output, code)
}

// evaluate : la commande (quelle qu'elle soit) atteint-elle l'objectif en cours ?
func (ts *termSess) evaluate(cmd, output string, code int) {
	ts.mu.Lock()
	stepID, n := ts.step, ts.task
	ts.mu.Unlock()
	st := findStep(stepID)
	termLog(ts.s, stepID, cmd, output, code)
	ev := map[string]any{"t": "cmd", "cmd": cmd, "code": code}
	if st == nil {
		b, _ := json.Marshal(ev)
		ts.ws.Text(b)
		return
	}
	ev["step"], ev["task"] = st.ID, n
	ok, last := false, false
	if len(st.Tasks) > 0 && n >= 0 && n < len(st.Tasks) {
		t := st.Tasks[n]
		ok = taskOK(t, cmd, output, code)
		last = n == len(st.Tasks)-1
		if ok {
			ts.mu.Lock()
			if ts.step == stepID && ts.task == n {
				ts.task++ // passe à la sous-commande suivante sans attendre le navigateur
			}
			ts.mu.Unlock()
		}
	} else if len(st.Tasks) == 0 {
		ok, last = len(st.Expect) > 0, true
		for _, p := range st.Expect {
			if !regexp.MustCompile(p).MatchString(output) {
				ok = false
			}
		}
	}
	ev["ok"], ev["last"] = ok, last
	if ok && last {
		setStep(ts.s, st.ID, StepState{By: ts.s.Name() + " (terminal)", Code: code, At: time.Now(), Status: "ok",
			Checks: []Check{{Pattern: "objectif atteint dans le terminal", OK: true}}})
	}
	b, _ := json.Marshal(ev)
	ts.ws.Text(b)
}

// Règle commune (terminal et ancien « Valider ») : le résultat attendu dans la
// sortie suffit, quelle que soit la commande employée (plusieurs chemins possibles).
// Si la tâche ne se juge qu'au code retour, la commande doit viser le bon outil.
func taskOK(t Task, cmd, output string, code int) bool {
	if t.Expect != "" && regexp.MustCompile(t.Expect).MatchString(output) {
		return true
	}
	if (t.OkCode || t.Expect == "") && code == 0 {
		return t.Must == "" || regexp.MustCompile(t.Must).MatchString(cmd)
	}
	return false
}
