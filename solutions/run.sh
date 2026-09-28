#!/usr/bin/env bash
# =============================================================================
#  run.sh — accélérateur FORMATEUR (à lancer sur l'hôte, à la racine du lab)
#    ./solutions/run.sh tp1      # état "fin de TP1"
#    ./solutions/run.sh tp2      # état "fin de TP2" (nécessite tp1)
#    ./solutions/run.sh tp3      # état "fin de TP3" (nécessite tp2)
#    ./solutions/run.sh all
#  Utile pour : démonstration, rattrapage d'un binôme, démarrer directement au TP2/TP3.
#  Le dossier solutions/ n'est PAS monté dans la toolbox des apprenants.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

tb() {  # exécute un script de solution dans la toolbox
  docker compose exec -T \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -e VAULT_DB_ADMIN_PASSWORD="$VAULT_DB_ADMIN_PASSWORD" \
    -e MINIO_ROOT_USER="$MINIO_ROOT_USER" -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
    -e RABBITMQ_ADMIN_USER="$RABBITMQ_ADMIN_USER" -e RABBITMQ_ADMIN_PASSWORD="$RABBITMQ_ADMIN_PASSWORD" \
    -e AUDIT_TOKEN="$AUDIT_TOKEN" toolbox bash -s < "$1"
}
pgsu() { docker compose exec -T -u postgres postgres psql -v ON_ERROR_STOP=1 -d datacorp "$@"; }

tp1() { tb solutions/tp1-solution.sh; }
tp2() {
  local args=()
  for u in alice bruno claire david samira nadia; do
    docker compose exec -T toolbox bash -c "vault kv get kv/datacorp/users/pg/$u >/dev/null 2>&1 || /lab/scripts/new-password.sh pg $u"
    args+=(-v "pw_$u=$(docker compose exec -T toolbox vault kv get -field=password kv/datacorp/users/pg/$u)")
  done
  pgsu "${args[@]}" < solutions/tp2-rbac.sql
  tb solutions/tp2-minio.sh
}
tp3() { pgsu < solutions/tp3-audit.sql; tb solutions/tp3-solution.sh; }

case "${1:-}" in
  tp1) tp1 ;;
  tp2) tp2 ;;
  tp3) tp3 ;;
  all) tp1; tp2; tp3 ;;
  *) echo "usage: $0 tp1|tp2|tp3|all" >&2; exit 1 ;;
esac
