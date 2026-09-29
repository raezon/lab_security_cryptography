# DataCorp Secure — Lab « Sécurité de la chaîne de valeur Data »

Socle Docker Compose commun aux trois travaux pratiques du module :

| TP | Thème | Rôles mis en scène |
|----|-------|--------------------|
| **TP1** | Chiffrement & gestion centralisée des secrets (Vault) | Data Security Engineer, Data Engineer, SysAdmin |
| **TP2** | Contrôle d'accès, segmentation & anonymisation (RBAC, RLS, vues masquées) | Data Engineer, DPO, Data Analyst, Manager RH |
| **TP3** | Auditabilité, traçabilité & conformité GRC (pgAudit, SIEM simulé, WORM) | Data Security Engineer, DPO, Auditeur |

## Architecture

```
                         ┌──────────────── net-broker ────────────────┐
  producer.py ──AMQPS──▶ │ RabbitMQ :5671 (TLS) / :15671 (mgmt TLS)    │
                         └──────────────▲─────────────────────────────┘
                                        │ AMQPS
  ┌──────────────────────────── toolbox (poste apprenant) ────────────────────────────┐
  │ psql · vault · mc · jq · openssl · tcpdump · python3   consumer.py                 │
  └───────┬──────────────────────┬─────────────────────────┬──────────────────────────┘
          │ TLS verify-full      │ HTTPS                    │ HTTPS
  ┌───────▼────────┐     ┌───────▼─────────┐       ┌────────▼─────────┐     ┌────────────┐
  │ PostgreSQL 16  │◀────│ Vault 1.17      │       │ MinIO (S3)       │────▶│ audit-sink │
  │ + pgAudit      │ TLS │ transit, KV,    │       │ SSE-S3 au repos  │HTTP │ (SIEM      │
  │ jsonlog        │     │ database, AMQP  │       │ Object Lock WORM │     │  simulé)   │
  └────────────────┘     └─────────────────┘       └──────────────────┘     └────────────┘
  ───────────────────────────────── net-data ──────────────────────────────────────────
  certs-init : PKI interne (CA + certificats serveur) générée au 1er démarrage
```

## Démarrage rapide

Prérequis : Docker 24+ avec Compose v2, 4 Go de RAM libres, accès à Docker Hub.

```bash
./scripts/generate-env.sh        # crée .env (secrets aléatoires, droits 600)
docker compose up -d --build     # ~3 min la première fois
docker compose ps                # certs-init doit être "exited (0)"
docker compose exec toolbox bash # poste de travail
/lab/scripts/check-stack.sh      # vérifie TLS + état de chaque service
```

Interfaces web (depuis l'hôte, certificat signé par la CA du lab : acceptez l'avertissement ou importez `ca.crt`) :

| Service | URL |
|---------|-----|
| Vault UI | https://localhost:8200 |
| MinIO Console | https://localhost:9001 |
| RabbitMQ Management | https://localhost:15671 |

PostgreSQL n'est volontairement **pas** exposé sur l'hôte : on s'y connecte depuis la toolbox.

## Console web des TP (Go)

`docker compose up -d` démarre aussi **lab-console** : **http://localhost:8085** (écoute sur 127.0.0.1 uniquement).

| Page | Contenu |
|------|---------|
| TP1 / TP2 / TP3 | toutes les étapes des énoncés (🎯 → ▶ → ✅), exécutées dans la toolbox avec sortie en direct et vérification automatique du critère ✅ |
| En transit (TLS) | poignée de main TLS avec chaque service, tests d'attaque (mauvais nom, sans CA, TLS 1.1), connexions en clair refusées, octets « sur le fil » HTTPS vs HTTP |
| Applicatif (Vault transit) | chiffrer / déchiffrer, rotation, rewrap, HMAC, chiffrement d'enveloppe |
| Au repos (disques) | lecture brute des fichiers PostgreSQL (IBAN chiffrés, NIR en clair, tuples morts), MinIO (bucket clair vs SSE-S3), Vault (barrière) |
| Accès aux services | URL et identifiants (lus dans `.env` et Vault, masqués), comptes éphémères Vault |
| Terminal | commandes libres dans la toolbox |
| 📚 Cours | le projet DataCorp (voyage animé d'une transaction, menaces, personnages), Vault (jeu Shamir 3/5), MinIO (visionneuse des vrais buckets : S3 vs disque), RabbitMQ (simulation de file) — avec captures d'écran guidées et quiz |
| Défis | chaque page « chiffrement » propose des défis ludiques cochés automatiquement (stockés dans le navigateur) |

Captures d'écran des cours : `./scripts/captures-cours.sh` (Playwright en conteneur, se connecte aux interfaces avec le jeton root et les comptes admin du `.env`) — écrit `webapp/static/cours/*.png` puis reconstruit la console. Tant qu'elles manquent, la console affiche un emplacement « 📸 Capture à venir ».

Code : `webapp/` (bibliothèque standard Go uniquement). Reconstruire sans recréer la toolbox :
`docker compose up -d --build --no-deps lab-console`.
⚠ La console accède au socket Docker (exec dans la toolbox, lecture des disques) : usage en lab local uniquement.

## Modifications par rapport à la version initiale

- `minio/minio` et `minio/mc` ne sont plus publiés sur Docker Hub : même build via `bitnamilegacy/minio:2025.4.22` et `bitnamilegacy/minio-client:2025.4.16` (commits identiques).
- `rabbitmq.conf` : le port de management 15671 accepte désormais uniquement TLS 1.2 / 1.3 (il acceptait TLS 1.1 CBC-SHA).
- TP3 étape 2 : dans un bucket versionné, `mc rm` sans `--version-id` crée seulement un *delete marker* ; c'est la suppression de la version (`mc rm --version-id …`) qui est refusée par l'Object Lock.

## Contenu

```
docker-compose.yml          socle complet (7 services, 2 réseaux, 8 volumes)
.env.example                variables (copie -> .env via generate-env.sh)
postgres/                   Dockerfile (pgAudit), postgresql.conf durci, pg_hba.conf, initdb/ (schéma + seeds + rôles)
vault/config/vault.hcl      Vault en mode serveur (TLS, scellé au démarrage)
vault/policies/*.hcl        politiques : ingest-pipeline, data-engineer, finance-app, secops, dpo-auditor
minio/policies/*.json       politiques IAM S3 : ingest-writer, data-engineer, data-analyst, dpo-auditor, log-shipper
rabbitmq/rabbitmq.conf      AMQPS + management HTTPS uniquement
toolbox/                    image du poste apprenant (aussi utilisée par certs-init et audit-sink)
audit-sink/sink.py          collecteur HTTP des événements d'audit MinIO (SIEM simulé)
pipeline/                   producer.py / consumer.py (RabbitMQ -> Vault transit -> PostgreSQL + MinIO)
scripts/                    outils des TP (check-stack, with-vault-creds, detect.py, seal-logs, ...)
scripts/legacy/             script historique volontairement non sécurisé (TP1)
scripts/setup/              scripts « étape automatisée » appelés par les TP (à lire avant de lancer)
scripts/sql/tp2, tp3/       fichiers SQL des étapes TP2 et TP3
solutions/                  corrigés formateur + run.sh (NON monté dans la toolbox)
tp/                         énoncés TP1, TP2, TP3 (Markdown) + tp/images/ (schémas, make_figures.py)
docx/                       énoncés Word : *_apprenant.docx (sans corrigé) et *_formateur.docx
work/                       répertoire de travail partagé (monté en /lab/work)
```

## Jeu de données

Base `datacorp`, 100 % fictive : 200 salariés (`rh.employes` avec NIR, IBAN, salaire), 60 clients, 2 000 transactions,
registre des traitements RGPD et classification des colonnes (`gouvernance.*`).

## Personas

| Login | Personne | Rôle |
|-------|----------|------|
| `alice`  | Alice Martin   | Data Engineer |
| `bruno`  | Bruno Leroy    | Data Analyst |
| `claire` | Claire Dubois  | DPO |
| `david`  | David Nguyen   | SysAdmin / exploitation |
| `samira` | Samira Haddad  | Data Security Engineer (SecOps) |
| `nadia`  | Nadia Benali   | Manager RH (département Finance) |

## Deux modes : Facile et Expert

À l'ouverture de la console (après le prénom + nom), l'étudiant choisit un mode (changeable à tout moment dans la barre de gauche) :

- **🎓 Facile** — chaque étape a un bouton **▶ Exécuter** : la console lance la commande et vérifie le ✅. Pour découvrir et comprendre.
- **🕵️ Expert (noté)** — l'étudiant **tape lui-même** les commandes dans un terminal par étape, avec documentation et indices. Déroulé :
  - **Phase 1 — Reconnaissance** : constater ce qu'un attaquant pourrait lire tant que rien n'est protégé (secrets en clair, IBAN sur le disque, trafic en clair…). Non noté.
  - **Phase 2 — Sécuriser** : refaire chaque mesure en tapant les commandes. **Barème par étape** : tapé sans aide **10 pts**, commande **pré-remplie 4 pts**, **solution 2 pts**. Une page **🏆 Mon score** récapitule le total (barème personnel, stocké dans le navigateur de l'étudiant ; l'endpoint `/api/check/{id}` vérifie la commande tapée avec les mêmes critères que le mode Facile).

## Lab partagé en classe

Une seule stack, publiée derrière Caddy ; chaque étudiant entre son **prénom et son nom** à l'ouverture de la console
(noté à côté des étapes qu'il lance et dans `docker compose logs lab-console`). Tout le monde a les mêmes accès.

| Interface | Adresse (VM de cours) | Identifiants |
|---|---|---|
| Console des TP | https://crypto.158-178-196-145.sslip.io | prénom + nom |
| Vault UI | https://vault.158-178-196-145.sslip.io | méthode « Token » + jeton root (bouton 🔑) |
| MinIO Console | https://minio.158-178-196-145.sslip.io | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (bouton 🔑) |
| RabbitMQ Management | https://rabbitmq.158-178-196-145.sslip.io | `RABBITMQ_ADMIN_USER` / `RABBITMQ_ADMIN_PASSWORD` (bouton 🔑) |

Réglages dans `.env` : `STUDENT_MODE=1` (corrigés masqués), `VAULT_PUBLIC_URL`, `MINIO_PUBLIC_URL`, `RABBITMQ_PUBLIC_URL`.
Remettre le lab à zéro entre deux groupes : `docker compose down -v && sudo rm -rf work/* && docker compose up -d`.
(`scripts/etudiants.sh` reste disponible pour donner un lab isolé à chaque étudiant.)

## Commandes simplifiées de la toolbox

| Commande | Rôle |
|---|---|
| `sql "SELECT …"` / `sql -f f.sql` | requête en administrateur (remplace `/lab/scripts/pg-admin.sh -c`) |
| `sql-as bruno "SELECT …"` | requête en tant qu'une personne du lab (remplace la fonction `as`) |
| `vault-cles` | clés d'ouverture + jeton root de Vault |
| `logs audit\|echecs\|minio\|vault\|tout` | journaux d'audit lisibles (remplace les filtres `jq` du TP3) |
| `effacer-preuve` | tentative de suppression d'une archive WORM (TP3 · étape 2) |

Elles sont dans `scripts/bin/` (dans le `PATH` de la toolbox).

## Formateur : accélérateur

```bash
./solutions/run.sh tp1   # amène le lab à l'état "fin de TP1"
./solutions/run.sh tp2   # puis "fin de TP2"
./solutions/run.sh tp3   # puis "fin de TP3"
```

## Exploitation

| Situation | Commande |
|-----------|----------|
| Vault scellé après un redémarrage | `docker compose exec toolbox /lab/scripts/vault-unseal.sh` |
| Session d'administration PostgreSQL | `docker compose exec -u postgres postgres psql -d datacorp` |
| Tout remettre à zéro | `docker compose down -v && rm -rf work/* && docker compose up -d` |
| Journaux d'un service | `docker compose logs -f vault` |

## Notes de version

- Images épinglées : `postgres:16-bookworm` (+ pgAudit), `hashicorp/vault:1.17`, `rabbitmq:3.13-management`,
  `minio/minio:RELEASE.2025-04-22T22-12-26Z`, `minio/mc:RELEASE.2025-04-16T18-13-26Z`, `debian:bookworm-slim`.
- MinIO ne publie plus de nouvelles images communautaires ; la version est épinglée sur une release existante.
  Toute alternative compatible S3 avec Object Lock peut la remplacer, à condition d'adapter les commandes `mc admin`.
- Vault est sous licence BSL ; OpenBao (fork Linux Foundation) accepte les mêmes commandes (`bao` au lieu de `vault`).
- Le mode `storage "file"` de Vault et le stockage des fragments de Shamir dans `work/` sont des **simplifications de lab**,
  signalées comme telles dans les TP.
