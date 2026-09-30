package main

// Catalogue des étapes des trois énoncés (tp/TP1…, TP2…, TP3…).
//   Doc    : les commandes telles qu'écrites dans l'énoncé (à taper dans le Terminal) ;
//   Run    : leur équivalent NON interactif, exécuté dans la toolbox par « ▶ Exécuter »
//            (les <valeurs à recopier> sont lues automatiquement) ;
//   Expect : expressions régulières qui valident le « ✅ Vérifier ».
//
// Commandes simplifiées de la toolbox (scripts/bin, dans le PATH) :
//   sql "…"            requête en administrateur (mot de passe lu dans Vault)
//   sql-as bruno "…"   requête en tant qu'une personne du lab
//   vault-cles         clés d'ouverture + jeton root de Vault
//   logs audit|echecs|minio|vault|tout    lecture des journaux (TP3)
//   effacer-preuve     tentative de suppression d'une archive WORM (TP3)

type Step struct {
	ID     string   `json:"id"`
	Num    int      `json:"num"`
	Title  string   `json:"title"`
	Role   string   `json:"role"`
	Why    string   `json:"why"`
	Doc    string   `json:"doc"`
	Verify string   `json:"verify"`
	Figure string   `json:"figure,omitempty"`
	Crypto string   `json:"crypto,omitempty"` // type de protection illustré (repos, transit, applicatif…)
	Run    []string `json:"run"`
	Expect []string `json:"expect"`
	Hints  []string `json:"hints,omitempty"` // indices progressifs (hints.go)
	Tasks  []Task   `json:"tasks,omitempty"` // mode expert pas à pas (tasks.go)
	Gui    *Gui     `json:"gui,omitempty"`   // alternative à la souris (gui.go)
}

type TP struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Subtitle  string   `json:"subtitle"`
	Tools     string   `json:"tools"`
	Context   string   `json:"context"`
	Course    []string `json:"course"`
	Figures   []string `json:"figures"`
	Steps     []Step   `json:"steps"`
	Questions []string `json:"questions"`
	GRCTitle  string   `json:"grcTitle"`
	GRC       []string `json:"grc"`
	Answers   []string `json:"answers,omitempty"`
}

// Ancienne fonction des énoncés (compatibilité) : sql-as la remplace.
const asFn = `as() { sql-as "$@"; }`

var catalog = []TP{
	{
		ID: "tp1", Title: "TP1 — Protéger les secrets et chiffrer les données",
		Subtitle: "Séance 1 sur 3 · Chiffrement & gestion des secrets",
		Tools:    "HashiCorp Vault, PostgreSQL, OpenSSL",
		Context:  "Un audit vient de découvrir que le vieux script d'ingestion contient tous les mots de passe en clair, et que les IBAN sont stockés en clair en base. Mission : tout mettre sous clé avec HashiCorp Vault.",
		Course: []string{
			"Chiffrement symétrique (AES-256) : une seule clé, très rapide. On l'utilise pour chiffrer les données.",
			"Chiffrement asymétrique (RSA, courbes elliptiques) : clé publique + clé privée. Pour échanger une clé ou prouver l'identité d'un serveur (certificat TLS).",
			"Secret statique ou dynamique : un mot de passe écrit dans un script vit pour toujours. Un mot de passe dynamique est créé à la demande, pour une seule application, et expire tout seul.",
			"Le vrai sujet, c'est la clé : chiffrer ne sert à rien si la clé est stockée à côté des données.",
		},
		Figures: []string{"fig_architecture.png", "fig_tp1_etats.png"},
		Steps: []Step{
			{
				ID: "tp1-1", Num: 1, Title: "Constater le problème", Role: "Samira (Data Security Engineer)",
				Why:    "On ne corrige bien que ce qu'on a mesuré : trouvons les mots de passe écrits en clair.",
				Crypto: "Aucune protection : secrets en clair dans un script, export IBAN en clair",
				Doc: `cat ~/legacy/ingest_legacy.sh                   # lisez le vieux script
grep -n "PASS\|SECRET\|KEY" ~/legacy/ingest_legacy.sh   # les mots de passe en clair
bash ~/legacy/ingest_legacy.sh                  # il marche encore !
head -3 ~/export_rh_*.csv                               # le fichier exporté : IBAN lisibles`,
				Verify: "Chacun a SA copie du vieux script, avec SON compte PostgreSQL (etl_…) et un mot de passe différent. Vous trouvez 3 mots de passe (PostgreSQL, MinIO, RabbitMQ) et le fichier exporté contient des IBAN en clair (FR76…). ⚠️ Ces mots de passe ont été exposés en clair : on les considère comme compromis. Par la suite, on va les changer (Vault + identifiants temporaires, puis fermeture de l’ancien compte à l’étape 7) : garder en service un ancien mot de passe qui a traîné en clair est une mauvaise pratique de sécurité. 🔒 Dès que l’étape est validée, la console révoque VOTRE mot de passe PostgreSQL : relancez le script après, il échoue.",
				Run: []string{
					`sed -n '12,24p' ~/legacy/ingest_legacy.sh`,
					`grep -n "PASS\|SECRET\|KEY" ~/legacy/ingest_legacy.sh`,
					`bash ~/legacy/ingest_legacy.sh`,
					`head -3 ~/export_rh_*.csv`,
				},
				Expect: []string{`DB_PASS="[^"]+"`, `lignes exportées`, `FR76\d{23}`},
			},
			{
				ID: "tp1-2", Num: 2, Title: "Ouvrir le coffre-fort", Role: "Samira",
				Why:    "Vault démarre fermé. À l'ouverture, il fabrique 5 clés : il en faut 3 pour l'ouvrir. Personne ne peut donc l'ouvrir seul.",
				Crypto: "Chiffrement au repos du stockage Vault (barrière AES-256-GCM), clé maître partagée par Shamir 3/5",
				Doc: `vault status                                       # Initialized false, Sealed true : coffre neuf et fermé
vault operator init -format=json > /lab/work/vault-init.json   # crée 5 clés + 1 jeton administrateur
vault-cles                                         # affiche les 5 clés et le jeton root
vault operator unseal <clé 1>                      # 1re clé…
vault operator unseal <clé 2>                      # 2e clé…
vault operator unseal <clé 3>                      # 3e clé : le coffre s'ouvre
vault login <jeton root>                           # on se connecte en administrateur
vault audit enable file file_path=/vault/logs/audit.log   # Vault note tout ce qu'on lui demande
vault status                                       # Sealed false`,
				Verify: "vault status affiche Sealed false.",
				Run: []string{
					`vault status | grep -E "Initialized|Sealed"`,
					`[ "$(vault status -format=json | jq -r .initialized)" = true ] && echo "[init] Vault déjà initialisé" || { vault operator init -format=json > /lab/work/vault-init.json && chmod 600 /lab/work/vault-init.json && echo "[init] Vault initialisé : 5 clés, seuil 3"; }`,
					`vault-cles`,
					`for i in 0 1 2; do vault operator unseal "$(jq -r ".unseal_keys_b64[$i]" /lab/work/vault-init.json)" | grep -E "^(Sealed|Unseal Progress)"; done`,
					`vault login -no-print "$(jq -r .root_token /lab/work/vault-init.json)" && echo "[login] connecté avec le jeton root"`,
					`vault audit list 2>/dev/null | grep -q '^file/' || vault audit enable file file_path=/vault/logs/audit.log; vault audit list`,
					`vault status`,
				},
				Expect: []string{`Sealed\s+false`},
			},
			{
				ID: "tp1-3", Num: 3, Title: "Ranger les mots de passe administrateur", Role: "Samira",
				Why:    "Les mots de passe « super-admin » ne doivent plus traîner dans des fichiers : on les range dans le coffre (compte « bris de glace »).",
				Crypto: "Secrets statiques chiffrés au repos dans Vault KV v2",
				Doc: `vault secrets enable -path=kv kv-v2                # ouvre un tiroir « kv » pour ranger des secrets
vault kv put kv/datacorp/break-glass/postgres username=postgres password=$POSTGRES_PASSWORD
vault kv put kv/datacorp/break-glass/minio    username=$MINIO_ROOT_USER password=$MINIO_ROOT_PASSWORD
vault kv put kv/datacorp/break-glass/rabbitmq username=$RABBITMQ_ADMIN_USER password=$RABBITMQ_ADMIN_PASSWORD
vault kv get kv/datacorp/break-glass/postgres      # on relit le secret rangé
sql "SELECT current_user"                          # « sql » lit le mot de passe dans Vault`,
				Verify: "vault kv get renvoie le secret, et sql \"SELECT current_user\" répond postgres.",
				Run: []string{
					`vault secrets list | grep -q '^kv/' || vault secrets enable -path=kv kv-v2`,
					`vault kv put kv/datacorp/break-glass/postgres username=postgres password="$POSTGRES_PASSWORD" >/dev/null && echo "[kv] postgres rangé"
vault kv put kv/datacorp/break-glass/minio username="$MINIO_ROOT_USER" password="$MINIO_ROOT_PASSWORD" >/dev/null && echo "[kv] minio rangé"
vault kv put kv/datacorp/break-glass/rabbitmq username="$RABBITMQ_ADMIN_USER" password="$RABBITMQ_ADMIN_PASSWORD" >/dev/null && echo "[kv] rabbitmq rangé"`,
					`vault kv get -format=json kv/datacorp/break-glass/postgres | jq '{path: "kv/datacorp/break-glass/postgres", version: .data.metadata.version, username: .data.data.username, password: "•••• (masqué par la console)"}'`,
					`sql "SELECT current_user"`,
				},
				Expect: []string{`"username": "postgres"`, `(?m)^\s*postgres\s*$`},
			},
			{
				ID: "tp1-4", Num: 4, Title: "Des mots de passe temporaires pour PostgreSQL", Role: "Alice (Data Engineer)",
				Why:    "Au lieu d'un mot de passe éternel, Vault crée à la demande un compte valable 1 heure, qui peut seulement ajouter des transactions.",
				Figure: "fig_tp1_secret_dynamique.png",
				Crypto: "Secret dynamique (TTL 1 h) + connexion Vault → PostgreSQL en TLS verify-full",
				Doc: `cat /lab/scripts/setup/tp1-db-dynamique.sh        # lisez : ce que le script configure dans Vault
/lab/scripts/setup/tp1-db-dynamique.sh            # Vault sait maintenant créer des comptes PostgreSQL
vault read database/creds/app-ingest              # un compte tout neuf : notez username, password, lease_id
PGPASSWORD=<password> psql -U <username> -c "SELECT count(*) FROM finance.transactions"   # refusé : il ne peut qu'écrire
vault lease revoke <lease_id>                     # on supprime le compte tout de suite
PGPASSWORD=<password> psql -U <username> -c "SELECT 1"                                   # échec : il n'existe plus`,
				Verify: "La lecture est refusée (permission denied), puis la connexion échoue après la révocation.",
				Run: []string{
					`sed -n '2,9p' /lab/scripts/setup/tp1-db-dynamique.sh`,
					`/lab/scripts/setup/tp1-db-dynamique.sh`,
					`CRED=$(vault read -format=json database/creds/app-ingest); U=$(jq -r .data.username <<<"$CRED"); P=$(jq -r .data.password <<<"$CRED"); L=$(jq -r .lease_id <<<"$CRED")
echo "username = $U"; echo "password = ${P:0:4}…"; echo "lease_id = $L"; echo "durée    = $(jq -r .lease_duration <<<"$CRED") s"`,
					`PGPASSWORD="$P" psql -U "$U" -c "SELECT count(*) FROM finance.transactions"`,
					`vault lease revoke "$L"`,
					`PGPASSWORD="$P" psql -U "$U" -c "SELECT 1"`,
				},
				Expect: []string{`permission denied for table transactions`, `password authentication failed`},
			},
			{
				ID: "tp1-5", Num: 5, Title: "Chiffrer les IBAN", Role: "Alice",
				Why:    "Si quelqu'un vole une copie de la base, il ne doit lire que du charabia. La clé reste dans Vault, la base ne garde que le texte chiffré.",
				Figure: "fig_tp1_matrice_risque.png",
				Crypto: "Chiffrement applicatif (Vault transit, AES-256-GCM96) : la colonne est chiffrée AVANT d'arriver en base",
				Doc: `vault secrets enable transit                       # le moteur qui chiffre à la demande
vault write -f transit/keys/datacorp-pii           # crée une clé AES-256 (elle ne sort jamais de Vault)
vault write transit/encrypt/datacorp-pii plaintext=$(echo -n "FR7630001007941234567890185" | base64)   # Vault veut du base64
vault write -f transit/keys/datacorp-pii/rotate    # nouvelle version de la clé (v2)
/lab/scripts/setup/tp1-chiffrer-existant.sh        # chiffre tous les IBAN déjà en base
sql "SELECT matricule, left(iban, 30) FROM rh.employes LIMIT 3"`,
				Verify: "Les IBAN commencent maintenant par vault:v2:.",
				Run: []string{
					`vault secrets list | grep -q '^transit/' || vault secrets enable transit`,
					`vault read transit/keys/datacorp-pii >/dev/null 2>&1 || vault write -f transit/keys/datacorp-pii`,
					`vault write transit/encrypt/datacorp-pii plaintext=$(echo -n "FR7630001007941234567890185" | base64)`,
					`[ "$(vault read -field=latest_version transit/keys/datacorp-pii)" -ge 2 ] && echo "[transit] clé déjà en version $(vault read -field=latest_version transit/keys/datacorp-pii)" || vault write -f transit/keys/datacorp-pii/rotate`,
					`/lab/scripts/setup/tp1-chiffrer-existant.sh`,
					`sql "SELECT matricule, left(iban, 30) FROM rh.employes LIMIT 3"`,
				},
				Expect: []string{`vault:v\d+:`, `identifiant révoqué`},
			},
			{
				ID: "tp1-6", Num: 6, Title: "Brancher tout le pipeline et vérifier le chiffrement réseau", Role: "Alice",
				Why:    "On applique la même idée à RabbitMQ et MinIO (script fourni), puis on vérifie que tout circule chiffré (TLS).",
				Crypto: "En transit : AMQPS, HTTPS, PostgreSQL TLS 1.3 · Au repos : MinIO SSE-S3 · Applicatif : transit",
				Doc: `/lab/scripts/setup/tp1-pipeline.sh                 # branche RabbitMQ + MinIO sur Vault et lance le pipeline
sql "SELECT ingere_par, count(*) FROM finance.transactions GROUP BY 1"    # qui a écrit les transactions ?
sql "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"   # notre connexion est-elle chiffrée ?
psql "host=postgres user=postgres sslmode=disable" -c "SELECT 1"          # sans chiffrement : refusé`,
				Verify: "Les transactions sont écrites par un compte v-approle-…, la connexion est en TLSv1.3, et la connexion sans chiffrement est refusée.",
				Run: []string{
					`/lab/scripts/setup/tp1-pipeline.sh`,
					`sql "SELECT ingere_par, count(*) FROM finance.transactions GROUP BY 1"`,
					`sql "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"`,
					`psql -w "host=postgres user=postgres sslmode=disable" -c "SELECT 1" </dev/null`,
				},
				Expect: []string{`v-approle-`, `TLSv1\.3`, `no encryption`},
			},
			{
				ID: "tp1-7", Num: 7, Title: "Fermer l'ancien accès", Role: "Samira",
				Why:    "Le vieux compte legacy_etl et son mot de passe connu de tous doivent disparaître.",
				Crypto: "Suppression du secret statique",
				Doc: `sql "ALTER ROLE legacy_etl NOLOGIN PASSWORD NULL"   # on ferme le vieux compte
bash /lab/scripts/legacy/ingest_legacy.sh          # le vieux script échoue maintenant
rm -f /tmp/export_rh_*.csv                         # on détruit l'export en clair`,
				Verify: "Le vieux script échoue.",
				Run: []string{
					`sql "ALTER ROLE legacy_etl NOLOGIN PASSWORD NULL"`,
					`bash /lab/scripts/legacy/ingest_legacy.sh`,
					`rm -f /tmp/export_rh_*.csv; ls /tmp/export_rh_*.csv 2>/dev/null || echo "[ok] export en clair détruit"`,
				},
				Expect: []string{`(password authentication failed|not permitted to log in)`},
			},
		},
		Questions: []string{
			"À l'étape 2, pourquoi faut-il 3 personnes pour ouvrir Vault ? Que se passe-t-il si une seule clé est volée ?",
			"À l'étape 4, le compte temporaire peut-il lire les transactions ? Pourquoi est-ce une bonne chose ?",
			"À l'étape 5, chiffrez deux fois le même IBAN : obtenez-vous le même résultat ? Que veut dire v2 dans vault:v2: ? (essayez dans l'onglet Chiffrement)",
			"À l'étape 6, qu'aurait-on risqué avec sslmode=require au lieu de verify-full ? (indice : on chiffre, mais on ne vérifie pas qui répond — testez « Mauvais nom » dans l'onglet Chiffrement)",
		},
		GRCTitle: "À vous : « une sauvegarde de la base est volée »",
		GRC: []string{
			"Identifier — Quelles données de la sauvegarde sont personnelles ? Lesquelles sont très sensibles ?",
			"Évaluer — Donnez une vraisemblance et un impact avant le TP, puis après l'étape 5. Placez les deux points sur la matrice.",
			"Traiter — Quelle mesure du TP réduit ce risque ? Quelle donnée reste pourtant en clair dans la sauvegarde ? (voir « Fichier PostgreSQL sur disque » dans l'onglet Chiffrement)",
			"Prouver — Quelle commande du TP montre à la DPO que les IBAN sont chiffrés ?",
		},
		Answers: []string{
			"Étape 1 — Secrets : legacy_etl/DataCorp2019! (tous droits sur rh et finance), minio-root (admin MinIO), rmq-admin (admin RabbitMQ). Autres défauts : export en /tmp lisible par tous, mot de passe affiché par echo.",
			"Q1 — Partage de secret de Shamir : une clé seule ne révèle rien ; il faut 3 complices. Dans le lab, les 5 clés sont dans le même fichier : c'est un raccourci à signaler.",
			"Q2 — Non : le rôle app_ingest n'a que INSERT. Moindre privilège : même volé, le compte ne permet pas de lire la base.",
			"Q3 — Non : AES-GCM utilise un nonce aléatoire, le chiffré change à chaque fois. v2 = version de la clé après rotation.",
			"Q4 — require chiffre sans vérifier le certificat : un pirate placé entre les deux (homme du milieu) pourrait se faire passer pour le serveur.",
			"§6.3 — Données personnelles : noms, e-mails, NIR, IBAN, salaires. Avant : V2 × I4 = 8 (orange). Après : IBAN chiffrés, mais NIR, noms et salaires restent en clair : V2 × I3 = 6 (jaune). Mesure complémentaire : chiffrement des sauvegardes et du disque. Preuve : SELECT left(iban,30) … montrant vault:v2:. Bonus : les anciens IBAN restent sur le disque tant qu'on n'a pas fait VACUUM FULL.",
		},
	},
	{
		ID: "tp2", Title: "TP2 — Qui a le droit de voir quoi ? (RBAC & anonymisation)",
		Subtitle: "Séance 2 sur 3 · Contrôle d'accès & gouvernance des rôles",
		Tools:    "PostgreSQL (rôles, RLS, vues), MinIO (politiques S3)",
		Context:  "L'équipe Data veut analyser la masse salariale. Claire, la DPO, refuse l'extraction complète : chacun ne doit voir que ce dont il a besoin, et les analystes ne doivent voir que des données masquées.",
		Course: []string{
			"Authentification = prouver qui je suis (TP1). Autorisation = ce que j'ai le droit de faire (ce TP).",
			"RBAC : on donne les droits à un rôle (« analyste »), puis le rôle à une personne (« Bruno »).",
			"Moindre privilège : le strict nécessaire. Séparation des tâches : celui qui prépare n'est pas celui qui valide.",
			"Pseudonymiser ≠ anonymiser : une donnée pseudonymisée reste personnelle (RGPD art. 4.5).",
		},
		Figures: []string{"fig_tp2_rbac.png"},
		Steps: []Step{
			{
				ID: "tp2-1", Num: 1, Title: "Lire la politique de la DPO", Role: "Claire (DPO)",
				Why:    "On ne crée pas de droits au hasard : on part de la classification des données faite par la DPO.",
				Crypto: "La classification décide quoi CHIFFRER, SUPPRIMER ou GÉNÉRALISER",
				Doc:    `sql "SELECT * FROM gouvernance.classification_donnees WHERE schema_name = 'rh' ORDER BY niveau DESC"`,
				Verify: "Vous savez quelles colonnes sont RESTREINT (NIR, IBAN, salaire) et ce qu'il faut en faire.",
				Run:    []string{`sql "SELECT table_name, column_name, niveau, traitement_requis FROM gouvernance.classification_donnees WHERE schema_name = 'rh' ORDER BY niveau DESC"`},
				Expect: []string{`RESTREINT`},
			},
			{
				ID: "tp2-2", Num: 2, Title: "Créer les rôles, puis les comptes", Role: "Alice",
				Why:    "D'abord les rôles (ce que l'on fait), ensuite les personnes (qui l'on est).",
				Crypto: "Mots de passe générés et rangés dans Vault, jamais affichés",
				Doc: `cat /lab/scripts/sql/tp2/01-roles.sql              # lisez : un bloc de droits (GRANT) par rôle
sql -f /lab/scripts/sql/tp2/01-roles.sql           # 1. crée les rôles
/lab/scripts/setup/tp2-comptes.sh                  # 2. crée les 6 personnes (mots de passe rangés dans Vault)
sql "\du"                                          # qui a quel rôle ?`,
				Verify: `sql "\du" montre alice membre de r_data_engineer, bruno de r_data_analyst, etc.`,
				Run: []string{
					`grep -E "^(CREATE ROLE|GRANT)" /lab/scripts/sql/tp2/01-roles.sql | head -20`,
					`if sql -Atc "SELECT 1 FROM pg_roles WHERE rolname='r_data_engineer'" | grep -q 1; then echo "[sql] rôles déjà créés"; else sql -f /lab/scripts/sql/tp2/01-roles.sql; fi`,
					`/lab/scripts/setup/tp2-comptes.sh`,
					`sql "\du alice|bruno|claire|david|samira|nadia"`,
				},
				Expect: []string{`alice.*r_data_engineer`, `bruno.*r_data_analyst`},
			},
			{
				ID: "tp2-3", Num: 3, Title: "Tester le moindre privilège", Role: "Claire",
				Why: "Une règle de sécurité ne vaut que si on a vérifié qu'elle bloque.",
				Doc: `sql-as bruno "SELECT * FROM rh.employes LIMIT 1"                        # l'analyste : refusé
sql-as alice "SELECT nir FROM rh.employes LIMIT 1"                      # colonne NIR : refusé
sql-as alice "SELECT matricule, departement FROM rh.employes LIMIT 2"   # colonnes autorisées : OK
sql-as david "SELECT count(*) FROM finance.transactions"                # l'admin système : refusé`,
				Verify: "3 refus (permission denied) et 1 succès. Notez-les dans un tableau « test / attendu / obtenu ».",
				Run: []string{
					`sql-as bruno "SELECT * FROM rh.employes LIMIT 1"`,
					`sql-as alice "SELECT nir FROM rh.employes LIMIT 1"`,
					`sql-as alice "SELECT matricule, departement FROM rh.employes LIMIT 2"`,
					`sql-as david "SELECT count(*) FROM finance.transactions"`,
				},
				Expect: []string{`permission denied for schema rh|permission denied for table employes`, `\(2 rows\)`, `permission denied for (schema finance|table transactions)`},
			},
			{
				ID: "tp2-4", Num: 4, Title: "Filtrer les lignes (Row Level Security)", Role: "Nadia (Manager RH)",
				Why: "Nadia a besoin des fiches de son département, pas de toute l'entreprise.",
				Doc: `cat /lab/scripts/sql/tp2/02-rls.sql                # lisez la règle : chacun voit son département
sql -f /lab/scripts/sql/tp2/02-rls.sql             # on l'active
sql-as nadia "SELECT departement, count(*) FROM rh.employes GROUP BY 1"`,
				Verify: "Nadia ne voit qu'une ligne : Finance | 32.",
				Run: []string{
					`grep -vE "^\s*--|^\s*$" /lab/scripts/sql/tp2/02-rls.sql | head -25`,
					`if sql -Atc "SELECT relrowsecurity FROM pg_class WHERE oid='rh.employes'::regclass" | grep -q t; then echo "[sql] RLS déjà active"; else sql -f /lab/scripts/sql/tp2/02-rls.sql; fi`,
					`sql-as nadia "SELECT departement, count(*) FROM rh.employes GROUP BY 1"`,
				},
				Expect: []string{`Finance\s*\|\s*32`, `\(1 row\)`},
			},
			{
				ID: "tp2-5", Num: 5, Title: "Masquer les données pour les analystes", Role: "Alice → Claire",
				Why:    "Bruno doit pouvoir compter, comparer, faire des moyennes… sans jamais savoir qui est qui.",
				Figure: "fig_tp2_masquage.png",
				Crypto: "Pseudonymisation par HMAC-SHA256 (clé secrète) + masquage + généralisation",
				Doc: `cat /lab/scripts/sql/tp2/03-vues-masquees.sql      # repérez : hmac, masquer_email, tranche_age
sql -f /lab/scripts/sql/tp2/03-vues-masquees.sql   # crée la vue masquée analytics.v_employes
sql-as claire "SELECT * FROM analytics.v_employes LIMIT 3"   # la DPO regarde le résultat
sql-as claire "SELECT count(*) AS personnes_uniques FROM (SELECT 1 FROM analytics.v_employes GROUP BY departement, poste, tranche_age, annee_embauche HAVING count(*) = 1) x"   # combien restent reconnaissables ?`,
				Verify: "Aucun nom, NIR ou IBAN dans la vue. Notez le nombre de « personnes uniques » (question 3).",
				Run: []string{
					`grep -nE "hmac|masquer_email|tranche_age" /lab/scripts/sql/tp2/03-vues-masquees.sql | head -12`,
					`if sql -Atc "SELECT to_regclass('analytics.v_employes')" | grep -q v_employes; then echo "[sql] vues déjà créées"; else sql -f /lab/scripts/sql/tp2/03-vues-masquees.sql; fi`,
					`sql-as claire "SELECT * FROM analytics.v_employes LIMIT 3"`,
					`sql-as claire "SELECT count(*) AS personnes_uniques FROM (SELECT 1 FROM analytics.v_employes GROUP BY departement, poste, tranche_age, annee_embauche HAVING count(*) = 1) x"`,
				},
				Expect: []string{`personnes_uniques`, `\(3 rows\)`},
			},
			{
				ID: "tp2-6", Num: 6, Title: "Faire valider par la DPO avant d'ouvrir", Role: "Alice + Claire → Bruno",
				Why:    "Séparation des tâches : Alice prépare, Claire valide, et seulement après la vue est ouverte aux analystes.",
				Figure: "fig_tp2_cycle_habilitations.png",
				Doc: `sql -f /lab/scripts/sql/tp2/04-publication.sql                            # crée la fonction publier_vue
sql-as alice  "SELECT analytics.publier_vue('analytics.v_employes')"      # refusé : pas encore validée
sql-as claire "INSERT INTO gouvernance.validations_dpo (objet, decision, commentaire) VALUES ('analytics.v_employes', 'APPROUVE', 'OK DPO')"
sql-as alice  "SELECT analytics.publier_vue('analytics.v_employes')"      # accepté
sql-as bruno  "SELECT departement, tranche_salaire, count(*) FROM analytics.v_employes GROUP BY 1,2 LIMIT 5"`,
				Verify: "La publication est refusée avant la validation, acceptée après, et Bruno lit enfin la vue.",
				Run: []string{
					`if sql -Atc "SELECT to_regproc('analytics.publier_vue')" | grep -q publier; then echo "[sql] fonction déjà créée"; else sql -f /lab/scripts/sql/tp2/04-publication.sql; fi`,
					`sql-as alice  "SELECT analytics.publier_vue('analytics.v_employes')"`,
					`sql-as claire "INSERT INTO gouvernance.validations_dpo (objet, decision, commentaire) VALUES ('analytics.v_employes', 'APPROUVE', 'OK DPO')"`,
					`sql-as alice  "SELECT analytics.publier_vue('analytics.v_employes')"`,
					`sql-as bruno  "SELECT departement, tranche_salaire, count(*) FROM analytics.v_employes GROUP BY 1,2 LIMIT 5"`,
				},
				Expect: []string{`publiée pour r_data_analyst`, `tranche_salaire`},
			},
			{
				ID: "tp2-7", Num: 7, Title: "Les mêmes règles sur le stockage objet (MinIO)", Role: "Alice / Bruno",
				Why:    "Les fichiers suivent les mêmes règles que la base : Bruno lit la zone curated (masquée), jamais raw-data (brute).",
				Crypto: "Zones raw-data et curated chiffrées au repos (SSE-S3), accès en HTTPS",
				Doc: `cat /lab/minio-policies/data-analyst.json         # une seule règle : lire « curated »
/lab/scripts/setup/tp2-minio.sh                   # crée alice et bruno dans MinIO
mc ls bruno/raw-data/                             # Bruno : refusé
mc cp /etc/hostname bruno/curated/test.txt        # Bruno ne peut pas écrire : refusé
mc ls alice/raw-data/transactions/                # Alice (Data Engineer) : OK`,
				Verify: "2 refus pour Bruno, 1 succès pour Alice.",
				Run: []string{
					`cat /lab/minio-policies/data-analyst.json`,
					`/lab/scripts/setup/tp2-minio.sh && source /root/.minio-alias`,
					`mc ls bruno/raw-data/`,
					`mc cp /etc/hostname bruno/curated/test.txt`,
					`mc ls alice/raw-data/transactions/ | head -3`,
					`mc encrypt info dc/curated; mc encrypt info dc/raw-data`,
				},
				Expect: []string{`Access Denied`, `\d{4}/`},
			},
		},
		Questions: []string{
			"Pourquoi donne-t-on les droits à r_data_analyst et pas directement à bruno ? Que faites-vous le jour où Bruno quitte l'entreprise ?",
			"À l'étape 4, Nadia voit les salariés de Finance. Peut-elle lire leur NIR ? Pourquoi ? (indice : lignes ≠ colonnes)",
			"À l'étape 5, combien de personnes sont « uniques » sur 200 ? La vue est-elle anonyme ou seulement pseudonymisée ? Proposez une colonne à retirer.",
			"À l'étape 6, qu'est-ce qui empêche Alice de valider elle-même sa vue ?",
		},
		GRCTitle: "À vous : « Bruno demande les salaires nominatifs »",
		GRC: []string{
			"Identifier — Quelles colonnes demande-t-il ? Quel est leur niveau de classification ?",
			"Évaluer — Le nom est-il vraiment nécessaire pour prédire des départs ? Que risque-t-on si son accès est détourné ?",
			"Traiter — Que lui accordez-vous à la place ? (indice : ce qui existe déjà dans analytics)",
			"Prouver — Complétez la ligne r_data_analyst de la matrice d'habilitations : qui valide, et quand revoir cet accès.",
		},
		Answers: []string{
			"Q1 — Le rôle survit aux mouvements de personnel et rend la revue lisible. Départ : ALTER ROLE bruno NOLOGIN, puis DROP ROLE bruno et suppression de ses comptes MinIO et Vault.",
			"Q2 — Non : la RLS filtre les lignes, les privilèges par colonne filtrent les colonnes, et les deux s'appliquent.",
			"Q3 — Environ 170 uniques sur 200 : la vue est pseudonymisée (réidentifiable), donc toujours soumise au RGPD. Retirer annee_embauche fait tomber à ~68 ; agrégats (k ≥ 5) encore mieux.",
			"Q4 — Alice n'a pas le droit d'écrire dans validations_dpo (réservé à r_dpo), et publier_vue exige une décision APPROUVE.",
			"§6.3 — nom (CONFIDENTIEL), salaire (RESTREINT). Le nom n'est pas nécessaire → refus. On accorde analytics.v_employes ou v_salaires_par_departement. Validation DPO (+ DRH). Revue 12 mois. RGPD art. 5.1.c et 25.",
		},
	},
	{
		ID: "tp3", Title: "TP3 — Tracer, détecter, prouver (audit & conformité)",
		Subtitle: "Séance 3 sur 3 · Journalisation, SIEM & conformité RGPD",
		Tools:    "pgAudit, journal d'audit Vault, webhook d'audit MinIO, logs, detect.py",
		Context:  "Mercredi matin, la supervision signale une nuit agitée : connexions ratées, exports volumineux, accès refusés. Samira doit comprendre ce qui s'est passé ; Claire a 72 heures pour décider s'il faut prévenir la CNIL.",
		Course: []string{
			"Un bon journal répond à 5 questions : qui ? quoi ? sur quelle donnée ? quand ? d'où ? — et donne le résultat.",
			"On ne journalise pas les données elles-mêmes : un journal plein d'IBAN devient une nouvelle base sensible.",
			"Un journal n'a de valeur que s'il est intègre : empreinte SHA-256 + stockage WORM (impossible à effacer).",
			"Même horloge pour tous : sans heure commune (UTC), impossible de reconstituer l'ordre des événements.",
		},
		Figures: []string{"fig_tp3_chaine_logs.png"},
		Steps: []Step{
			{
				ID: "tp3-1", Num: 1, Title: "Allumer l'audit PostgreSQL", Role: "Samira",
				Why: "On veut tracer les accès aux tables RESTREINT et les changements de droits, pas tout le reste (trop de bruit).",
				Doc: `cat /lab/scripts/sql/tp3/01-audit.sql              # repérez le rôle « auditeur »
sql -f /lab/scripts/sql/tp3/01-audit.sql           # active l'audit sur les tables sensibles
sql-as nadia "SELECT nom, poste FROM rh.employes LIMIT 3"   # Nadia lit 3 fiches…
logs audit                                         # …et le journal l'a noté`,
				Verify: "Une ligne « nadia  AUDIT: OBJECT,…,rh.employes,…,3 » apparaît.",
				Run: []string{
					`grep -nE "auditeur|pgaudit" /lab/scripts/sql/tp3/01-audit.sql | head -12`,
					`if sql -Atc "SELECT 1 FROM pg_roles WHERE rolname='auditeur'" | grep -q 1; then echo "[sql] audit déjà activé"; else sql -f /lab/scripts/sql/tp3/01-audit.sql; fi`,
					`sql-as nadia "SELECT nom, poste FROM rh.employes LIMIT 3"`,
					`sleep 1; N=3 logs audit`,
				},
				Expect: []string{`AUDIT: OBJECT.*rh\.employes`, `nadia\s+AUDIT`},
			},
			{
				ID: "tp3-2", Num: 2, Title: "Collecter MinIO et créer le coffre à preuves", Role: "Samira",
				Why:    "Les journaux doivent quitter la machine surveillée et être rangés là où personne ne peut les effacer.",
				Crypto: "Intégrité : SHA-256 chaîné + Object Lock WORM (GOVERNANCE 30 j)",
				Doc: `cat /lab/scripts/setup/tp3-coffre.sh               # lisez : collecte MinIO, coffre WORM, compte de dépôt
/lab/scripts/setup/tp3-coffre.sh                   # met tout en place
/lab/scripts/seal-logs.sh                          # range une 1re archive des journaux dans le coffre
effacer-preuve                                     # on essaie de l'effacer…`,
				Verify: "L'effacement est refusé (objet protégé par la rétention WORM).",
				Run: []string{
					`script -qec /lab/scripts/setup/tp3-coffre.sh /dev/null   # pseudo-TTY : « mc admin service restart » en exige un`,
					`/lab/scripts/seal-logs.sh`,
					`effacer-preuve`,
				},
				Expect: []string{`is WORM protected and cannot be overwritten`},
			},
			{
				ID: "tp3-3", Num: 3, Title: "Rejouer l'incident", Role: "Formateur (attaquant)",
				Why:    "On reproduit la « nuit agitée » pour disposer de vraies traces. Ne lisez pas le script avant d'avoir enquêté !",
				Doc:    `/lab/scripts/simulate-incidents.sh`,
				Verify: "Le script affiche 8 étapes et se termine par « Simulation terminée ».",
				Run:    []string{`/lab/scripts/simulate-incidents.sh`},
				Expect: []string{`8/8`, `Simulation terminée`},
			},
			{
				ID: "tp3-4", Num: 4, Title: "Enquêter à la main", Role: "Samira",
				Why:    "Un bon analyste sait lire les journaux avant de faire confiance à un outil automatique.",
				Figure: "fig_tp3_arbre_violation.png",
				Doc: `logs echecs      # a) mots de passe ratés, par compte (PostgreSQL)
logs audit       # b) lectures de tables sensibles (PostgreSQL, heure de Paris)
logs minio       # c) accès refusés sur le stockage (MinIO, heure UTC)
logs vault       # d) demandes refusées par le coffre (Vault, heure UTC)`,
				Verify: "Au moins 6 événements dans la chronologie, dans le bon ordre (tout converti en UTC : PostgreSQL écrit l'heure de Paris).",
				Run: []string{
					`logs echecs`,
					`logs audit`,
					`logs minio`,
					`logs vault`,
				},
				Expect: []string{`\d+ bruno`, `AUDIT: OBJECT`, `Z\s+bruno\s`},
			},
			{
				ID: "tp3-5", Num: 5, Title: "Détecter automatiquement", Role: "Samira",
				Why:    "On ne peut pas lire des millions de lignes à la main : on écrit des règles qui lèvent des alertes.",
				Doc:    `python3 /lab/scripts/detect.py`,
				Verify: "Des alertes CRITIQUE, HAUTE et MOYENNE s'affichent. Comparez-les à votre chronologie.",
				Run:    []string{`python3 /lab/scripts/detect.py`},
				Expect: []string{`CRITIQUE`, `HAUTE`},
			},
			{
				ID: "tp3-6", Num: 6, Title: "Sceller les preuves", Role: "Samira → Claire",
				Why:    "Si l'affaire va plus loin (licenciement, plainte, CNIL), il faudra prouver que les journaux n'ont pas été modifiés.",
				Crypto: "Hachage SHA-256 chaîné (mini-blockchain) + WORM",
				Doc: `/lab/scripts/seal-logs.sh                          # 2e archive, reliée à la 1re
cd /lab/work/scelles && sha256sum -c *.sha256      # chaque archive est intacte ? (OK)
cat /lab/work/scelles/chaine.txt                   # la chaîne des empreintes`,
				Verify: "Chaque archive affiche OK, et chaine.txt contient 2 lignes.",
				Run: []string{
					`/lab/scripts/seal-logs.sh`,
					`cd /lab/work/scelles && sha256sum -c *.sha256`,
					`cat /lab/work/scelles/chaine.txt`,
				},
				Expect: []string{`: OK`, `GENESIS|[0-9a-f]{64} \d{8}T`},
			},
		},
		Questions: []string{
			"Pourquoi ne journalise-t-on pas toutes les requêtes (pgaudit.log = 'all') ? Donnez deux raisons.",
			"Dans votre chronologie, pourquoi l'heure de Paris et l'heure UTC posent-elles problème ? Quelle est la solution ?",
			"À l'étape 2, le compte root de MinIO pourrait-il quand même effacer la preuve ? (GOVERNANCE ou COMPLIANCE)",
			"Parmi les alertes de detect.py, laquelle est la plus grave selon vous, et pourquoi ?",
		},
		GRCTitle: "À vous : « Alice exporte tout l'annuaire RH »",
		GRC: []string{
			"Identifier — Quelles données ont été lues ? Combien de personnes sont concernées ?",
			"Évaluer — Suivez l'arbre : est-ce une violation ? Alice avait le droit technique de lire ces colonnes : cela change-t-il la réponse ? (RGPD art. 5.1.b)",
			"Traiter — Faut-il notifier la CNIL ? Informer les 200 salariés ? Les clients dont l'IBAN (chiffré) a été lu ?",
			"Prouver — Quelles lignes de journal et quelle archive scellée joignez-vous au registre des violations ?",
		},
		Answers: []string{
			"Q1 — Volume et performance ; surtout, les requêtes contiennent des valeurs (IBAN, NIR) qui se retrouveraient dans les journaux.",
			"Q2 — Décalage de 2 h : un tri mélange les événements. Tout convertir en UTC (ou log_timezone = 'UTC') + NTP (ISO 27001 A.8.17).",
			"Q3 — Oui en GOVERNANCE (mc rm --bypass). En COMPLIANCE, personne, root compris, jusqu'à l'échéance.",
			"Q4 — R3 (lecture massive par Alice) ou R7 (tentative d'effacement des preuves). Faux positif attendu : R5 sur Alice (GRANT de publier_vue).",
			"§6.3 — 200 salariés, données d'identification professionnelle. Violation de confidentialité (finalité, art. 5.1.b). Registre (art. 33.5) ; notification CNIL à argumenter ; pas d'information des salariés. IBAN clients chiffrés, clé non compromise → exemption art. 34.3.a.",
		},
	},
}

func findStep(id string) *Step {
	for i := range catalog {
		for j := range catalog[i].Steps {
			if catalog[i].Steps[j].ID == id {
				return &catalog[i].Steps[j]
			}
		}
	}
	return nil
}
