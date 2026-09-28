#!/usr/bin/env bash
# =============================================================================
#  TP2 — Étape 6 : RBAC du stockage objet MinIO
#  Crée la zone "curated" (chiffrée), charge les politiques JSON de
#  /lab/minio-policies, crée alice / bruno / claire et les range dans des
#  groupes. Les droits sont donnés aux GROUPES, jamais aux personnes.
# =============================================================================
set -euo pipefail
pw() { vault kv get -field=password "kv/datacorp/users/$1/$2"; }
mc alias set dc https://minio:9000 "$(vault kv get -field=username kv/datacorp/break-glass/minio)" \
  "$(vault kv get -field=password kv/datacorp/break-glass/minio)" >/dev/null

mc mb --ignore-existing dc/curated >/dev/null && mc encrypt set sse-s3 dc/curated >/dev/null
for p in data-engineer data-analyst dpo-auditor; do
  mc admin policy create dc "$p" "/lab/minio-policies/$p.json" >/dev/null
done
declare -A GROUPE=( [alice]=data-engineers [bruno]=data-analysts [claire]=dpo )
declare -A POLITIQUE=( [data-engineers]=data-engineer [data-analysts]=data-analyst [dpo]=dpo-auditor )
for u in alice bruno claire; do
  vault kv get "kv/datacorp/users/minio/$u" >/dev/null 2>&1 || /lab/scripts/new-password.sh minio "$u" >/dev/null
  mc admin user add dc "$u" "$(pw minio "$u")" >/dev/null
  g=${GROUPE[$u]}
  mc admin group add dc "$g" "$u" >/dev/null
  mc admin policy attach dc "${POLITIQUE[$g]}" --group "$g" >/dev/null 2>&1 || true
  echo "[ok] $u -> groupe $g -> politique ${POLITIQUE[$g]}"
done
# Alias personnels pour les tests (identifiants lus dans Vault)
echo "export MC_HOST_alice=https://alice:$(pw minio alice)@minio:9000"   >  /root/.minio-alias
echo "export MC_HOST_bruno=https://bruno:$(pw minio bruno)@minio:9000"   >> /root/.minio-alias
chmod 600 /root/.minio-alias
echo "[ok] tapez  source /root/.minio-alias  pour agir en tant qu'alice ou bruno"
