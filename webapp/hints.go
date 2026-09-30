package main

// Indices progressifs de chaque étape, du plus vague au plus précis.
// Ils sont révélés un par un par l'étudiant (bouton « Indice ») : le premier
// oriente la réflexion, le deuxième désigne l'outil, le dernier évite le piège
// le plus fréquent. Aucun ne donne la commande complète (c'est le rôle de la
// solution).
var hints = map[string][]string{
	// ---------------------------------------------------------------- TP1
	"tp1-1": {
		"Un script qui se connecte à une base doit bien trouver son mot de passe quelque part… Lisez-le du début à la fin avant de chercher.",
		"grep cherche un mot dans un fichier. Les variables de connexion s'appellent souvent *_PASS, *_SECRET ou *_KEY.",
		"Le script dépose son export dans /tmp : le nom commence par export_rh_. Utilisez head pour n'en lire que les premières lignes.",
	},
	"tp1-2": {
		"Commencez toujours par vault status : Initialized et Sealed vous disent où vous en êtes.",
		"L'initialisation ne se fait qu'une fois. Ensuite il faut 3 clés d'ouverture différentes, une par commande vault operator unseal.",
		"Les clés et le jeton root sont affichés par vault-cles. Après la 3e clé, n'oubliez pas vault login avec le jeton root, sinon les étapes suivantes seront refusées.",
	},
	"tp1-3": {
		"Vault range les secrets simples (identifiant + mot de passe) dans un moteur « clé / valeur » : il faut d'abord l'activer.",
		"Les mots de passe à ranger sont déjà dans des variables : $POSTGRES_PASSWORD, $MINIO_ROOT_PASSWORD, $RABBITMQ_ADMIN_PASSWORD.",
		"Le chemin commence par kv/ (le nom du moteur) : kv/datacorp/break-glass/postgres. vault kv get sur le même chemin doit vous rendre le secret.",
	},
	"tp1-4": {
		"Ici Vault ne stocke pas un mot de passe : il en fabrique un nouveau à chaque demande, valable 1 heure.",
		"Le script fourni configure tout. Ensuite, vault read database/creds/app-ingest vous donne username, password et lease_id : copiez-les.",
		"Le compte ne peut qu'ajouter (INSERT) : un SELECT doit être refusé, c'est le résultat attendu. vault lease revoke <lease_id> le supprime immédiatement.",
	},
	"tp1-5": {
		"On ne veut pas que la base connaisse la clé : c'est Vault qui chiffre, la base ne reçoit que le résultat.",
		"Le moteur s'appelle transit, la clé datacorp-pii. Vault attend le texte à chiffrer encodé en base64.",
		"Après la rotation, la clé passe en v2 : les IBAN chiffrés commencent par vault:v2:. Le script tp1-chiffrer-existant.sh s'occupe des lignes déjà en base.",
	},
	"tp1-6": {
		"Le script tp1-pipeline.sh fait tout le branchement : lancez-le puis vérifiez ce qu'il a produit.",
		"La colonne ingere_par de finance.transactions dit quel compte a écrit. pg_stat_ssl dit si votre propre connexion est chiffrée.",
		"sslmode=disable force une connexion sans chiffrement : si PostgreSQL est bien configuré, elle doit être refusée (« no encryption »).",
	},
	"tp1-7": {
		"Le vieux compte legacy_etl existe toujours dans PostgreSQL, avec le mot de passe que tout le monde a vu à l'étape 1.",
		"ALTER ROLE permet d'interdire la connexion (NOLOGIN) et d'effacer le mot de passe (PASSWORD NULL).",
		"Relancez ensuite le vieux script : cette fois il doit échouer. Pensez aussi à supprimer l'export en clair laissé dans /tmp.",
	},
	// ---------------------------------------------------------------- TP2
	"tp2-1": {
		"Avant de donner des droits, il faut savoir ce qui est sensible. La DPO l'a écrit dans une table du schéma gouvernance.",
		"La table s'appelle classification_donnees. Filtrez sur schema_name = 'rh'.",
		"Regardez la colonne niveau : RESTREINT est le plus sensible (NIR, IBAN, salaire).",
	},
	"tp2-2": {
		"D'abord les rôles (ce que l'on a le droit de faire), ensuite les personnes (qui l'on est).",
		"Le fichier 01-roles.sql crée les rôles : exécutez-le avec sql -f. Le script tp2-comptes.sh crée ensuite les 6 personnes.",
		"sql \"\\du\" liste les rôles et leurs membres : alice doit apparaître dans r_data_engineer.",
	},
	"tp2-3": {
		"Une règle n'est prouvée que si on a vu un refus. Testez chaque personne avec sql-as.",
		"Bruno (analyste) n'a pas le droit de lire la table RH brute. Alice peut lire certaines colonnes, mais pas le NIR.",
		"Attendu : 3 « permission denied » et 1 succès. Un succès là où vous attendiez un refus = une faille à noter.",
	},
	"tp2-4": {
		"Row Level Security : la base filtre les LIGNES selon la personne connectée, pas seulement les colonnes.",
		"Le fichier 02-rls.sql contient la règle. Activez-la avec sql -f, puis interrogez la table en tant que nadia.",
		"Un GROUP BY departement doit ne renvoyer qu'une ligne (Finance) pour Nadia.",
	},
	"tp2-5": {
		"L'analyste doit pouvoir compter et comparer sans jamais savoir qui est qui : on lui donne une vue, pas la table.",
		"Le fichier 03-vues-masquees.sql crée analytics.v_employes. Repérez hmac (pseudonyme), masquer_email et tranche_age.",
		"La dernière requête compte les personnes encore uniques (reconnaissables). Notez ce nombre : c'est la question 3.",
	},
	"tp2-6": {
		"Séparation des tâches : celle qui prépare (Alice) n'est pas celle qui valide (Claire).",
		"04-publication.sql crée la fonction publier_vue. Essayez de publier AVANT la validation : le refus est attendu.",
		"La validation est une ligne APPROUVE insérée par claire dans gouvernance.validations_dpo. Ensuite Alice publie, puis Bruno lit la vue.",
	},
	"tp2-7": {
		"Les mêmes règles s'appliquent aux fichiers : Bruno lit la zone curated (masquée), jamais raw-data (brute).",
		"Le script tp2-minio.sh crée les alias mc « alice » et « bruno ». mc ls liste, mc cp écrit.",
		"Attendu : 2 refus pour Bruno (lecture de raw-data, écriture dans curated) et 1 succès pour Alice.",
	},
	// ---------------------------------------------------------------- TP3
	"tp3-1": {
		"On n'audite pas tout (trop de bruit) : seulement les tables RESTREINT et les changements de droits.",
		"01-audit.sql active pgAudit via un rôle « auditeur ». Lancez-le puis faites une lecture en tant que nadia.",
		"logs audit affiche le journal lisible : cherchez une ligne AUDIT: OBJECT … rh.employes au nom de nadia.",
	},
	"tp3-2": {
		"Un journal resté sur la machine attaquée peut être effacé par l'attaquant : il faut le sortir et le protéger.",
		"tp3-coffre.sh crée le coffre WORM (écriture unique). seal-logs.sh y dépose une archive des journaux.",
		"effacer-preuve tente de supprimer l'archive : un refus (rétention / Object Lock) est le résultat attendu.",
	},
	"tp3-3": {
		"Cette étape joue l'attaquant : lancez simplement la simulation.",
		"Ne lisez pas le script avant d'avoir enquêté : c'est l'objet des étapes suivantes.",
		"Attendu : 8 étapes affichées, puis « Simulation terminée ».",
	},
	"tp3-4": {
		"Quatre sources, quatre commandes logs : echecs, audit, minio, vault. Lisez-les une par une.",
		"Notez pour chaque événement : heure, compte, action, résultat. Une ligne = un fait.",
		"Attention aux fuseaux : PostgreSQL écrit l'heure de Paris, MinIO et Vault l'heure UTC. Convertissez tout en UTC avant de trier.",
	},
	"tp3-5": {
		"Un outil automatique applique des règles : « trop d'échecs de connexion », « lecture massive », etc.",
		"detect.py lit les mêmes journaux que vous et classe les alertes par gravité.",
		"Comparez ses alertes à votre chronologie : a-t-il trouvé quelque chose que vous aviez manqué, ou l'inverse ?",
	},
	"tp3-6": {
		"Une preuve doit pouvoir démontrer qu'elle n'a pas été modifiée : on calcule son empreinte (SHA-256).",
		"seal-logs.sh crée une 2e archive dont l'empreinte est reliée à la 1re (une chaîne, comme une blockchain simplifiée).",
		"Dans /lab/work/scelles, sha256sum -c vérifie chaque archive : chaque ligne doit afficher OK.",
	},
}

func init() {
	for i := range catalog {
		for j := range catalog[i].Steps {
			s := &catalog[i].Steps[j]
			if h, ok := hints[s.ID]; ok && len(s.Hints) == 0 {
				s.Hints = h
			}
		}
	}
}
