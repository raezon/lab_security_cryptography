package main

// Avis des étudiants (note /5 + commentaires) et résumé quotidien par mail.
// Mail : SMTP gratuit (ex. Gmail + « mot de passe d'application », 500 mails/jour),
// réglé par le formateur dans le tableau de bord (enregistré dans /data/mail.json)
// ou par variables d'environnement SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Feedback struct {
	At        time.Time `json:"at"`
	StudentID string    `json:"studentId"`
	Name      string    `json:"name"`
	Ecole     string    `json:"ecole"`
	Note      int       `json:"note"`
	Sujet     string    `json:"sujet"` // tp1 | tp2 | tp3 | cours | console | general
	Aime      string    `json:"aime"`
	Ameliorer string    `json:"ameliorer"`
	Idees     string    `json:"idees"`
}

type MailConf struct {
	Host    string    `json:"host"`
	Port    int       `json:"port"`
	User    string    `json:"user"`
	Pass    string    `json:"pass,omitempty"`
	To      string    `json:"to"`
	Hour    int       `json:"hour"` // heure d'envoi (Europe/Paris)
	Project string    `json:"project"`
	Last    time.Time `json:"last"` // dernier résumé envoyé (on n'envoie que les nouveaux avis)
}

var (
	fbFile   = env("FEEDBACK_FILE", "/data/feedback.json")
	mailFile = env("MAIL_FILE", "/data/mail.json")
	fbMu     sync.Mutex
	feedback []Feedback
	mailConf = MailConf{Host: env("SMTP_HOST", "smtp.gmail.com"), Port: 587, User: os.Getenv("SMTP_USER"), Pass: os.Getenv("SMTP_PASS"),
		To: os.Getenv("MAIL_TO"), Hour: 19, Project: env("PROJECT_NAME", "DataCorp Secure Lab")}
)

func loadFeedback() {
	if b, err := os.ReadFile(fbFile); err == nil {
		json.Unmarshal(b, &feedback)
	}
	if b, err := os.ReadFile(mailFile); err == nil {
		json.Unmarshal(b, &mailConf)
	}
	if p, err := strconv.Atoi(os.Getenv("SMTP_PORT")); err == nil {
		mailConf.Port = p
	}
}

func saveJSON(path string, v any) {
	b, _ := json.MarshalIndent(v, "", " ")
	if os.WriteFile(path+".tmp", b, 0o600) == nil {
		os.Rename(path+".tmp", path)
	}
}

var sujets = map[string]string{"tp1": "TP1 · Secrets et chiffrement", "tp2": "TP2 · Droits et anonymisation", "tp3": "TP3 · Audit et preuves",
	"cours": "Les cours", "console": "La console / le terminal", "general": "Le projet en général"}

// POST /api/feedback · GET /api/feedback (les miens ; tout pour le formateur)
func handleFeedback(w http.ResponseWriter, r *http.Request) {
	s, admin := me(r), isAdmin(r)
	if r.Method == http.MethodGet {
		fbMu.Lock()
		out := []Feedback{}
		for i := len(feedback) - 1; i >= 0; i-- {
			if admin || (s != nil && feedback[i].StudentID == s.ID) {
				out = append(out, feedback[i])
			}
		}
		fbMu.Unlock()
		res := map[string]any{"items": out, "sujets": sujets, "admin": admin}
		if admin {
			c := mailConf
			c.Pass = ""
			res["mail"], res["mailReady"] = c, mailConf.User != "" && mailConf.Pass != "" && mailConf.To != ""
		}
		writeJSON(w, res, nil)
		return
	}
	if s == nil {
		writeJSON(w, nil, errors.New("session inconnue : rechargez la page"))
		return
	}
	var in Feedback
	json.NewDecoder(r.Body).Decode(&in)
	if in.Note < 1 || in.Note > 5 {
		writeJSON(w, nil, errors.New("choisissez une note de 1 à 5 étoiles"))
		return
	}
	if _, ok := sujets[in.Sujet]; !ok {
		in.Sujet = "general"
	}
	f := Feedback{At: time.Now(), StudentID: s.ID, Name: s.Name(), Ecole: s.Ecole, Note: in.Note, Sujet: in.Sujet,
		Aime: clean(in.Aime, 2000), Ameliorer: clean(in.Ameliorer, 2000), Idees: clean(in.Idees, 2000)}
	fbMu.Lock()
	feedback = append(feedback, f)
	saveJSON(fbFile, feedback)
	fbMu.Unlock()
	log.Printf("[%s] feedback %d/5 (%s)", s.Name(), f.Note, f.Sujet)
	writeJSON(w, map[string]bool{"ok": true}, nil)
}

// POST /api/admin/mail {host, port, user, pass, to, hour, project} · POST /api/admin/mail/test · GET /api/admin/digest
func handleMailConf(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		writeJSON(w, nil, errors.New("réservé au formateur"))
		return
	}
	var in MailConf
	json.NewDecoder(r.Body).Decode(&in)
	fbMu.Lock()
	if in.Host != "" {
		mailConf.Host = clean(in.Host, 100)
	}
	if in.Port > 0 {
		mailConf.Port = in.Port
	}
	mailConf.User, mailConf.To = clean(in.User, 200), clean(in.To, 300)
	if in.Pass != "" {
		mailConf.Pass = strings.ReplaceAll(in.Pass, " ", "") // mot de passe d'application Gmail : 16 lettres
	}
	if in.Hour >= 0 && in.Hour <= 23 {
		mailConf.Hour = in.Hour
	}
	if in.Project != "" {
		mailConf.Project = clean(in.Project, 80)
	}
	saveJSON(mailFile, mailConf)
	fbMu.Unlock()
	writeJSON(w, map[string]bool{"ok": true}, nil)
}

func handleMailTest(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		writeJSON(w, nil, errors.New("réservé au formateur"))
		return
	}
	subject, body, n := digest(time.Time{}) // tous les avis, pour tester
	if n == 0 {
		body = "<p>Aucun avis pour l'instant : ce mail de test confirme que l'envoi fonctionne.</p>"
	}
	err := sendMail("[test] "+subject, body)
	writeJSON(w, map[string]any{"ok": err == nil, "count": n}, err)
}

func handleDigestPreview(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "réservé au formateur", 403)
		return
	}
	_, body, _ := digest(time.Time{})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(body))
}

// digest : résumé compact des avis postérieurs à since.
func digest(since time.Time) (subject, body string, n int) {
	fbMu.Lock()
	var items []Feedback
	for _, f := range feedback {
		if f.At.After(since) {
			items = append(items, f)
		}
	}
	project := mailConf.Project
	fbMu.Unlock()
	day := time.Now().Format("02/01/2006")
	if len(items) == 0 {
		return fmt.Sprintf("Feedback %s — %s (aucun avis)", project, day), "", 0
	}
	sum := 0
	bySujet := map[string][]Feedback{}
	for _, f := range items {
		sum += f.Note
		bySujet[f.Sujet] = append(bySujet[f.Sujet], f)
	}
	avg := float64(sum) / float64(len(items))
	subject = fmt.Sprintf("Feedback %s — %s · %d avis · %.1f/5", project, day, len(items), avg)
	var b bytes.Buffer
	e := html.EscapeString
	fmt.Fprintf(&b, `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2433;max-width:720px">
<h2 style="margin:0 0 4px">Feedback · %s</h2><p style="color:#6b7385;margin:0 0 14px">%s · %d avis · moyenne <b>%.1f / 5</b> %s</p>`,
		e(project), day, len(items), avg, strings.Repeat("★", int(avg+0.5))+strings.Repeat("☆", 5-int(avg+0.5)))
	keys := make([]string, 0, len(bySujet))
	for k := range bySujet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		list := bySujet[k]
		t := 0
		for _, f := range list {
			t += f.Note
		}
		fmt.Fprintf(&b, `<h3 style="margin:18px 0 6px;border-bottom:1px solid #dfe3ea;padding-bottom:4px">%s — %.1f/5 (%d)</h3>`, e(sujets[k]), float64(t)/float64(len(list)), len(list))
		for _, f := range list {
			fmt.Fprintf(&b, `<div style="margin:0 0 10px;padding:8px 10px;background:#f4f6fa;border-radius:6px"><b>%s</b> <span style="color:#6b7385">· %s · %s</span> <span style="color:#c98a00">%s</span>`,
				e(f.Name), e(f.Ecole), f.At.Format("02/01 15:04"), strings.Repeat("★", f.Note)+strings.Repeat("☆", 5-f.Note))
			for _, p := range [][2]string{{"👍 Apprécié", f.Aime}, {"🔧 À améliorer", f.Ameliorer}, {"💡 Idées", f.Idees}} {
				if p[1] != "" {
					fmt.Fprintf(&b, `<div style="margin-top:4px"><b>%s :</b> %s</div>`, p[0], e(p[1]))
				}
			}
			b.WriteString(`</div>`)
		}
	}
	b.WriteString(`<p style="color:#6b7385;font-size:12px;margin-top:18px">Envoyé automatiquement par la console du lab.</p></div>`)
	return subject, b.String(), len(items)
}

func sendMail(subject, htmlBody string) error {
	fbMu.Lock()
	c := mailConf
	fbMu.Unlock()
	if c.User == "" || c.Pass == "" || c.To == "" {
		return errors.New("mail non configuré (compte SMTP, mot de passe d'application, destinataire)")
	}
	to := strings.Split(c.To, ",")
	for i := range to {
		to[i] = strings.TrimSpace(to[i])
	}
	var m bytes.Buffer
	fmt.Fprintf(&m, "From: %s <%s>\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nDate: %s\r\n\r\n%s",
		c.Project, c.User, strings.Join(to, ", "), b64(subject), time.Now().Format(time.RFC1123Z), htmlBody)
	auth := smtp.PlainAuth("", c.User, c.Pass, c.Host)
	return smtp.SendMail(c.Host+":"+strconv.Itoa(c.Port), auth, c.User, to, m.Bytes())
}

// Boucle quotidienne : à l'heure choisie, envoie les avis reçus depuis le dernier résumé.
func digestLoop() {
	loc, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		loc = time.Local
	}
	for range time.Tick(time.Minute) {
		now := time.Now().In(loc)
		fbMu.Lock()
		c := mailConf
		fbMu.Unlock()
		if now.Hour() != c.Hour || now.Sub(c.Last) < 20*time.Hour {
			continue
		}
		subject, body, n := digest(c.Last)
		if n > 0 {
			if err := sendMail(subject, body); err != nil {
				log.Printf("résumé des feedbacks : %v (nouvel essai dans 10 min)", err)
				time.Sleep(9 * time.Minute)
				continue
			}
			log.Printf("résumé des feedbacks envoyé (%d avis)", n)
		}
		fbMu.Lock()
		mailConf.Last = now
		saveJSON(mailFile, mailConf)
		fbMu.Unlock()
	}
}
