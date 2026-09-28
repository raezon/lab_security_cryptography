#!/usr/bin/env bash
# =============================================================================
#  with-vault-creds.sh <commande> [arguments...]
#
#  "Injection dynamique de secrets" pour le pipeline d'ingestion :
#   1. s'authentifie auprès de Vault avec l'AppRole "ingest-pipeline"
#      (role_id + secret_id — aucun mot de passe applicatif en dur) ;
#   2. obtient des identifiants ÉPHÉMÈRES PostgreSQL et RabbitMQ, et le
#      compte de service MinIO ;
#   3. les injecte en variables d'environnement de la commande ;
#   4. révoque tout à la fin (même en cas d'erreur).
#
#  Exemple : /lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py
# =============================================================================
set -euo pipefail
: "${VAULT_ADDR:?VAULT_ADDR non défini}"
APPROLE_DIR=${APPROLE_DIR:-/lab/work/approle}

[ -r "$APPROLE_DIR/role_id" ] && [ -r "$APPROLE_DIR/secret_id" ] || {
  echo "[vault] role_id / secret_id introuvables dans $APPROLE_DIR (TP1 §4.7)" >&2; exit 1; }

# 1. Authentification AppRole -> jeton court (token_ttl=15m)
VAULT_TOKEN=$(vault write -field=token auth/approle/login \
                role_id="$(cat "$APPROLE_DIR/role_id")" \
                secret_id="$(cat "$APPROLE_DIR/secret_id")")
export VAULT_TOKEN

cleanup() {
  # Révoquer le jeton révoque aussi tous les baux qu'il a créés (identifiants PG/RabbitMQ)
  vault token revoke -self >/dev/null 2>&1 && echo "[vault] jeton et identifiants éphémères révoqués"
}
trap cleanup EXIT

# 2. PostgreSQL : utilisateur éphémère membre de app_ingest (INSERT uniquement)
pg=$(vault read -format=json database/creds/app-ingest)
PGUSER=$(jq -r .data.username <<<"$pg"); PGPASSWORD=$(jq -r .data.password <<<"$pg")
export PGUSER PGPASSWORD

# 3. RabbitMQ : utilisateur éphémère (permissions limitées à ingest.*)
rmq=$(vault read -format=json rabbitmq/creds/pipeline)
RABBITMQ_USER=$(jq -r .data.username <<<"$rmq"); RABBITMQ_PASSWORD=$(jq -r .data.password <<<"$rmq")
export RABBITMQ_USER RABBITMQ_PASSWORD

# 4. MinIO : compte de service (secret statique stocké dans KV v2)
MINIO_ACCESS_KEY=$(vault kv get -field=access_key kv/datacorp/minio/svc-ingest)
MINIO_SECRET_KEY=$(vault kv get -field=secret_key kv/datacorp/minio/svc-ingest)
export MC_HOST_dcingest="https://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000"

echo "[vault] identifiants éphémères : PostgreSQL=$PGUSER (TTL $(jq -r .lease_duration <<<"$pg")s), RabbitMQ=$RABBITMQ_USER"
"$@"
