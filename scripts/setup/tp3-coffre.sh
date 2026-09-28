#!/usr/bin/env bash
# =============================================================================
#  TP3 — Étape 2 : collecte des journaux MinIO + coffre de preuves WORM
#   a. MinIO envoie chaque appel S3 au collecteur audit-sink (webhook d'audit)
#   b. bucket "audit-logs" en Object Lock : rien ne peut y être effacé pendant 30 j
#   c. compte de service "svc-logs" : peut DÉPOSER des journaux, jamais les supprimer
#  Le jeton partagé est la variable AUDIT_TOKEN du fichier .env (sur l'hôte).
# =============================================================================
set -euo pipefail
if [ -z "${AUDIT_TOKEN:-}" ]; then read -rsp "AUDIT_TOKEN (voir .env) : " AUDIT_TOKEN; echo; fi
mc alias set dc https://minio:9000 "$(vault kv get -field=username kv/datacorp/break-glass/minio)" \
  "$(vault kv get -field=password kv/datacorp/break-glass/minio)" >/dev/null

echo "a. Webhook d'audit"
mc admin config set dc audit_webhook:siem endpoint="http://audit-sink:8088/minio" auth_token="$AUDIT_TOKEN" enable=on
mc admin service restart dc >/dev/null; sleep 5

echo "b. Coffre WORM"
mc mb --ignore-existing --with-lock dc/audit-logs >/dev/null
mc retention set --default GOVERNANCE 30d dc/audit-logs >/dev/null
mc retention info --default dc/audit-logs

echo "c. Compte de dépôt"
mc admin policy create dc log-shipper /lab/minio-policies/log-shipper.json >/dev/null
if ! vault kv get kv/datacorp/minio/log-shipper >/dev/null 2>&1; then
  S=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
  mc admin user add dc svc-logs "$S" >/dev/null
  vault kv put -mount=kv datacorp/minio/log-shipper access_key=svc-logs secret_key="$S" >/dev/null
fi
mc admin policy attach dc log-shipper --user svc-logs >/dev/null 2>&1 || true
echo "[ok] collecte MinIO active, coffre audit-logs prêt"
