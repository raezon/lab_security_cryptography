package main

// Mode étudiant (une stack par apprenant, voir scripts/etudiants.sh) et
// bouton « Voir les identifiants » : clés de Vault, jeton root et mots de passe
// d'amorçage du .env, réunis au même endroit.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

var studentMode = os.Getenv("STUDENT_MODE") == "1"

// En mode étudiant, les pistes de correction ne quittent jamais le serveur.
func publicCatalog() []TP {
	if !studentMode {
		return catalog
	}
	out := make([]TP, len(catalog))
	for i, tp := range catalog {
		tp.Answers = nil
		out[i] = tp
	}
	return out
}

func handleInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"student":      os.Getenv("STUDENT_NAME"),
		"student_mode": studentMode,
		"vault_url":    vaultPublicURL(),
		"minio_url":    minioPublicURL(),
		"rabbitmq_url": rabbitmqPublicURL(),
	}, nil)
}

type Cred struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Hint   string `json:"hint,omitempty"`
	Secret bool   `json:"secret"`
}

func handleCredentials(w http.ResponseWriter, r *http.Request) {
	out, _, _ := docker.ExecOutput(r.Context(), toolbox, nil, `cat /lab/work/vault-init.json 2>/dev/null`)
	var init struct {
		Keys      []string `json:"unseal_keys_b64"`
		Root      string   `json:"root_token"`
		Threshold int      `json:"unseal_threshold"`
	}
	json.Unmarshal([]byte(strings.TrimSpace(out)), &init)

	vault := []Cred{}
	if init.Root != "" {
		vault = append(vault, Cred{Label: "Jeton root", Value: init.Root, Secret: true,
			Hint: "Vault UI : méthode « Token ». Terminal : vault login <jeton>"})
		for i, k := range init.Keys {
			vault = append(vault, Cred{Label: "Clé d'ouverture " + strconv.Itoa(i+1), Value: k, Secret: true})
		}
	}
	e := os.Getenv
	envCreds := []Cred{
		{Label: "PostgreSQL · utilisateur", Value: "postgres"},
		{Label: "PostgreSQL · mot de passe", Value: e("POSTGRES_PASSWORD"), Secret: true, Hint: "variable $POSTGRES_PASSWORD dans le Terminal"},
		{Label: "vault_admin · mot de passe", Value: e("VAULT_DB_ADMIN_PASSWORD"), Secret: true, Hint: "$VAULT_DB_ADMIN_PASSWORD — utilisé au TP1 · étape 4, puis changé par Vault : il ne marche plus ensuite (c'est voulu)"},
		{Label: "MinIO · utilisateur", Value: e("MINIO_ROOT_USER")},
		{Label: "MinIO · mot de passe", Value: e("MINIO_ROOT_PASSWORD"), Secret: true, Hint: "$MINIO_ROOT_PASSWORD"},
		{Label: "RabbitMQ · utilisateur", Value: e("RABBITMQ_ADMIN_USER")},
		{Label: "RabbitMQ · mot de passe", Value: e("RABBITMQ_ADMIN_PASSWORD"), Secret: true, Hint: "$RABBITMQ_ADMIN_PASSWORD"},
		{Label: "AUDIT_TOKEN", Value: e("AUDIT_TOKEN"), Secret: true, Hint: "$AUDIT_TOKEN — utilisé au TP3 · étape 2"},
	}
	writeJSON(w, map[string]any{
		"vault_url":    vaultPublicURL(),
		"minio_url":    minioPublicURL(),
		"rabbitmq_url": rabbitmqPublicURL(),
		"initialized":  init.Root != "",
		"threshold":    init.Threshold,
		"vault":        vault,
		"env":          envCreds,
	}, nil)
}

func vaultPublicURL() string    { return env("VAULT_PUBLIC_URL", "https://localhost:8200") }
func minioPublicURL() string    { return env("MINIO_PUBLIC_URL", "https://localhost:9001") }
func rabbitmqPublicURL() string { return env("RABBITMQ_PUBLIC_URL", "https://localhost:15671") }

// who : nom de l'étudiant (en-tête X-Etudiant posé par la console), pour les journaux.
func who(r *http.Request) string {
	if s := me(r); s != nil {
		return s.Name()
	}
	n, err := url.QueryUnescape(r.Header.Get("X-Etudiant"))
	if err != nil {
		return "?"
	}
	n = strings.Map(func(c rune) rune {
		if c < 32 || c == 127 {
			return -1
		}
		return c
	}, strings.TrimSpace(n))
	if len([]rune(n)) > 60 {
		n = string([]rune(n)[:60])
	}
	if n == "" {
		return "anonyme"
	}
	return n
}
