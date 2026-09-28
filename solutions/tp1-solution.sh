#!/usr/bin/env bash
# =============================================================================
#  TP1 — CORRIGÉ FORMATEUR (exécuté DANS la toolbox via solutions/run.sh tp1)
#  Rejoue toutes les manipulations du TP1 de façon idempotente.
#  Variables attendues : POSTGRES_PASSWORD VAULT_DB_ADMIN_PASSWORD
#    MINIO_ROOT_USER MINIO_ROOT_PASSWORD RABBITMQ_ADMIN_USER RABBITMQ_ADMIN_PASSWORD
# =============================================================================
set -euo pipefail
W=/lab/work
say() { printf "\n\e[36m== %s ==\e[0m\n" "$*"; }

say "4.2 Initialisation et descellement de Vault (Shamir 5/3)"
if [ "$(vault status -format=json 2>/dev/null | jq -r .initialized)" != "true" ]; then
  vault operator init -key-shares=5 -key-threshold=3 -format=json > "$W/vault-init.json"
  chmod 600 "$W/vault-init.json"
fi
/lab/scripts/vault-unseal.sh
vault login -no-print "$(jq -r .root_token "$W/vault-init.json")"

say "4.2 Audit device"
vault audit list 2>/dev/null | grep -q '^file/' || vault audit enable file file_path=/vault/logs/audit.log

say "4.3 Moteurs de secrets"
enable() { vault secrets list -format=json | jq -e --arg p "$1/" 'has($p)' >/dev/null || vault secrets enable -path="$1" "$2"; }
enable kv kv-v2; enable transit transit; enable database database; enable rabbitmq rabbitmq
for p in /lab/vault-policies/*.hcl; do vault policy write "$(basename "$p" .hcl)" "$p" >/dev/null; done
vault policy list

say "4.3 Comptes bris de glace sous séquestre"
vault kv put -mount=kv datacorp/break-glass/postgres username=postgres password="$POSTGRES_PASSWORD" >/dev/null
vault kv put -mount=kv datacorp/break-glass/minio username="$MINIO_ROOT_USER" password="$MINIO_ROOT_PASSWORD" >/dev/null
vault kv put -mount=kv datacorp/break-glass/rabbitmq username="$RABBITMQ_ADMIN_USER" password="$RABBITMQ_ADMIN_PASSWORD" >/dev/null

say "4.4 Transit : clé datacorp-pii"
vault read transit/keys/datacorp-pii >/dev/null 2>&1 || vault write -f transit/keys/datacorp-pii type=aes256-gcm96
vault write transit/keys/datacorp-pii/config deletion_allowed=false exportable=false >/dev/null

say "4.5 Database engine + rotation du mot de passe racine"
if ! vault read database/config/datacorp >/dev/null 2>&1; then
  vault write database/config/datacorp \
    plugin_name=postgresql-database-plugin \
    connection_url="postgresql://{{username}}:{{password}}@postgres:5432/datacorp?sslmode=verify-full&sslrootcert=/certs/vault/ca.crt" \
    allowed_roles="app-ingest,app-readonly,migration-pii" \
    username="vault_admin" password="$VAULT_DB_ADMIN_PASSWORD" \
    password_authentication="scram-sha-256"
  vault write -f database/rotate-root/datacorp
fi
mkrole() { # mkrole <nom vault> <rôle pg> <ttl> <max_ttl>
  vault write "database/roles/$1" db_name=datacorp \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE $2;" \
    revocation_statements="REVOKE $2 FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";" \
    default_ttl="$3" max_ttl="$4" >/dev/null
}
mkrole app-ingest    app_ingest    1h  4h
mkrole app-readonly  app_readonly  1h  8h
mkrole migration-pii app_migration 15m 30m

say "4.5 Chiffrement des IBAN historiques (identifiants éphémères migration-pii)"
cred=$(vault read -format=json database/creds/migration-pii)
PGUSER=$(jq -r .data.username <<<"$cred") PGPASSWORD=$(jq -r .data.password <<<"$cred") \
VAULT_TOKEN=$(cat ~/.vault-token) python3 /lab/scripts/encrypt-existing-ibans.py
vault lease revoke "$(jq -r .lease_id <<<"$cred")"

say "4.6 RabbitMQ engine"
vault write rabbitmq/config/connection connection_uri="https://rabbitmq:15671" \
  username="$RABBITMQ_ADMIN_USER" password="$RABBITMQ_ADMIN_PASSWORD" verify_connection=true >/dev/null
vault write rabbitmq/config/lease ttl=3600 max_ttl=14400 >/dev/null
vault write rabbitmq/roles/pipeline \
  vhosts='{"datacorp":{"configure":"^ingest\\..*","write":"^(amq\\.default|ingest\\..*)$","read":"^ingest\\..*"}}' >/dev/null

say "4.6 MinIO : bucket raw-data chiffré + compte de service svc-ingest"
mc alias set dc https://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing dc/raw-data
mc encrypt set sse-s3 dc/raw-data
mc admin policy create dc ingest-writer /lab/minio-policies/ingest-writer.json
if ! vault kv get kv/datacorp/minio/svc-ingest >/dev/null 2>&1; then
  SVC=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
  mc admin user add dc svc-ingest "$SVC"
  vault kv put -mount=kv datacorp/minio/svc-ingest access_key=svc-ingest secret_key="$SVC" >/dev/null
fi
mc admin policy attach dc ingest-writer --user svc-ingest 2>/dev/null || true

say "4.7 AppRole du pipeline"
vault auth list -format=json | jq -e 'has("approle/")' >/dev/null || vault auth enable approle
vault write auth/approle/role/ingest-pipeline token_policies=ingest-pipeline \
  token_ttl=15m token_max_ttl=1h secret_id_ttl=720h >/dev/null
mkdir -p "$W/approle" && chmod 700 "$W/approle"
vault read -field=role_id auth/approle/role/ingest-pipeline/role-id > "$W/approle/role_id"
vault write -f -field=secret_id auth/approle/role/ingest-pipeline/secret-id > "$W/approle/secret_id"
chmod 600 "$W/approle/"*

say "4.7 Comptes humains Vault (userpass)"
vault auth list -format=json | jq -e 'has("userpass/")' >/dev/null || vault auth enable userpass
for pair in alice:data-engineer samira:secops claire:dpo-auditor; do
  u=${pair%%:*}; pol=${pair##*:}
  vault kv get kv/datacorp/users/vault/$u >/dev/null 2>&1 || /lab/scripts/new-password.sh vault "$u"
  vault write "auth/userpass/users/$u" password="$(vault kv get -field=password kv/datacorp/users/vault/$u)" \
    token_policies="$pol" token_ttl=8h >/dev/null
done

say "4.7 Exécution du pipeline avec injection dynamique des secrets"
/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/producer.py 50
/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py

say "4.9 Décommissionnement du compte historique"
/lab/scripts/pg-admin.sh -q -c "ALTER ROLE legacy_etl NOLOGIN PASSWORD NULL" \
  -c "REVOKE ALL ON ALL TABLES IN SCHEMA rh, finance FROM legacy_etl"

say "Vérifications"
/lab/scripts/pg-admin.sh -c "SELECT source, count(*), count(*) FILTER (WHERE iban_contrepartie LIKE 'vault:%') AS chiffres FROM finance.transactions GROUP BY 1"
mc ls --recursive dc/raw-data | tail -3
echo "TP1 : OK"
