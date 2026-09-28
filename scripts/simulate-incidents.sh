#!/usr/bin/env bash
# =============================================================================
#  simulate-incidents.sh — TP3 §4.4
#  Rejoue une "nuit agitée" chez DataCorp Secure : génère dans les trois
#  sources de journaux des événements suspects que les apprenants devront
#  détecter, qualifier et documenter dans le rapport d'audit.
#
#  Prérequis : TP1 et TP2 réalisés, session Vault administrateur ouverte.
#  ⚠ Le formateur peut garder ce script caché et ne donner que les journaux.
# =============================================================================
set -uo pipefail
pw() { vault kv get -field=password "kv/datacorp/users/$1/$2"; }
PG="host=${PGHOST:-postgres} dbname=datacorp sslmode=verify-full sslrootcert=/certs/ca.crt"
step() { printf "\n\e[33m[%s]\e[0m %s\n" "$1" "$2"; }

step "1/8" "Brute force : 8 mots de passe essayés sur le compte bruno"
for i in $(seq 1 8); do
  PGPASSWORD="Datacorp$i!" psql "$PG user=bruno" -c 'select 1' >/dev/null 2>&1
done

step "2/8" "Le compte historique legacy_etl (décommissionné) est réutilisé"
PGPASSWORD='DataCorp2019!' psql "$PG user=legacy_etl" -c 'select 1' 2>&1 | head -1

step "3/8" "Exfiltration : alice exporte tout l'annuaire RH + les IBAN clients ('pour tester')"
PGPASSWORD="$(pw pg alice)" psql "$PG user=alice" -q \
  -c "\copy (SELECT id, matricule, departement, poste, date_embauche FROM rh.employes) TO '/tmp/annuaire.csv' CSV" 2>&1 | head -1
PGPASSWORD="$(pw pg alice)" psql "$PG user=alice" -q -c "SELECT raison_sociale, iban FROM finance.clients" >/dev/null 2>&1

step "4/8" "bruno (analyste) sonde les tables brutes"
for q in "SELECT * FROM rh.employes" "SELECT * FROM finance.transactions" "SELECT * FROM securite.cles" "SELECT nir FROM rh.employes"; do
  PGPASSWORD="$(pw pg bruno)" psql "$PG user=bruno" -c "$q" >/dev/null 2>&1
done

step "5/8" "Escalade : bruno est ajouté puis retiré du groupe r_data_engineer (compte bris de glace)"
/lab/scripts/pg-admin.sh -q -c "GRANT r_data_engineer TO bruno" -c "SELECT pg_sleep(1)" -c "REVOKE r_data_engineer FROM bruno" >/dev/null

step "6/8" "MinIO : bruno tente de lire et d'écrire dans la zone brute"
export MC_HOST_bruno="https://bruno:$(pw minio bruno)@minio:9000"
mc ls bruno/raw-data/ >/dev/null 2>&1
mc ls --recursive bruno/raw-data/transactions/ >/dev/null 2>&1
echo "test" | mc pipe bruno/raw-data/transactions/intrus.txt >/dev/null 2>&1
mc cat bruno/raw-data/transactions/intrus.txt >/dev/null 2>&1

step "7/8" "MinIO : tentative d'effacement des journaux scellés (bucket WORM)"
OBJ=$(mc ls --recursive dc/audit-logs 2>/dev/null | awk '{print $NF}' | head -1)
if [ -n "$OBJ" ]; then mc rm "dc/audit-logs/$OBJ" 2>&1 | tail -1; else echo "  (aucun journal scellé : lancez d'abord seal-logs.sh)"; fi

step "8/8" "Vault : alice tente de déchiffrer un IBAN"
ALICE_TOKEN=$(vault login -token-only -method=userpass username=alice password="$(pw vault alice)")
CT=$(VAULT_TOKEN=$ALICE_TOKEN vault write -field=ciphertext transit/encrypt/datacorp-pii plaintext="$(echo -n FR7630001007941234567890185 | base64)")
VAULT_TOKEN=$ALICE_TOKEN vault write transit/decrypt/datacorp-pii ciphertext="$CT" 2>&1 | grep -m1 -i "denied" || true
VAULT_TOKEN=$ALICE_TOKEN vault token revoke -self >/dev/null

printf "\n\e[32mSimulation terminée.\e[0m Analysez maintenant les journaux (TP3 §4.5).\n"
