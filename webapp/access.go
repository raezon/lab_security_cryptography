package main

// Page « Accès aux services » : URL, comptes et mots de passe du lab, lus à la
// demande (.env pour les comptes d'amorçage, Vault KV pour les personas).
// Les valeurs ne sont jamais journalisées.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

type Account struct {
	Login   string `json:"login"`
	Secret  string `json:"secret"`
	Kind    string `json:"kind"` // mot de passe | jeton | clé d'accès
	Role    string `json:"role,omitempty"`
	Source  string `json:"source"`
	Warning string `json:"warning,omitempty"`
}

type ServiceAccess struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	URL      string    `json:"url"`
	Internal string    `json:"internal"`
	Note     string    `json:"note"`
	Accounts []Account `json:"accounts"`
}

var personaRole = map[string]string{
	"alice": "Data Engineer", "bruno": "Data Analyst", "claire": "DPO", "david": "SysAdmin",
	"samira": "Data Security Engineer", "nadia": "Manager RH",
}

// secrets lus dans la toolbox : lignes « système<TAB>login<TAB>secret »
const accessScript = `
for s in pg minio vault; do
  for u in $(vault kv list -format=json kv/datacorp/users/$s 2>/dev/null | jq -r '.[]'); do
    printf 'U\t%s\t%s\t%s\n' "$s" "$u" "$(vault kv get -field=password kv/datacorp/users/$s/$u)"
  done
done
for k in svc-ingest log-shipper; do
  vault kv get -format=json kv/datacorp/minio/$k 2>/dev/null | jq -r '"S\t" + .data.data.access_key + "\t" + .data.data.secret_key'
done
printf 'R\t%s\n' "$(jq -r '.root_token // empty' /lab/work/vault-init.json 2>/dev/null)"
`

func handleAccess(w http.ResponseWriter, r *http.Request) {
	out, _, err := docker.ExecOutput(r.Context(), toolbox, labEnv(), sessionRestore+accessScript)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	users := map[string][]Account{}
	var svc []Account
	root := ""
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		switch {
		case len(f) == 4 && f[0] == "U":
			users[f[1]] = append(users[f[1]], Account{Login: f[2], Secret: f[3], Kind: "mot de passe",
				Role: personaRole[f[2]], Source: "Vault kv/datacorp/users/" + f[1] + "/" + f[2]})
		case len(f) == 3 && f[0] == "S" && f[1] != "":
			svc = append(svc, Account{Login: f[1], Secret: f[2], Kind: "clé secrète S3", Role: "compte de service",
				Source: "Vault kv/datacorp/minio/*"})
		case len(f) == 2 && f[0] == "R":
			root = f[1]
		}
	}
	env := os.Getenv
	var res []ServiceAccess

	vaultAcc := []Account{}
	if root != "" {
		vaultAcc = append(vaultAcc, Account{Login: "root (méthode Token)", Secret: root, Kind: "jeton", Role: "administrateur",
			Source: "work/vault-init.json", Warning: "à révoquer en production après l'initialisation (alerte R8 du TP3)"})
	}
	res = append(res, ServiceAccess{ID: "vault", Name: "Vault UI / API", URL: vaultPublicURL(), Internal: "https://vault:8200",
		Note:     "UI : méthode « Token » pour root, « Username » pour les personas (userpass). Clés de descellement : work/vault-init.json.",
		Accounts: append(vaultAcc, users["vault"]...)})

	res = append(res, ServiceAccess{ID: "rabbitmq", Name: "RabbitMQ Management", URL: rabbitmqPublicURL(), Internal: "amqps://rabbitmq:5671/datacorp · https://rabbitmq:15671",
		Note:     "AMQPS (5671) n'est pas publié sur l'hôte : les applications passent par la toolbox. Le pipeline n'utilise jamais ce compte : il reçoit un compte éphémère de Vault (bouton ci-dessous).",
		Accounts: []Account{{Login: env("RABBITMQ_ADMIN_USER"), Secret: env("RABBITMQ_ADMIN_PASSWORD"), Kind: "mot de passe", Role: "administrateur (vhost datacorp)", Source: ".env · Vault kv/datacorp/break-glass/rabbitmq"}}})

	res = append(res, ServiceAccess{ID: "minio", Name: "MinIO Console / S3", URL: minioPublicURL(), Internal: "API S3 : https://minio:9000",
		Note: "Les personas n'ont que les droits de leur groupe (TP2) : bruno ne voit que « curated ».",
		Accounts: append(append([]Account{{Login: env("MINIO_ROOT_USER"), Secret: env("MINIO_ROOT_PASSWORD"), Kind: "mot de passe", Role: "root", Source: ".env · Vault kv/datacorp/break-glass/minio"}},
			users["minio"]...), svc...)})

	res = append(res, ServiceAccess{ID: "postgres", Name: "PostgreSQL 16", URL: "", Internal: "postgres:5432 · base datacorp · TLS obligatoire (verify-full)",
		Note: "Volontairement non exposé sur l'hôte. Depuis la toolbox : /lab/scripts/pg-admin.sh (superutilisateur) ou as <login> \"SQL\". Le compte vault_admin a été roté par Vault : plus personne ne le connaît.",
		Accounts: append([]Account{{Login: "postgres", Secret: env("POSTGRES_PASSWORD"), Kind: "mot de passe", Role: "superutilisateur (bris de glace)", Source: ".env · Vault kv/datacorp/break-glass/postgres"}},
			users["pg"]...)})

	res = append(res, ServiceAccess{ID: "audit", Name: "audit-sink (SIEM simulé)", Internal: "http://audit-sink:8088/minio",
		Note:     "Reçoit le webhook d'audit MinIO (TP3). Jeton partagé dans l'en-tête Authorization.",
		Accounts: []Account{{Login: "Authorization", Secret: env("AUDIT_TOKEN"), Kind: "jeton", Role: "MinIO → audit-sink", Source: ".env"}}})
	writeJSON(w, res, nil)
}

// Compte éphémère délivré par Vault (le mécanisme du TP1), avec sa durée de vie.
func handleDynamic(w http.ResponseWriter, r *http.Request) {
	paths := map[string]string{"rabbitmq": "rabbitmq/creds/pipeline", "postgres": "database/creds/app-readonly"}
	p, ok := paths[r.PathValue("kind")]
	if !ok {
		writeJSON(w, nil, fmt.Errorf("type inconnu"))
		return
	}
	m, err := vault.call(r.Context(), "GET", p, nil)
	if err != nil {
		writeJSON(w, nil, fmt.Errorf("%v — le moteur est configuré à TP1 · étape 6", err))
		return
	}
	d := data(m)
	b, _ := json.Marshal(map[string]any{"path": p, "username": d["username"], "password": d["password"],
		"ttl": m["lease_duration"], "lease": m["lease_id"]})
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}
