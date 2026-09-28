#!/usr/bin/env bash
# =============================================================================
#  02-datacorp-roles.sh — rôles techniques de départ
#
#  - legacy_etl   : compte "historique" au mot de passe codé en dur dans les
#                   scripts de 2019 (c'est le problème à corriger au TP1).
#  - vault_admin  : compte dédié que HashiCorp Vault utilisera pour créer des
#                   identifiants dynamiques (TP1). Son mot de passe initial est
#                   lu dans .env puis sera ROTÉ par Vault (plus personne ne le
#                   connaîtra).
#  - app_ingest / app_readonly : rôles "groupes" (NOLOGIN) dont hériteront les
#                   identifiants dynamiques générés par Vault.
# =============================================================================
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v vault_pw="$VAULT_DB_ADMIN_PASSWORD" -v legacy_pw="$LEGACY_ETL_PASSWORD" <<'EOSQL'

-- ---------------------------------------------------------------- legacy (anti-pattern)
CREATE ROLE legacy_etl LOGIN PASSWORD :'legacy_pw';
GRANT CONNECT ON DATABASE datacorp TO legacy_etl;
GRANT USAGE ON SCHEMA rh, finance TO legacy_etl;
GRANT ALL ON ALL TABLES IN SCHEMA rh, finance TO legacy_etl;
GRANT ALL ON ALL SEQUENCES IN SCHEMA rh, finance TO legacy_etl;
COMMENT ON ROLE legacy_etl IS 'Compte ETL 2019 - mot de passe partagé, jamais changé';

-- ---------------------------------------------------------------- groupes applicatifs
CREATE ROLE app_ingest NOLOGIN;
GRANT CONNECT ON DATABASE datacorp TO app_ingest;
GRANT USAGE ON SCHEMA finance TO app_ingest;
GRANT INSERT ON finance.transactions TO app_ingest;
GRANT SELECT (id) ON finance.clients TO app_ingest;           -- contrôle d'existence du client
GRANT USAGE ON SEQUENCE finance.transactions_id_seq TO app_ingest;
COMMENT ON ROLE app_ingest IS 'Pipeline d''ingestion : INSERT uniquement';

CREATE ROLE app_readonly NOLOGIN;
GRANT CONNECT ON DATABASE datacorp TO app_readonly;
GRANT USAGE ON SCHEMA finance TO app_readonly;
GRANT SELECT ON finance.transactions, finance.clients TO app_readonly;
COMMENT ON ROLE app_readonly IS 'Lecture des données finance (reporting applicatif)';

CREATE ROLE app_migration NOLOGIN;
GRANT CONNECT ON DATABASE datacorp TO app_migration;
GRANT USAGE ON SCHEMA rh, finance TO app_migration;
GRANT SELECT (id, iban), UPDATE (iban) ON rh.employes, finance.clients TO app_migration;
GRANT SELECT (id, iban_contrepartie), UPDATE (iban_contrepartie) ON finance.transactions TO app_migration;
COMMENT ON ROLE app_migration IS 'Opération ponctuelle : chiffrement des IBAN existants (TP1)';

-- ---------------------------------------------------------------- compte de service Vault
-- CREATEROLE + ADMIN OPTION sur les groupes : Vault peut créer/supprimer des
-- utilisateurs éphémères membres de ces groupes, et rien d'autre.
CREATE ROLE vault_admin LOGIN CREATEROLE PASSWORD :'vault_pw';
GRANT app_ingest   TO vault_admin WITH ADMIN OPTION;
GRANT app_readonly TO vault_admin WITH ADMIN OPTION;
GRANT app_migration TO vault_admin WITH ADMIN OPTION;
GRANT CONNECT ON DATABASE datacorp TO vault_admin;
COMMENT ON ROLE vault_admin IS 'Compte technique HashiCorp Vault (secrets engine database)';
EOSQL

echo "[init] rôles DataCorp créés"
