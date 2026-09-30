package main

// TP1 · étape 1 par étudiant : chacun reçoit SON vieux script (~/legacy/ingest_legacy.sh)
// avec SON compte PostgreSQL « etl_<id> » et un mot de passe unique, écrit en clair.
// Le compte marche tant que l'étape 1 n'est pas terminée ; dès qu'elle est validée,
// le mot de passe est révoqué (il a traîné en clair : il est compromis).
//
// + Journal du terminal : chaque commande (terminal, Exécuter, Valider) est gardée
//   par étape, pour relire ses anciens terminaux une fois la partie terminée.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const legacyStep = "tp1-1"

func legacyRole(s *Student) string { return "etl_" + strings.ReplaceAll(s.ID, "-", "_") }

// ensureLegacy crée (une fois) le compte PostgreSQL personnel et la copie du script.
func ensureLegacy(ctx context.Context, s *Student, renew bool) error {
	tenantMu.Lock()
	pass, revoked := s.LegacyPass, s.LegacyRevoked
	if pass == "" || renew {
		pass = "Etl-2019-" + randHex(4)
		revoked = false
	}
	tenantMu.Unlock()
	role := legacyRole(s)
	if !revoked {
		sql := fmt.Sprintf(`DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '%[1]s') THEN CREATE ROLE %[1]s; END IF;
END $$;
ALTER ROLE %[1]s LOGIN BYPASSRLS PASSWORD '%[2]s';
GRANT CONNECT ON DATABASE datacorp TO %[1]s;
GRANT USAGE ON SCHEMA rh TO %[1]s;
GRANT SELECT ON rh.employes TO %[1]s;
COMMENT ON ROLE %[1]s IS 'TP1 étape 1 : compte legacy personnel de %[3]s (révoqué à la fin de l''étape)';`,
			role, pass, strings.ReplaceAll(s.Name(), "'", "''"))
		if _, err := pgQuery(ctx, sql); err != nil {
			return err
		}
	}
	script := `set -e
mkdir -p "$HOME/legacy"
sed -e "s|^DB_USER=.*|DB_USER=$ROLE|" -e "s|^DB_PASS=.*|DB_PASS=\"$PASS\"|" \
    -e "s|^EXPORT=.*|EXPORT=\$HOME/export_rh_\$(date +%Y%m%d).csv; rm -f \"\$EXPORT\"|" \
    /lab/scripts/legacy/ingest_legacy.sh > "$HOME/legacy/ingest_legacy.sh"
chmod 755 "$HOME/legacy/ingest_legacy.sh"`
	out, code, err := docker.ExecOutput(ctx, toolbox, []string{"HOME=" + s.Home(), "ROLE=" + role, "PASS=" + pass}, script)
	if err == nil && code != 0 {
		err = errors.New(strings.TrimSpace(out))
	}
	if err != nil {
		return err
	}
	tenantMu.Lock()
	s.LegacyPass, s.LegacyRevoked = pass, revoked
	saveStudents()
	tenantMu.Unlock()
	return nil
}

// revokeLegacy : appelé quand l'étape 1 devient validée pour cet étudiant.
func revokeLegacy(s *Student) {
	tenantMu.Lock()
	done := s.LegacyRevoked || s.LegacyPass == ""
	tenantMu.Unlock()
	if done {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pgQuery(ctx, "ALTER ROLE "+legacyRole(s)+" NOLOGIN PASSWORD NULL"); err != nil {
		return
	}
	tenantMu.Lock()
	s.LegacyRevoked = true
	saveStudents()
	tenantMu.Unlock()
	termLog(s, legacyStep, "[console] étape terminée", "Mot de passe de "+legacyRole(s)+" révoqué : il a été vu en clair, il est considéré comme compromis.\n", 0)
}

func handleLegacy(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		writeJSON(w, nil, errors.New("session inconnue"))
		return
	}
	renew := r.Method == http.MethodPost
	if renew {
		setStepStatus(s, legacyStep, "")
	}
	err := ensureLegacy(r.Context(), s, renew)
	tenantMu.Lock()
	out := map[string]any{"role": legacyRole(s), "revoked": s.LegacyRevoked, "script": "~/legacy/ingest_legacy.sh"}
	tenantMu.Unlock()
	writeJSON(w, out, err)
}

// setStepStatus("") efface la validation d'une étape (pour la refaire).
func setStepStatus(s *Student, id, status string) {
	tenantMu.Lock()
	defer tenantMu.Unlock()
	if status == "" {
		delete(s.Steps, id)
	}
	saveStudents()
}

// ------------------------------------------------------------------ journal du terminal

var logDir = env("TERMLOG_DIR", "/data/termlogs")

const termLogMax = 512 << 10

func termLog(s *Student, step, cmd, output string, code int) {
	if s == nil {
		return
	}
	if step != "coffre" && (step == "" || findStep(step) == nil) {
		step = "libre"
	}
	dir := filepath.Join(logDir, s.ID)
	os.MkdirAll(dir, 0o700)
	f := filepath.Join(dir, step+".log")
	var b bytes.Buffer
	fmt.Fprintf(&b, "\x1b[2m── %s · code %d\x1b[0m\n\x1b[1;36m$ %s\x1b[0m\n%s", time.Now().Format("02/01 15:04:05"), code, cmd, output)
	if !strings.HasSuffix(output, "\n") {
		b.WriteByte('\n')
	}
	if st, err := os.Stat(f); err == nil && st.Size() > termLogMax { // garde la seconde moitié
		if old, err := os.ReadFile(f); err == nil {
			os.WriteFile(f, old[len(old)/2:], 0o600)
		}
	}
	fh, err := os.OpenFile(f, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	fh.Write(b.Bytes())
	fh.Close()
}

// GET /api/termlog?step=tp1-1 (ou libre) — sans step : liste des journaux.
func handleTermLog(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		writeJSON(w, nil, errors.New("session inconnue"))
		return
	}
	dir := filepath.Join(logDir, s.ID)
	step := r.URL.Query().Get("step")
	if step == "" {
		ents, _ := os.ReadDir(dir)
		list := []map[string]any{}
		for _, e := range ents {
			if i, err := e.Info(); err == nil {
				list = append(list, map[string]any{"step": strings.TrimSuffix(e.Name(), ".log"), "size": i.Size(), "at": i.ModTime()})
			}
		}
		writeJSON(w, list, nil)
		return
	}
	if step != "libre" && step != "coffre" && findStep(step) == nil {
		writeJSON(w, nil, errors.New("étape inconnue"))
		return
	}
	b, _ := os.ReadFile(filepath.Join(dir, step+".log"))
	writeJSON(w, map[string]string{"step": step, "log": string(b)}, nil)
}
