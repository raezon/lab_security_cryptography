#!/usr/bin/env bash
# =============================================================================
#  TP1 — Étape 6 : brancher tout le pipeline sur Vault (automatisé)
#  Lisez ce script : il applique aux autres briques ce que vous avez fait à la
#  main pour PostgreSQL.
#   a. RabbitMQ : identifiants dynamiques (moteur "rabbitmq")
#   b. MinIO    : bucket raw-data chiffré au repos + compte de service rangé dans Vault
#   c. Politiques Vault + identité machine du pipeline (AppRole)
#   d. Comptes Vault des personnes (alice, samira, claire)
#   e. Exécution du pipeline : producteur -> RabbitMQ -> consommateur
# =============================================================================
set -euo pipefail
kv() { vault kv get -field="$2" "kv/datacorp/break-glass/$1"; }
enable() { vault secrets list -format=json | jq -e --arg p "$1/" 'has($p)' >/dev/null || vault secrets enable -path="$1" "$1" >/dev/null; }

echo "a. RabbitMQ"
enable rabbitmq
vault write rabbitmq/config/connection connection_uri="https://rabbitmq:15671" \
  username="$(kv rabbitmq username)" password="$(kv rabbitmq password)" verify_connection=true >/dev/null
vault write rabbitmq/config/lease ttl=3600 max_ttl=14400 >/dev/null
vault write rabbitmq/roles/pipeline \
  vhosts='{"datacorp":{"configure":"^ingest\\..*","write":"^(amq\\.default|ingest\\..*)$","read":"^ingest\\..*"}}' >/dev/null

echo "b. MinIO"
mc alias set dc https://minio:9000 "$(kv minio username)" "$(kv minio password)" >/dev/null
mc mb --ignore-existing dc/raw-data >/dev/null
mc encrypt set sse-s3 dc/raw-data >/dev/null
mc admin policy create dc ingest-writer /lab/minio-policies/ingest-writer.json >/dev/null
if ! vault kv get kv/datacorp/minio/svc-ingest >/dev/null 2>&1; then
  SVC=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
  mc admin user add dc svc-ingest "$SVC" >/dev/null
  vault kv put -mount=kv datacorp/minio/svc-ingest access_key=svc-ingest secret_key="$SVC" >/dev/null
fi
mc admin policy attach dc ingest-writer --user svc-ingest >/dev/null 2>&1 || true

echo "c. Politiques + AppRole"
for p in /lab/vault-policies/*.hcl; do vault policy write "$(basename "$p" .hcl)" "$p" >/dev/null; done
vault write database/roles/app-readonly db_name=datacorp \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE app_readonly;" \
  revocation_statements="REVOKE app_readonly FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl=1h max_ttl=8h >/dev/null
vault auth list -format=json | jq -e 'has("approle/")' >/dev/null || vault auth enable approle >/dev/null
vault write auth/approle/role/ingest-pipeline token_policies=ingest-pipeline \
  token_ttl=15m token_max_ttl=1h secret_id_ttl=720h >/dev/null
mkdir -p /lab/work/approle && chmod 700 /lab/work/approle
vault read -field=role_id auth/approle/role/ingest-pipeline/role-id > /lab/work/approle/role_id
vault write -f -field=secret_id auth/approle/role/ingest-pipeline/secret-id > /lab/work/approle/secret_id
chmod 600 /lab/work/approle/*

echo "d. Comptes Vault des personnes"
vault auth list -format=json | jq -e 'has("userpass/")' >/dev/null || vault auth enable userpass >/dev/null
for pair in alice:data-engineer samira:secops claire:dpo-auditor; do
  u=${pair%%:*}; pol=${pair##*:}
  vault kv get "kv/datacorp/users/vault/$u" >/dev/null 2>&1 || /lab/scripts/new-password.sh vault "$u" >/dev/null
  vault write "auth/userpass/users/$u" token_policies="$pol" token_ttl=8h \
    password="$(vault kv get -field=password "kv/datacorp/users/vault/$u")" >/dev/null
done

echo "e. Pipeline"
/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/producer.py 50
/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py
echo "[ok] pipeline branché sur Vault"
