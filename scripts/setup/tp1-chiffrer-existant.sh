#!/usr/bin/env bash
# =============================================================================
#  TP1 — Étape 5 : chiffrer les IBAN déjà présents en base
#  1. crée un rôle Vault "migration-pii" : compte PostgreSQL valable 15 min,
#     autorisé UNIQUEMENT à lire/modifier les colonnes IBAN ;
#  2. obtient un identifiant éphémère et lance le chiffrement (Vault transit) ;
#  3. révoque l'identifiant dès la fin (le compte est supprimé de PostgreSQL).
# =============================================================================
set -euo pipefail
vault write database/roles/migration-pii db_name=datacorp \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE app_migration;" \
  revocation_statements="REVOKE app_migration FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl=15m max_ttl=30m >/dev/null

cred=$(vault read -format=json database/creds/migration-pii)
echo "[migration] compte éphémère : $(jq -r .data.username <<<"$cred") (valable $(jq -r .lease_duration <<<"$cred") s)"
PGUSER=$(jq -r .data.username <<<"$cred") PGPASSWORD=$(jq -r .data.password <<<"$cred") \
VAULT_TOKEN=$(cat ~/.vault-token) python3 /lab/scripts/encrypt-existing-ibans.py
vault lease revoke "$(jq -r .lease_id <<<"$cred")" >/dev/null
echo "[migration] identifiant révoqué : le compte n'existe plus dans PostgreSQL"
