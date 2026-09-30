package main

// Multi-tenant « léger » : une seule stack pour la classe, mais chaque étudiant a
// sa session (cookie dc_session), son dossier personnel dans la toolbox
// (/lab/work/etudiants/<id> : fichiers, historique, variables, jeton Vault), sa
// propre progression, ses scores et son coffre Vault de démonstration (coffre.go).
// Aucune VM ni stack en plus : quelques Mo par étudiant.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Pts struct {
	Points int       `json:"points"`
	Max    int       `json:"max"`
	Method string    `json:"method,omitempty"`
	Tries  int       `json:"tries,omitempty"`
	At     time.Time `json:"at"`
}

type Student struct {
	ID      string               `json:"id"`
	Token   string               `json:"token"`
	Prenom  string               `json:"prenom"`
	Nom     string               `json:"nom"`
	Ecole   string               `json:"ecole"`
	Created time.Time            `json:"created"`
	Seen    time.Time            `json:"seen"`
	Port    int                  `json:"port"` // coffre Vault personnel (127.0.0.1:<port> dans la toolbox)
	Steps   map[string]StepState `json:"steps"`
	Score   map[string]Pts       `json:"score"` // étapes des TP (mode expert)
	Quiz    map[string]Pts       `json:"quiz"`  // meilleur résultat par quiz de cours
	Defis   map[string]time.Time `json:"defis"`
	// TP1 · étape 1 : compte PostgreSQL legacy personnel (legacy.go)
	LegacyPass    string `json:"legacyPass,omitempty"`
	LegacyRevoked bool   `json:"legacyRevoked,omitempty"`
}

func (s *Student) Name() string { return strings.TrimSpace(s.Prenom + " " + s.Nom) }
func (s *Student) Home() string { return "/lab/work/etudiants/" + s.ID }

var (
	studentsFile = env("STUDENTS_FILE", "/data/students.json")
	tenantMu     sync.Mutex
	students     = map[string]*Student{} // par jeton de session
)

func loadStudents() {
	b, err := os.ReadFile(studentsFile)
	if err != nil {
		return
	}
	var list []*Student
	if json.Unmarshal(b, &list) == nil {
		for _, s := range list {
			students[s.Token] = s
		}
	}
}

// appelé verrou tenu
func saveStudents() {
	list := make([]*Student, 0, len(students))
	for _, s := range students {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Created.Before(list[j].Created) })
	b, _ := json.MarshalIndent(list, "", " ")
	tmp := studentsFile + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, studentsFile)
	}
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

var accents = strings.NewReplacer("à", "a", "â", "a", "ä", "a", "á", "a", "ç", "c", "é", "e", "è", "e", "ê", "e", "ë", "e",
	"î", "i", "ï", "i", "í", "i", "ô", "o", "ö", "o", "ó", "o", "ù", "u", "û", "u", "ü", "u", "ú", "u", "ÿ", "y", "ñ", "n", "œ", "oe", "æ", "ae")

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	s = accents.Replace(strings.ToLower(s))
	return strings.Trim(nonSlug.ReplaceAllString(s, "-"), "-")
}

func clean(s string, max int) string {
	s = strings.Map(func(c rune) rune {
		if c < 32 || c == 127 {
			return -1
		}
		return c
	}, strings.TrimSpace(s))
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	return s
}

// me : l'étudiant de la requête (cookie, ou en-tête X-Session), nil sinon.
func me(r *http.Request) *Student {
	tok := r.Header.Get("X-Session")
	if c, err := r.Cookie("dc_session"); err == nil && tok == "" {
		tok = c.Value
	}
	if tok == "" {
		return nil
	}
	tenantMu.Lock()
	defer tenantMu.Unlock()
	s := students[tok]
	if s != nil && time.Since(s.Seen) > time.Minute {
		s.Seen = time.Now()
	}
	return s
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, tok string) {
	http.SetCookie(w, &http.Cookie{Name: "dc_session", Value: tok, Path: "/", HttpOnly: true,
		Secure: r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteLaxMode, MaxAge: 180 * 24 * 3600})
}

func nextPort() int {
	p := 8300
	for _, s := range students {
		if s.Port >= p {
			p = s.Port + 1
		}
	}
	return p
}

// POST /api/register {prenom, nom, ecole, token?}
func handleRegister(w http.ResponseWriter, r *http.Request) {
	var in struct{ Prenom, Nom, Ecole, Token string }
	json.NewDecoder(r.Body).Decode(&in)
	in.Prenom, in.Nom, in.Ecole = clean(in.Prenom, 30), clean(in.Nom, 30), clean(in.Ecole, 60)
	if in.Prenom == "" || in.Nom == "" || in.Ecole == "" {
		writeJSON(w, nil, errors.New("prénom, nom et école sont obligatoires"))
		return
	}
	tenantMu.Lock()
	for _, o := range students { // même école écrite autrement (efrei / EFREI) : une seule orthographe
		if strings.EqualFold(strings.Join(strings.Fields(o.Ecole), " "), strings.Join(strings.Fields(in.Ecole), " ")) {
			in.Ecole = o.Ecole
			break
		}
	}
	s := students[in.Token]
	if s == nil {
		if c, err := r.Cookie("dc_session"); err == nil {
			s = students[c.Value]
		}
	}
	if s == nil {
		base := slug(in.Prenom + "-" + in.Nom)
		if base == "" {
			base = "etudiant"
		}
		s = &Student{ID: base + "-" + randHex(2), Token: randHex(24), Created: time.Now(), Port: nextPort(),
			Steps: map[string]StepState{}, Score: map[string]Pts{}, Quiz: map[string]Pts{}, Defis: map[string]time.Time{}}
		students[s.Token] = s
	}
	s.Prenom, s.Nom, s.Ecole, s.Seen = in.Prenom, in.Nom, in.Ecole, time.Now()
	saveStudents()
	out := map[string]any{"id": s.ID, "token": s.Token, "prenom": s.Prenom, "nom": s.Nom, "ecole": s.Ecole}
	tenantMu.Unlock()
	setSessionCookie(w, r, s.Token)
	writeJSON(w, out, nil)
}

// GET /api/me : profil + progression enregistrée côté serveur (reprise sur un autre poste).
func handleMe(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		w.WriteHeader(401)
		writeJSON(w, map[string]string{"error": "session inconnue"}, nil)
		return
	}
	setSessionCookie(w, r, s.Token)
	tenantMu.Lock()
	defer tenantMu.Unlock()
	writeJSON(w, map[string]any{"id": s.ID, "prenom": s.Prenom, "nom": s.Nom, "ecole": s.Ecole,
		"score": s.Score, "quiz": s.Quiz, "defis": s.Defis, "home": s.Home()}, nil)
}

// POST /api/score {kind: step|quiz|defi, id, points, max, method} — on garde le meilleur.
func handleScore(w http.ResponseWriter, r *http.Request) {
	s := me(r)
	if s == nil {
		writeJSON(w, nil, errors.New("session inconnue : rechargez la page"))
		return
	}
	var in struct {
		Kind, ID, Method string
		Points, Max      int
	}
	json.NewDecoder(r.Body).Decode(&in)
	in.ID = clean(in.ID, 40)
	if in.ID == "" || in.Points < 0 || in.Max <= 0 || in.Points > in.Max || in.Max > 100 {
		writeJSON(w, nil, errors.New("score invalide"))
		return
	}
	tenantMu.Lock()
	defer tenantMu.Unlock()
	switch in.Kind {
	case "step":
		if findStep(in.ID) == nil {
			writeJSON(w, nil, errors.New("étape inconnue"))
			return
		}
		if cur, ok := s.Score[in.ID]; !ok || in.Points > cur.Points {
			s.Score[in.ID] = Pts{Points: in.Points, Max: in.Max, Method: clean(in.Method, 20), At: time.Now()}
		}
	case "quiz":
		cur := s.Quiz[in.ID]
		cur.Tries++
		if cur.Tries == 1 || in.Points > cur.Points {
			cur.Points, cur.Max, cur.At = in.Points, in.Max, time.Now()
		}
		s.Quiz[in.ID] = cur
	case "defi":
		if _, ok := s.Defis[in.ID]; !ok {
			s.Defis[in.ID] = time.Now()
		}
	default:
		writeJSON(w, nil, errors.New("type de score inconnu"))
		return
	}
	saveStudents()
	writeJSON(w, map[string]bool{"ok": true}, nil)
}

// ------------------------------------------------------------------ progression par étudiant

func stepsOf(s *Student) map[string]StepState {
	out := map[string]StepState{}
	if s == nil {
		return out
	}
	tenantMu.Lock()
	defer tenantMu.Unlock()
	for k, v := range s.Steps {
		out[k] = v
	}
	return out
}

func setStep(s *Student, id string, st StepState) {
	if s == nil {
		return
	}
	tenantMu.Lock()
	defer tenantMu.Unlock()
	if s.Steps == nil {
		s.Steps = map[string]StepState{}
	}
	s.Steps[id] = st
	saveStudents()
	if id == legacyStep && st.Status == "ok" {
		go revokeLegacy(s)
	}
}

func resetSteps(s *Student) {
	if s == nil {
		return
	}
	tenantMu.Lock()
	defer tenantMu.Unlock()
	s.Steps = map[string]StepState{}
	saveStudents()
}

// Environnement d'exécution propre à l'étudiant dans la toolbox.
func studentEnv(s *Student) []string {
	e := labEnv()
	if s == nil {
		return append(e, "HOME=/root")
	}
	for i, v := range e {
		if strings.HasPrefix(v, "HOME=") {
			e = append(e[:i], e[i+1:]...)
			break
		}
	}
	return append(e, "HOME="+s.Home(), "LAB_STUDENT="+s.ID, "LAB_NAME="+s.Name(), "HISTFILE="+s.Home()+"/.bash_history")
}

// ------------------------------------------------------------------ tableau de bord

type Row struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Ecole   string         `json:"ecole"`
	Quiz    map[string]Pts `json:"quiz"`
	QuizPts int            `json:"quizPts"`
	TPPts   map[string]int `json:"tp"`
	TPTotal int            `json:"tpTotal"`
	Steps   int            `json:"steps"`
	Defis   int            `json:"defis"`
	Total   int            `json:"total"`
	Seen    time.Time      `json:"seen"`
	Me      bool           `json:"me,omitempty"`
}

const quizPtsPerAnswer = 5

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	s, admin := me(r), isAdmin(r)
	if s == nil && !admin {
		writeJSON(w, nil, errors.New("connectez-vous d'abord"))
		return
	}
	ecole := r.URL.Query().Get("ecole")
	if !admin {
		ecole = s.Ecole // un étudiant ne voit que le classement de son école
	}
	tenantMu.Lock()
	schools := map[string]int{}
	rows := []Row{}
	for _, st := range students {
		schools[st.Ecole]++
		if ecole != "" && !strings.EqualFold(st.Ecole, ecole) {
			continue
		}
		row := Row{ID: st.ID, Name: st.Name(), Ecole: st.Ecole, Quiz: st.Quiz, TPPts: map[string]int{}, Defis: len(st.Defis), Seen: st.Seen, Me: s != nil && st == s}
		for _, q := range st.Quiz {
			row.QuizPts += q.Points * quizPtsPerAnswer
		}
		for id, p := range st.Score {
			row.TPPts[strings.SplitN(id, "-", 2)[0]] += p.Points
			row.TPTotal += p.Points
		}
		for _, v := range st.Steps {
			if v.Status == "ok" {
				row.Steps++
			}
		}
		row.Total = row.TPTotal + row.QuizPts
		if !admin && !row.Me {
			row.ID = ""
		}
		rows = append(rows, row)
	}
	tenantMu.Unlock()
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Total != rows[j].Total {
			return rows[i].Total > rows[j].Total
		}
		return rows[i].Name < rows[j].Name
	})
	quizzes := []map[string]any{}
	for _, q := range quizCatalog {
		quizzes = append(quizzes, map[string]any{"id": q[0], "title": q[1]})
	}
	tps := []map[string]any{}
	for _, tp := range catalog {
		tps = append(tps, map[string]any{"id": tp.ID, "max": len(tp.Steps) * 10})
	}
	out := map[string]any{"admin": admin, "ecole": ecole, "rows": rows, "quizzes": quizzes, "tps": tps, "quizPtsPerAnswer": quizPtsPerAnswer}
	if admin {
		out["schools"] = schools
	}
	writeJSON(w, out, nil)
}

// Quiz des pages de cours (static/cours.js).
var quizCatalog = [][2]string{{"vault", "Vault"}, {"minio", "MinIO"}, {"rabbitmq", "RabbitMQ"}}

// ------------------------------------------------------------------ formateur (admin)

var (
	adminUser = env("CONSOLE_ADMIN_USER", "admin")
	// empreinte SHA-256 du mot de passe par défaut, remplaçable par CONSOLE_ADMIN_PASSWORD
	adminHash = func() string {
		if p := os.Getenv("CONSOLE_ADMIN_PASSWORD"); p != "" {
			h := sha256.Sum256([]byte(p))
			return hex.EncodeToString(h[:])
		}
		return "7694a7c1c9d07420f886a60d09b934e69d0917220ddf993d220b2c29ddb932da"
	}()
	adminKey = []byte(randHex(32))
)

func adminSig(exp string) string {
	m := hmac.New(sha256.New, adminKey)
	m.Write([]byte("admin|" + exp))
	return hex.EncodeToString(m.Sum(nil))
}

func isAdmin(r *http.Request) bool {
	c, err := r.Cookie("dc_admin")
	if err != nil {
		return false
	}
	exp, sig, ok := strings.Cut(c.Value, ".")
	t, err := strconv.ParseInt(exp, 10, 64)
	return ok && err == nil && time.Now().Unix() < t && hmac.Equal([]byte(sig), []byte(adminSig(exp)))
}

func handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var in struct{ User, Pass string }
	json.NewDecoder(r.Body).Decode(&in)
	h := sha256.Sum256([]byte(in.Pass))
	okUser := subtle.ConstantTimeCompare([]byte(in.User), []byte(adminUser)) == 1
	okPass := subtle.ConstantTimeCompare([]byte(hex.EncodeToString(h[:])), []byte(adminHash)) == 1
	if !okUser || !okPass {
		time.Sleep(time.Second)
		writeJSON(w, nil, errors.New("identifiant ou mot de passe incorrect"))
		return
	}
	exp := strconv.FormatInt(time.Now().Add(12*time.Hour).Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: "dc_admin", Value: exp + "." + adminSig(exp), Path: "/", HttpOnly: true,
		Secure: r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteStrictMode, MaxAge: 12 * 3600})
	writeJSON(w, map[string]bool{"ok": true}, nil)
}

func handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "dc_admin", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]bool{"ok": true}, nil)
}
