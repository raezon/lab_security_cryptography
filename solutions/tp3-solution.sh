#!/usr/bin/env bash
# =============================================================================
#  TP3 — CORRIGÉ FORMATEUR, partie MinIO / scellement / détection (toolbox)
#  Prérequis : tp3-audit.sql exécuté côté PostgreSQL. Variable : AUDIT_TOKEN
# =============================================================================
set -euo pipefail
say() { printf "\n\e[36m== %s ==\e[0m\n" "$*"; }
mc alias set dc https://minio:9000 "$(vault kv get -field=username kv/datacorp/break-glass/minio)" \
  "$(vault kv get -field=password kv/datacorp/break-glass/minio)" >/dev/null

say "4.2 Webhook d'audit MinIO -> audit-sink"
mc admin config set dc audit_webhook:siem endpoint="http://audit-sink:8088/minio" auth_token="$AUDIT_TOKEN" enable=on
mc admin service restart dc
sleep 5
mc admin config get dc audit_webhook

say "4.3 Coffre de journaux WORM (Object Lock)"
mc mb --ignore-existing --with-lock dc/audit-logs
mc retention set --default GOVERNANCE 30d dc/audit-logs
mc admin policy create dc log-shipper /lab/minio-policies/log-shipper.json
if ! vault kv get kv/datacorp/minio/log-shipper >/dev/null 2>&1; then
  S=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
  mc admin user add dc svc-logs "$S"
  vault kv put -mount=kv datacorp/minio/log-shipper access_key=svc-logs secret_key="$S" >/dev/null
fi
mc admin policy attach dc log-shipper --user svc-logs 2>/dev/null || true

say "4.4 Scellement initial, simulation d'incidents, détection"
/lab/scripts/seal-logs.sh
/lab/scripts/simulate-incidents.sh
sleep 2
python3 /lab/scripts/detect.py
/lab/scripts/seal-logs.sh
echo "TP3 : OK"
