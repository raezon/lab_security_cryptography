#!/usr/bin/env bash
# =============================================================================
#  TP2 — Étape 1 bis : comptes nominatifs (qui l'on est)
#  1. génère un mot de passe robuste par personne et le range dans Vault
#     (kv/datacorp/users/pg/<login>) — il n'est jamais affiché ;
#  2. crée le compte PostgreSQL et le rattache à SON rôle fonctionnel.
#  Prérequis : /lab/scripts/sql/tp2/01-roles.sql exécuté, session Vault admin.
# =============================================================================
set -euo pipefail
declare -A ROLE=( [alice]=r_data_engineer [bruno]=r_data_analyst [claire]=r_dpo
                  [david]=r_sysadmin [samira]=r_secops [nadia]=r_rh_manager )
for u in "${!ROLE[@]}"; do
  vault kv get "kv/datacorp/users/pg/$u" >/dev/null 2>&1 || /lab/scripts/new-password.sh pg "$u" >/dev/null
  pw=$(vault kv get -field=password "kv/datacorp/users/pg/$u")
  /lab/scripts/pg-admin.sh -q -v u="$u" -v r="${ROLE[$u]}" -v pw="$pw" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE %I', :'u', :'pw', :'r')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'u') \gexec
SQL
  echo "[ok] $u -> ${ROLE[$u]}"
done
# Compte à durée limitée : Bruno est en CDD jusqu'au 30/06/2027
/lab/scripts/pg-admin.sh -q -c "ALTER ROLE bruno VALID UNTIL '2027-06-30'"
echo "[ok] comptes créés — mots de passe dans Vault : kv/datacorp/users/pg/<login>"
