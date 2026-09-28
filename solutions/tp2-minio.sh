#!/usr/bin/env bash
# =============================================================================
#  TP2 — CORRIGÉ FORMATEUR, partie MinIO + publication (dans la toolbox)
#  Prérequis : tp1-solution.sh et tp2-rbac.sql exécutés.
# =============================================================================
set -euo pipefail
say() { printf "\n\e[36m== %s ==\e[0m\n" "$*"; }
pw()  { vault kv get -field=password "kv/datacorp/users/$1/$2"; }
MR_U=$(vault kv get -field=username kv/datacorp/break-glass/minio)
MR_P=$(vault kv get -field=password kv/datacorp/break-glass/minio)
mc alias set dc https://minio:9000 "$MR_U" "$MR_P" >/dev/null

say "4.6 Zone curated + politiques"
mc mb --ignore-existing dc/curated
mc encrypt set sse-s3 dc/curated
for p in data-engineer data-analyst dpo-auditor; do
  mc admin policy create dc "$p" "/lab/minio-policies/$p.json"
done

say "4.6 Utilisateurs et groupes"
for pair in alice:data-engineers bruno:data-analysts claire:dpo; do
  u=${pair%%:*}; g=${pair##*:}
  vault kv get kv/datacorp/users/minio/$u >/dev/null 2>&1 || /lab/scripts/new-password.sh minio "$u"
  mc admin user add dc "$u" "$(pw minio "$u")"
  mc admin group add dc "$g" "$u"
done
mc admin policy attach dc data-engineer --group data-engineers 2>/dev/null || true
mc admin policy attach dc data-analyst  --group data-analysts  2>/dev/null || true
mc admin policy attach dc dpo-auditor   --group dpo            2>/dev/null || true

say "4.5 Validation DPO puis publication des vues"
export PGSSLMODE=verify-full
for v in analytics.v_employes analytics.v_transactions analytics.v_salaires_par_departement; do
  PGPASSWORD="$(pw pg claire)" psql -U claire -q -c \
    "INSERT INTO gouvernance.validations_dpo (objet, decision, commentaire) VALUES ('$v','APPROUVE','Conforme art. 25 & 32 RGPD - k>=5, pas d''identifiant direct')"
  PGPASSWORD="$(pw pg alice)" psql -U alice -At -c "SELECT analytics.publier_vue('$v')"
done

say "4.7 Export d'un jeu curated (pseudonymisé) par la Data Engineer"
PGPASSWORD="$(pw pg alice)" psql -U alice -q \
  -c "\copy (SELECT * FROM analytics.v_employes) TO '/tmp/v_employes.csv' CSV HEADER"
export MC_HOST_alice="https://alice:$(pw minio alice)@minio:9000"
mc cp --quiet /tmp/v_employes.csv "alice/curated/rh/v_employes_$(date +%F).csv"
rm -f /tmp/v_employes.csv

say "Tests de la matrice d'habilitations"
export MC_HOST_bruno="https://bruno:$(pw minio bruno)@minio:9000"
mc ls bruno/curated/rh/ && echo "  bruno lit curated : OK (attendu)"
mc ls bruno/raw-data/ 2>/dev/null && echo "  !! bruno lit raw-data" || echo "  bruno refusé sur raw-data : OK (attendu)"
PGPASSWORD="$(pw pg bruno)" psql -U bruno -c "SELECT count(*) FROM analytics.v_employes"
echo "TP2 : OK"
