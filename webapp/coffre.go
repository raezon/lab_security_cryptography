package main

// Coffre Vault PERSONNEL de chaque étudiant, pour s'entraîner à sceller /
// desceller (seal / unseal) sans toucher au vrai coffre partagé du lab.
// C'est un vrai serveur Vault (même binaire), lancé à la demande dans la toolbox
// sur 127.0.0.1:<port de l'étudiant>, stockage fichier dans ~/coffre. Il est
// arrêté après 20 min sans activité (≈ 120 Mo de RAM chacun, seulement s'il sert).

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Fonction bash « coffre » (aussi disponible dans le terminal de l'étudiant).
const coffreFn = `coffre() {
  local C="$LAB_COFFRE" P="$LAB_COFFRE_PORT" V=/usr/local/bin/vault
  export VAULT_ADDR="http://127.0.0.1:$P"
  _coffre_up() { [ -f "$C/pid" ] && kill -0 "$(cat "$C/pid")" 2>/dev/null && { $V status >/dev/null 2>&1; [ $? -ne 1 ]; }; }
  case "${1:-status}" in
    start|demarrer)
      mkdir -p "$C/data"
      if _coffre_up; then echo "Coffre personnel déjà en marche ($VAULT_ADDR)"; return 0; fi
      cat > "$C/vault.hcl" <<EOF
storage "file" { path = "$C/data" }
listener "tcp" {
  address     = "127.0.0.1:$P"
  tls_disable = true
}
disable_mlock = true
api_addr      = "http://127.0.0.1:$P"
log_level     = "warn"
EOF
      ( setsid nohup $V server -config="$C/vault.hcl" > "$C/vault.log" 2>&1 < /dev/null & echo $! > "$C/pid" )
      for i in $(seq 1 40); do $V status >/dev/null 2>&1; [ $? -ne 1 ] && break; sleep 0.25; done
      echo "Coffre personnel démarré ($VAULT_ADDR) — il démarre toujours FERMÉ (scellé)." ;;
    stop|arreter)
      [ -f "$C/pid" ] && kill "$(cat "$C/pid")" 2>/dev/null; rm -f "$C/pid"
      for i in $(seq 1 20); do $V status >/dev/null 2>&1; [ $? -eq 1 ] && break; sleep 0.25; done
      echo "Coffre personnel arrêté." ;;
    restart|redemarrer) coffre stop >/dev/null; coffre start ;;
    reset|detruire) coffre stop >/dev/null; rm -rf "$C/data" "$C/init.json"; coffre start ;;
    status|etat) _coffre_up || { echo "Coffre personnel arrêté (tapez : coffre start)"; return 3; }; $V status ;;
    *) echo "usage : coffre start | status | restart | reset | stop" ;;
  esac
}
`

var (
	coffreMu   sync.Mutex
	coffreLast = map[string]time.Time{} // étudiant -> dernière activité
	coffreByID = map[string]*Student{}
	coffreIdle = 20 * time.Minute
	coffreMax  = 25
)

func touchCoffre(s *Student) {
	coffreMu.Lock()
	coffreLast[s.ID] = time.Now()
	coffreByID[s.ID] = s
	coffreMu.Unlock()
}

func coffreEnv(s *Student) []string {
	return []string{"HOME=" + s.Home() + "/coffre-home", "LAB_COFFRE=" + s.Home() + "/coffre", "LAB_COFFRE_PORT=" + strconv.Itoa(s.Port)}
}

func coffreExec(ctx context.Context, s *Student, script string) (string, int, error) {
	return docker.ExecOutput(ctx, toolbox, coffreEnv(s), coffreFn+"\n"+script)
}

// Arrête les coffres inutilisés ; au démarrage de la console, arrête tous les orphelins.
func coffreReaper() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	docker.ExecOutput(ctx, toolbox, nil, `pkill -f '/coffre/vault.hcl' ; true`)
	cancel()
	for range time.Tick(5 * time.Minute) {
		coffreMu.Lock()
		var idle []*Student
		for id, t := range coffreLast {
			if time.Since(t) > coffreIdle {
				idle = append(idle, coffreByID[id])
				delete(coffreLast, id)
				delete(coffreByID, id)
			}
		}
		coffreMu.Unlock()
		for _, s := range idle {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			coffreExec(ctx, s, "coffre stop")
			cancel()
			log.Printf("[%s] coffre personnel arrêté (inactif)", s.Name())
		}
	}
}

type coffreInit struct {
	Keys      []string `json:"unseal_keys_b64"`
	Root      string   `json:"root_token"`
	Shares    int      `json:"unseal_shares"`
	Threshold int      `json:"unseal_threshold"`
}

var keyRe = regexp.MustCompile(`^[A-Za-z0-9+/=]{20,100}$`)

// GET /api/coffre (état) · POST /api/coffre/{op} : start stop restart reset init unseal seal
func handleCoffre(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		writeJSON(w, nil, errors.New("session inconnue : rechargez la page"))
		return
	}
	op := r.PathValue("op")
	var in struct {
		Key       string
		Index     int
		Shares    int
		Threshold int
	}
	json.NewDecoder(r.Body).Decode(&in)
	coffreMu.Lock()
	n := len(coffreLast)
	_, mine := coffreLast[s.ID]
	coffreMu.Unlock()
	if !mine && n >= coffreMax && op != "stop" {
		writeJSON(w, nil, errors.New("trop de coffres personnels ouverts dans la classe : réessayez dans quelques minutes"))
		return
	}
	touchCoffre(s)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	script := ""
	switch op {
	case "", "start":
		script = "coffre start >/dev/null"
	case "stop":
		script = "coffre stop"
	case "restart":
		script = "coffre restart"
	case "reset":
		script = "coffre reset"
	case "init":
		sh, th := in.Shares, in.Threshold
		if sh < 1 || sh > 10 {
			sh = 5
		}
		if th < 1 || th > sh {
			th = min(3, sh)
		}
		script = "coffre start >/dev/null; $V operator init -key-shares=" + strconv.Itoa(sh) + " -key-threshold=" + strconv.Itoa(th) +
			` -format=json > "$LAB_COFFRE/init.json.tmp" && mv "$LAB_COFFRE/init.json.tmp" "$LAB_COFFRE/init.json" && chmod 600 "$LAB_COFFRE/init.json" && echo "Coffre initialisé : ` +
			strconv.Itoa(sh) + ` clés, seuil ` + strconv.Itoa(th) + `"`
	case "unseal":
		key := in.Key
		if key == "" {
			key = "$(jq -r '.unseal_keys_b64[" + strconv.Itoa(in.Index) + "] // empty' \"$LAB_COFFRE/init.json\")"
		} else if !keyRe.MatchString(key) {
			writeJSON(w, nil, errors.New("clé invalide (format base64 attendu)"))
			return
		} else {
			key = shellQuote(key)
		}
		script = `k=` + key + `; [ -n "$k" ] || { echo "clé introuvable"; exit 1; }; $V operator unseal "$k" | grep -E "Sealed|Unseal Progress"`
	case "seal":
		script = `VAULT_TOKEN=$(jq -r .root_token "$LAB_COFFRE/init.json" 2>/dev/null) $V operator seal`
	default:
		writeJSON(w, nil, errors.New("opération inconnue"))
		return
	}
	full := "V=/usr/local/bin/vault; export VAULT_ADDR=http://127.0.0.1:$LAB_COFFRE_PORT\n" + script +
		"\necho '<<<STATUS>>>'; $V status -format=json 2>/dev/null; echo '<<<INIT>>>'; cat \"$LAB_COFFRE/init.json\" 2>/dev/null; true"
	out, _, err := coffreExec(ctx, s, full)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	msg, rest, _ := strings.Cut(out, "<<<STATUS>>>")
	stJSON, initJSON, _ := strings.Cut(rest, "<<<INIT>>>")
	var status map[string]any
	json.Unmarshal([]byte(strings.TrimSpace(stJSON)), &status)
	var ini coffreInit
	json.Unmarshal([]byte(strings.TrimSpace(initJSON)), &ini)
	if op != "" {
		termLog(s, "coffre", "[coffre] "+op, msg, 0)
		log.Printf("[%s] coffre %s", s.Name(), op)
	}
	writeJSON(w, map[string]any{"msg": strings.TrimSpace(msg), "status": status, "running": status != nil,
		"keys": ini.Keys, "root": ini.Root, "addr": "http://127.0.0.1:" + strconv.Itoa(s.Port)}, nil)
}
