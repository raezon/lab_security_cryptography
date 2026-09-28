# TP3 — Tracer, détecter, prouver (audit & conformité)

**Module Sécurité des Données & DevSecOps — Projet fil rouge « DataCorp Secure »**

*Séance 3 sur 3 · Journalisation, SIEM & conformité RGPD*

| | |
|---|---|
| **Durée** | 3 h 30 |
| **Modalité** | Binôme, sur la stack des TP1 et TP2 (sinon, le formateur lance `./solutions/run.sh tp2`) |
| **Rendu** | Compte rendu de 2 pages : une capture par étape ✅, la chronologie de l'incident et la fiche GRC du §6.3 |
| **Outils** | pgAudit, journal d'audit Vault, webhook d'audit MinIO, `jq`, `detect.py` |

## Contexte

Mercredi matin, la supervision signale une nuit agitée : connexions ratées en série, exports volumineux, accès refusés sur le stockage. Samira doit comprendre **ce qui s'est passé**. Claire, la DPO, a **72 heures** pour décider s'il faut prévenir la CNIL. Problème : aujourd'hui, presque rien n'est journalisé.

## 1. Le cours en bref

- Un bon journal d'audit répond à **5 questions** : **qui** ? **quoi** ? **sur quelle donnée** ? **quand** ? **d'où** ? Et il donne le **résultat** (succès ou refus).
- **On ne journalise pas les données elles-mêmes** : un journal plein d'IBAN devient une nouvelle base sensible.
- Un journal n'a de valeur que s'il est **intègre** : un pirate efface ses traces. On calcule donc une empreinte (SHA-256) et on le range dans un stockage **WORM** (*Write Once, Read Many* : impossible à effacer).
- **Même horloge pour tous** : sans heure commune (UTC), impossible de reconstituer l'ordre des événements.

![De l'événement à la preuve](images/fig_tp3_chaine_logs.png)

## 2. Les outils en 5 minutes

| Outil | Ce qu'il trace | Où lire |
|---|---|---|
| **pgAudit** (PostgreSQL) | Qui a lu ou modifié une table sensible, combien de lignes | `/logs/postgres/postgresql.json` |
| **Audit Vault** (activé au TP1) | Qui a demandé quel secret | `/logs/vault/audit.log` |
| **Webhook MinIO** | Qui a lu ou écrit quel fichier | `/logs/minio/audit.jsonl` |
| **jq** | Filtrer du JSON en ligne de commande | `jq 'select(.user=="bruno")' fichier` |
| **detect.py** | Règles de détection → alertes classées | `python3 /lab/scripts/detect.py` |

Une ligne pgAudit se lit ainsi : `AUDIT: OBJECT,1,1,READ,SELECT,TABLE,rh.employes,"SELECT …",<not logged>,200`, soit un accès **objet**, en **lecture**, sur **rh.employes**, avec la requête, **sans** les valeurs, et **200 lignes** lues.

## 3. Mission

| Rôle | Personne | Ce qu'elle fait aujourd'hui |
|---|---|---|
| Data Security Engineer | Samira | Active l'audit, enquête, protège les preuves |
| DPO | Claire | Qualifie l'incident et décide de la notification à la CNIL |
| Formateur | — | Joue l'attaquant (lance la simulation) et l'auditeur (lit le rapport) |

## 4. Manipulations guidées

Démarche à chaque étape : **🎯 Pourquoi → ▶ Faire → ✅ Vérifier**. Tout se passe dans la toolbox. Si Vault est scellé : `/lab/scripts/vault-unseal.sh`.

### Étape 1 — Allumer l'audit PostgreSQL

> 🎯 On veut tracer les accès aux tables **RESTREINT** et les changements de droits, pas tout le reste (trop de bruit).

```bash
less /lab/scripts/sql/tp3/01-audit.sql                     # repérez le rôle "auditeur"
/lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp3/01-audit.sql
as() { u=$1; shift; PGPASSWORD="$(vault kv get -field=password kv/datacorp/users/pg/$u)" psql -U "$u" -c "$*"; }
as nadia "SELECT nom, poste FROM rh.employes LIMIT 3"
jq -c 'select((.message // "") | startswith("AUDIT")) | {timestamp, user, message}' /logs/postgres/postgresql.json | tail -2
```

✅ **Vérifier :** une ligne `AUDIT: OBJECT,…,rh.employes,…,3` au nom de `nadia` apparaît.

### Étape 2 — Collecter MinIO et créer le coffre à preuves

> 🎯 Les journaux doivent **quitter** la machine surveillée et être rangés là où personne ne peut les effacer.

```bash
cat /lab/scripts/setup/tp3-coffre.sh                       # webhook, bucket WORM, compte de dépôt
/lab/scripts/setup/tp3-coffre.sh                           # AUDIT_TOKEN : voir le fichier .env
/lab/scripts/seal-logs.sh                                  # 1re archive scellée (état de référence)
OBJ=$(mc ls --recursive dc/audit-logs | awk '{print $NF}' | grep tar.gz | head -1)
mc rm "dc/audit-logs/$OBJ"                                 # on essaie d'effacer une preuve…
```

✅ **Vérifier :** l'effacement est **refusé** (objet protégé par la rétention).

### Étape 3 — Rejouer l'incident

> 🎯 On reproduit la « nuit agitée » pour disposer de vraies traces. Ne lisez pas le script avant d'avoir enquêté !

```bash
/lab/scripts/simulate-incidents.sh
```

✅ **Vérifier :** le script affiche 8 étapes et se termine par « Simulation terminée ».

### Étape 4 — Enquêter à la main

> 🎯 Un bon analyste sait lire les journaux **avant** de faire confiance à un outil automatique.

```bash
P=/logs/postgres/postgresql.json
jq -r 'select(.state_code=="28P01") | .user' $P | sort | uniq -c          # a) mots de passe ratés, par compte
jq -r 'select((.message // "") | startswith("AUDIT: OBJECT"))
       | [.timestamp, .user, .message[0:110]] | @tsv' $P | tail -5         # b) lectures de tables sensibles
jq -c 'select((.api.statusCode // 0) >= 400)
       | {time, qui: .accessKey, api: .api.name, bucket: .api.bucket}' /logs/minio/audit.jsonl   # c) refus MinIO
jq -c 'select(.error != null) | {time, qui: .auth.display_name, path: .request.path}' /logs/vault/audit.log  # d) refus Vault
```

Remplissez la **chronologie** (livrable) :

| Heure (UTC) | Source | Qui | Quoi | Résultat |
|---|---|---|---|---|
| … | PostgreSQL | bruno | 8 mots de passe ratés | refusé |
| … | … | … | … | … |

⚠ PostgreSQL écrit l'heure de Paris (`CEST`, UTC+2), MinIO et Vault écrivent l'heure UTC (`Z`). **Convertissez tout en UTC.**

✅ **Vérifier :** au moins 6 événements, dans le bon ordre.

### Étape 5 — Détecter automatiquement

> 🎯 On ne peut pas lire des millions de lignes à la main : on écrit des **règles** qui lèvent des alertes.

```bash
python3 /lab/scripts/detect.py
```

✅ **Vérifier :** des alertes `CRITIQUE`, `HAUTE` et `MOYENNE` s'affichent. Comparez-les à votre chronologie de l'étape 4.

### Étape 6 — Sceller les preuves

> 🎯 Si l'affaire va plus loin (licenciement, plainte, contrôle CNIL), il faudra prouver que les journaux n'ont **pas été modifiés**.

```bash
/lab/scripts/seal-logs.sh                                  # 2e archive, chaînée à la 1re
cd /lab/work/scelles && sha256sum -c ./*.sha256 && cat chaine.txt
```

✅ **Vérifier :** chaque archive affiche `OK`, et `chaine.txt` contient 2 maillons.

## 5. Questions de compréhension

1. Pourquoi ne journalise-t-on **pas** toutes les requêtes (`pgaudit.log = 'all'`) ? Donnez deux raisons.
2. Dans votre chronologie, pourquoi l'heure de Paris et l'heure UTC posent-elles problème ? Quelle est la solution ?
3. À l'étape 2, le compte **root** de MinIO pourrait-il quand même effacer la preuve ? (indice : mode GOVERNANCE ou COMPLIANCE)
4. Parmi les alertes de `detect.py`, laquelle est **la plus grave** selon vous, et pourquoi ?

## 6. Volet GRC : qualifier un incident

### 6.1 Le framework : la méthode en 4 étapes, appliquée à un incident

On reprend la même méthode que dans les TP1 et TP2. Ici, l'objet analysé est un **événement de sécurité** : est-ce une violation de données au sens du RGPD, et que doit-on faire ?

![La méthode GRC en 4 étapes](images/fig_grc_methode.png)

| Étape | La question pour un incident | L'outil de ce TP |
|---|---|---|
| 1. Identifier | Que s'est-il passé ? Quelles données, combien de personnes ? | La chronologie (étape 4) |
| 2. Évaluer | Est-ce une **violation** de données personnelles ? Quel risque pour les personnes ? | L'**arbre de décision** ci-dessous |
| 3. Traiter | Notifier la CNIL (72 h) ? Informer les personnes ? Quelles mesures correctives ? | RGPD art. 33 et 34 |
| 4. Prouver | Quelles traces ? Sont-elles intègres ? Qui a décidé, quand ? | Archives scellées + registre des violations |

![Arbre de décision : faut-il notifier la CNIL et informer les personnes ?](images/fig_tp3_arbre_violation.png)

À retenir : **toute** violation est inscrite au registre interne (art. 33.5), même quand on ne notifie pas. La notification à la CNIL se fait **sous 72 h**. L'information des personnes n'est obligatoire que si le risque est **élevé**, sauf si les données étaient chiffrées (art. 34.3.a).

### 6.2 Exemple corrigé : « Bruno tente de lire la zone raw-data »

| Étape | Réponse |
|---|---|
| **1. Identifier** | Journal MinIO : 3 requêtes de `bruno` sur `raw-data` → code **403** (refusé). Données visées : lots de transactions (IBAN chiffrés). Aucune donnée obtenue. |
| **2. Évaluer** | Arbre : « des données ont-elles été lues sans droit ? » → **non**, tout a été refusé. Ce n'est **pas une violation RGPD**, mais un **incident de sécurité** (tentative hors périmètre). |
| **3. Traiter** | Pas de notification CNIL. Entretien avec Bruno et son manager (erreur ou curiosité ?). On garde la règle de détection R4. Texte : **ISO 27001 A.5.25** (évaluation des événements de sécurité). |
| **4. Prouver** | Extrait du journal MinIO (3 lignes 403) dans l'archive scellée n°2 + empreinte SHA-256 + décision datée et signée par Samira. |

### 6.3 À vous : « Alice exporte tout l'annuaire RH »

Votre chronologie montre qu'Alice a lu **200 lignes** de `rh.employes` (matricule, département, poste, date d'embauche) et les a écrites dans `/tmp/annuaire.csv`, « pour tester ». Elle a aussi lu les IBAN des 60 clients, qui sont chiffrés (`vault:v2:…`).

1. **Identifier** — Quelles données ont été lues ? Combien de personnes sont concernées ?
2. **Évaluer** — Suivez l'arbre : est-ce une violation ? Alice avait le **droit technique** de lire ces colonnes : cela change-t-il la réponse ? (indice : RGPD art. 5.1.b, finalité)
3. **Traiter** — Faut-il notifier la CNIL ? Informer les 200 salariés ? Informer les clients dont l'IBAN a été lu ? Justifiez chaque réponse avec l'arbre.
4. **Prouver** — Quelles lignes de journal et quelle archive scellée joignez-vous au registre des violations ?

## 7. Barème (sur 20)

| Critère | Points |
|---|---|
| Étapes 1 à 6 réalisées, avec une capture par ✅ | 7 |
| Chronologie de l'incident en UTC | 3 |
| Questions de compréhension (§5) | 4 |
| Fiche GRC complète et justifiée (§6.3) | 6 |

## 8. Pistes de correction (usage formateur)

*Ne pas distribuer avant le rendu.* Le script `./solutions/run.sh tp3` amène une stack à l'état « fin de TP3 ».

- **Q1** — Volume et performance ; et surtout, les requêtes contiennent des valeurs (IBAN, NIR) qui se retrouveraient dans les journaux. On cible les tables RESTREINT grâce au rôle `auditeur`.
- **Q2** — Décalage de 2 h : un tri mélange les événements. Solution : tout convertir en UTC (ou `log_timezone = 'UTC'`), avec des horloges synchronisées par NTP (ISO 27001 A.8.17).
- **Q3** — Oui : en mode GOVERNANCE, le root peut forcer avec `mc rm --bypass`. En mode COMPLIANCE, personne ne le peut, root compris, jusqu'à l'échéance (inconvénient : aucune correction possible en cas d'erreur).
- **Q4** — R3 (lecture massive de `rh.employes` par Alice) ou R7 (tentative d'effacement des preuves) : toute réponse argumentée est acceptée. Faux positif attendu : R5 sur Alice pour un `GRANT` lié à la publication d'une vue (étape 6 du TP2), qui est légitime.
- **§6.3** — 200 salariés ; données d'identification professionnelle, pas de NIR, d'IBAN ni de salaire. C'est une **violation de confidentialité** : l'accès est techniquement autorisé mais sans finalité (art. 5.1.b), donc un détournement. Risque faible si le fichier est supprimé et confiné (à prouver) → inscription au registre (art. 33.5) ; notification CNIL à argumenter (acceptable des deux côtés si c'est justifié) ; pas d'information des salariés (risque non élevé). IBAN clients : chiffrés, clé non compromise → exemption art. 34.3.a. Preuves : lignes pgAudit (200 et 60 lignes), archive scellée n°2, sortie de `sha256sum -c`.
