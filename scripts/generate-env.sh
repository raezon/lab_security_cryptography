#!/usr/bin/env bash
# Génère un fichier .env avec des secrets aléatoires à partir de .env.example
# Usage (depuis la racine du lab) : ./scripts/generate-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env existe déjà — supprimez-le d'abord si vous voulez le régénérer." >&2
  exit 1
fi

rnd() { openssl rand -base64 24 | tr -d '/+=' | cut -c1-24; }

sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rnd)|" \
  -e "s|^VAULT_DB_ADMIN_PASSWORD=.*|VAULT_DB_ADMIN_PASSWORD=$(rnd)|" \
  -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$(rnd)|" \
  -e "s|^MINIO_KMS_SECRET_KEY=.*|MINIO_KMS_SECRET_KEY=datacorp-sse-key:$(openssl rand -base64 32)|" \
  -e "s|^RABBITMQ_ADMIN_PASSWORD=.*|RABBITMQ_ADMIN_PASSWORD=$(rnd)|" \
  -e "s|^AUDIT_TOKEN=.*|AUDIT_TOKEN=$(rnd)|" \
  .env.example > .env
chmod 600 .env
echo "[ok] .env généré (droits 600). Ne le commitez jamais."
