#!/usr/bin/env bash
# =============================================================================
#  vault-unseal.sh — descelle Vault après un redémarrage (lab uniquement)
#
#  ⚠ Dans le lab, les 5 fragments de clé de Shamir sont stockés ENSEMBLE dans
#    /lab/work/vault-init.json pour gagner du temps. En production, chaque
#    fragment est remis à une personne différente (ou on utilise l'auto-unseal
#    via un KMS/HSM) — c'est tout l'intérêt du partage de secret de Shamir.
# =============================================================================
set -euo pipefail
INIT=${1:-/lab/work/vault-init.json}
[ -r "$INIT" ] || { echo "Fichier $INIT introuvable (Vault a-t-il été initialisé ? TP1 §4.2)" >&2; exit 1; }

threshold=$(jq -r '.unseal_threshold' "$INIT")
for i in $(seq 0 $((threshold - 1))); do
  vault operator unseal "$(jq -r ".unseal_keys_b64[$i]" "$INIT")" >/dev/null
  echo "[unseal] fragment $((i + 1))/$threshold appliqué"
done
vault status | grep -E "Sealed|Total Shares|Threshold"
