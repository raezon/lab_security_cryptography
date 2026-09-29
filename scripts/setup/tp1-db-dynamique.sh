#!/usr/bin/env bash
# =============================================================================
#  TP1 — Étape 4 : apprendre à Vault à créer des comptes PostgreSQL temporaires
#   a. active le moteur « database »
#   b. donne à Vault le compte technique vault_admin (mot de passe du .env)…
#   c. …puis Vault change ce mot de passe : plus AUCUN humain ne le connaît
#   d. crée le rôle « app-ingest » : un compte valable 1 h, qui peut seulement
#      INSÉRER des transactions (rôle PostgreSQL app_ingest)
# =============================================================================
set -euo pipefail
echo "a. Moteur database"
vault secrets list | grep -q '^database/' || vault secrets enable database

echo "b+c. Connexion Vault -> PostgreSQL (TLS vérifié) puis rotation du mot de passe"
if vault read database/config/datacorp >/dev/null 2>&1; then
  echo "   déjà configuré (le mot de passe de vault_admin a déjà été changé par Vault)"
else
  if [ -z "${VAULT_DB_ADMIN_PASSWORD:-}" ]; then read -rsp "VAULT_DB_ADMIN_PASSWORD (bouton « Identifiants ») : " VAULT_DB_ADMIN_PASSWORD; echo; fi
  vault write database/config/datacorp plugin_name=postgresql-database-plugin \
    connection_url="postgresql://{{username}}:{{password}}@postgres:5432/datacorp?sslmode=verify-full&sslrootcert=/certs/vault/ca.crt" \
    allowed_roles="*" username="vault_admin" password="$VAULT_DB_ADMIN_PASSWORD" password_authentication="scram-sha-256"
  vault write -f database/rotate-root/datacorp
fi

echo "d. Rôle app-ingest (1 h, INSERT seulement)"
vault write database/roles/app-ingest db_name=datacorp default_ttl=1h max_ttl=4h \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE app_ingest;" \
  revocation_statements="REVOKE app_ingest FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";"
echo "[ok] essayez maintenant :  vault read database/creds/app-ingest"
