package main

// Alternative « à la souris » : les étapes (ou morceaux d'étape) faisables
// dans les interfaces web Vault UI, MinIO Console ou RabbitMQ Management.
// En mode expert, le bouton « Fait dans l'interface » saute les commandes
// From..Skip-1 (comptées à 50 %) ; la console vérifie ensuite avec la
// commande Skip, tapée dans le terminal. Skip = 0 : guide seul, pas de saut.

type Gui struct {
	Tool  string   `json:"tool"` // vault | minio | rabbitmq
	From  int      `json:"from"`
	Skip  int      `json:"skip"`
	Steps []string `json:"steps"`
}

var guis = map[string]Gui{
	"tp1-2": {Tool: "vault", From: 0, Skip: 7, Steps: []string{
		"⚠️ Si la page propose « Initialize », n'initialisez PAS depuis l'interface : les clés ne seraient pas enregistrées pour le lab. Faites la commande 2 dans le terminal, puis revenez.",
		"Si Vault est scellé, la page « Unseal Vault » s'affiche : collez une clé d'ouverture (terminal : vault-cles), cliquez Unseal. Recommencez avec 2 autres clés : le compteur passe à 3/3.",
		"Page de connexion : Method = Token, collez le jeton root (vault-cles), puis Sign in.",
		"Le journal d'audit ne se règle pas dans l'interface : la commande 8 se fait dans le terminal.",
	}},
	"tp1-3": {Tool: "vault", From: 0, Skip: 4, Steps: []string{
		"Connectez-vous : Method = Token, jeton root.",
		"Menu Secrets Engines → « Enable new engine + » → KV → Path : kv → Enable Engine.",
		"Dans kv/ : « Create secret + » → Path for this secret : datacorp/break-glass/postgres → Secret data : username = postgres, password = le mot de passe PostgreSQL (bouton 🔑 Identifiants) → Save.",
		"Même chose pour datacorp/break-glass/minio et datacorp/break-glass/rabbitmq (comptes admin MinIO et RabbitMQ, bouton 🔑 Identifiants).",
		"Ouvrez un secret : l'œil 👁 révèle la valeur, l'onglet Version History montre les versions. Chaque lecture est journalisée.",
	}},
	"tp1-4": {Tool: "vault", From: 2, Skip: 3, Steps: []string{
		"Les commandes 1 et 2 (lire et lancer le script de configuration) se font dans le terminal.",
		"Menu Secrets Engines → database/ → onglet Roles → app-ingest → « Generate credentials ».",
		"Notez username, password et lease_id : ils servent aux commandes suivantes (psql et révocation) dans le terminal.",
	}},
	"tp1-5": {Tool: "vault", From: 0, Skip: 5, Steps: []string{
		"Menu Secrets Engines → « Enable new engine + » → Transit → Enable Engine.",
		"Dans transit/ : « Create encryption key + » → Name : datacorp-pii, Type : aes256-gcm96 → Create encryption key.",
		"Sur la clé : Key actions → Encrypt. Tapez l'IBAN FR7630001007941234567890185, cochez « Encode to base64 », cliquez Encrypt : vous obtenez vault:v1:…",
		"Onglet Versions → « Rotate encryption key » : la clé passe en v2.",
		"Les commandes 6 et 7 (chiffrer les IBAN déjà en base, puis vérifier) se font dans le terminal.",
	}},
	"tp1-6": {Tool: "rabbitmq", Steps: []string{
		"Connectez-vous avec le compte admin RabbitMQ (bouton 🔑 Identifiants).",
		"Onglet Queues : la file ingest.transactions et ses messages. Onglet Connections : la colonne TLS montre que chaque client est chiffré.",
		"Les vérifications SQL (commandes 2 à 4) se font dans le terminal.",
	}},
	"tp2-7": {Tool: "minio", From: 2, Skip: 4, Steps: []string{
		"Les commandes 1 et 2 (lire la politique, créer alice et bruno) se font dans le terminal.",
		"Mot de passe MinIO de bruno, dans le terminal : vault kv get -field=password kv/datacorp/users/minio/bruno",
		"Connectez-vous à la MinIO Console en tant que bruno : raw-data est refusé ou invisible. Dans curated, « Upload » d'un fichier : refusé.",
		"Déconnectez-vous, puis connectez-vous en tant qu'alice (kv/datacorp/users/minio/alice) : raw-data/transactions/ est lisible.",
		"La dernière commande (mc ls alice/…) confirme dans le terminal.",
	}},
	"tp3-2": {Tool: "minio", Steps: []string{
		"Connectez-vous à la MinIO Console avec le compte admin (bouton 🔑 Identifiants).",
		"Buckets → audit-logs : Object Locking est activé, la rétention est GOVERNANCE 30 jours.",
		"Ouvrez une archive déposée et essayez « Delete » : MinIO refuse, l'objet est protégé (WORM).",
	}},
}

func init() {
	for i := range catalog {
		for j := range catalog[i].Steps {
			s := &catalog[i].Steps[j]
			if g, ok := guis[s.ID]; ok {
				g := g
				s.Gui = &g
			}
		}
	}
}
