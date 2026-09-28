#!/usr/bin/env bash
# =============================================================================
#  new-password.sh <système> <login>
#  Génère un mot de passe robuste et le range dans Vault :
#     kv/datacorp/users/<système>/<login>   (champ "password")
#  Le mot de passe n'est JAMAIS affiché à l'écran ni écrit sur disque.
#
#  Exemples :  new-password.sh pg alice      new-password.sh minio bruno
#  Relire :    vault kv get -field=password kv/datacorp/users/pg/alice
# =============================================================================
set -euo pipefail
sys=${1:?système (pg|minio|vault)} ; login=${2:?login}
pw=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-24)
vault kv put -mount=kv "datacorp/users/$sys/$login" password="$pw" >/dev/null
echo "[ok] mot de passe de '$login' ($sys) stocké dans Vault : kv/datacorp/users/$sys/$login"
