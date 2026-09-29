#!/usr/bin/env bash
# Prend les captures d'écran des cours (Vault, MinIO, RabbitMQ) et reconstruit la console.
#
#   ./scripts/captures-cours.sh [domaine]      (défaut : 158-178-196-145.sslip.io)
#
# ⚠ Se connecte aux interfaces d'administration avec le jeton root de Vault et les
#   comptes admin du .env (passés en variables d'environnement, jamais affichés).
#   Les captures sont publiques dans la console : vérifiez qu'aucun secret n'y apparaît
#   avant de les publier (le script ne révèle pas les valeurs KV, mais un message
#   RabbitMQ contient un IBAN fictif en clair — c'est le but de la capture 5).
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:-158-178-196-145.sslip.io}"
g() { grep "^$1=" .env | cut -d= -f2-; }
OUT="$PWD/webapp/static/cours"
mkdir -p "$OUT" work/.pw
cp scripts/captures-cours.js work/.pw/
docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD/work/.pw:/w" -v "$OUT:/out" -w /w -e DOMAIN="$DOMAIN" \
  -e VTOKEN="$(docker exec "${STACK:-dc}-toolbox" jq -r .root_token /lab/work/vault-init.json)" \
  -e MUSER="$(g MINIO_ROOT_USER)" -e MPASS="$(g MINIO_ROOT_PASSWORD)" \
  -e RUSER="$(g RABBITMQ_ADMIN_USER)" -e RPASS="$(g RABBITMQ_ADMIN_PASSWORD)" \
  mcr.microsoft.com/playwright:v1.49.0-jammy \
  bash -c "[ -d node_modules/playwright ] || npm i --silent playwright@1.49.0 >/dev/null 2>&1; node captures-cours.js"
rm -f "$OUT/sources.json"   # vraies captures du lab : plus de crédit « documentation officielle »
ls -1 "$OUT"
docker compose up -d --build --no-deps lab-console
echo "✓ Captures intégrées : ouvrez la console → 📚 Cours."
