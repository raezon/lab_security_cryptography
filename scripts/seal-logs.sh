#!/usr/bin/env bash
# =============================================================================
#  seal-logs.sh — scellement des journaux d'audit (TP3 §4.5)
#   1. archive horodatée des journaux PostgreSQL, Vault et MinIO ;
#   2. empreinte SHA-256 de l'archive ;
#   3. chaînage : chaque maillon = SHA-256(maillon précédent + empreinte) ;
#   4. dépôt dans le bucket WORM "audit-logs" (Object Lock) avec le compte
#      de service "svc-logs" (droit d'écrire, jamais de supprimer).
# =============================================================================
set -euo pipefail
OUT=/lab/work/scelles
mkdir -p "$OUT"
TS=$(date +%Y%m%dT%H%M%S)
ARCH="$OUT/journaux-$TS.tar.gz"

# Compte de service dédié, lu dans Vault (jamais en dur)
AK=$(vault kv get -field=access_key kv/datacorp/minio/log-shipper)
SK=$(vault kv get -field=secret_key kv/datacorp/minio/log-shipper)
export MC_HOST_dcshipper="https://${AK}:${SK}@minio:9000"

tar -czf "$ARCH" -C / logs/postgres logs/vault logs/minio 2>/dev/null
( cd "$OUT" && sha256sum "$(basename "$ARCH")" > "$(basename "$ARCH").sha256" )
EMPREINTE=$(cut -d' ' -f1 "$ARCH.sha256")

if [ -s "$OUT/chaine.txt" ]; then PREV=$(tail -1 "$OUT/chaine.txt" | cut -d' ' -f1); else PREV=GENESIS; fi
MAILLON=$(printf '%s%s' "$PREV" "$EMPREINTE" | sha256sum | cut -d' ' -f1)
echo "$MAILLON $TS $(basename "$ARCH") $EMPREINTE" >> "$OUT/chaine.txt"

mc cp --quiet "$ARCH" "$ARCH.sha256" "$OUT/chaine.txt" "dcshipper/audit-logs/$TS/"
echo "[scellement] archive   : $(basename "$ARCH")"
echo "[scellement] SHA-256   : $EMPREINTE"
echo "[scellement] maillon   : $MAILLON (précédent : ${PREV:0:16}...)"
echo "[scellement] déposé dans audit-logs/$TS/ (WORM)"
