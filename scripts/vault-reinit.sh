#!/usr/bin/env bash
# =============================================================================
#  vault-reinit.sh — réinitialise UNIQUEMENT Vault (nouvelles clés + jeton root)
#  quand work/vault-init.json a été perdu, sans toucher aux autres services.
#
#  Usage (sur l'hôte, à la racine du dépôt) :   ./scripts/vault-reinit.sh
#
#   1. déchiffre les IBAN encore chiffrés avec l'ANCIENNE clé transit
#      (tant que l'ancien Vault est ouvert) pour ne perdre aucune donnée ;
#   2. efface le volume Vault et les fichiers work/ associés ;
#   3. remet le mot de passe de vault_admin (roté par Vault au TP1 · étape 4) ;
#   4. redémarre Vault + la console, puis rejoue via la console les étapes
#      déjà faites par la classe (TP1 · 2→6, TP2 · 2) : nouvelles clés dans
#      work/vault-init.json et IBAN rechiffrés avec la nouvelle clé transit.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
P=${COMPOSE_PROJECT_NAME:-datacorp}; TB=${STACK:-dc}-toolbox; PG=${STACK:-dc}-postgres
CONSOLE=http://127.0.0.1:${CONSOLE_PORT:-8085}
STEPS=${STEPS:-"tp1-2 tp1-3 tp1-4 tp1-5 tp1-6 tp2-2"}

echo "== 1/4 Déchiffrement des IBAN avec l'ancienne clé transit"
if docker exec "$TB" vault token lookup >/dev/null 2>&1; then
  docker exec -i -e PGPW="$POSTGRES_PASSWORD" "$TB" python3 - <<'EOF'
import base64, os, psycopg2, requests
V = os.environ["VAULT_ADDR"]; CA = os.environ["VAULT_CACERT"]
T = open("/root/.vault-token").read().strip()
TABLES = [("rh.employes", "iban"), ("finance.clients", "iban"), ("finance.transactions", "iban_contrepartie")]
conn = psycopg2.connect(user="postgres", password=os.environ["PGPW"])
with conn, conn.cursor() as cur:
    for t, c in TABLES:
        cur.execute(f"SELECT id, {c} FROM {t} WHERE {c} LIKE 'vault:%%'")
        rows = cur.fetchall()
        for i in range(0, len(rows), 100):
            ch = rows[i:i + 100]
            r = requests.post(f"{V}/v1/transit/decrypt/datacorp-pii", verify=CA, timeout=30,
                              headers={"X-Vault-Token": T},
                              json={"batch_input": [{"ciphertext": x[1]} for x in ch]})
            r.raise_for_status()
            res = r.json()["data"]["batch_results"]
            if any(x.get("error") for x in res):
                raise SystemExit(f"déchiffrement refusé : {res[:2]}")
            cur.executemany(f"UPDATE {t} SET {c} = %s WHERE id = %s",
                            [(base64.b64decode(x["plaintext"]).decode(), row[0]) for x, row in zip(res, ch)])
        print(f"   {t}.{c} : {len(rows)} valeur(s) remise(s) en clair")
EOF
else
  echo "   ⚠ pas de session Vault valide dans la toolbox : IBAN déjà chiffrés NON récupérables (ignoré)"
fi

echo "== 2/4 Effacement de Vault (volume + work/vault-init.json)"
docker compose stop vault >/dev/null
docker compose rm -f vault >/dev/null
docker volume rm "${P}_vault-data" >/dev/null
docker exec "$TB" rm -f /lab/work/vault-init.json /lab/work/.vault-init.bak.json /root/.vault-token
docker exec "$TB" sh -c 'rm -rf /lab/work/approle/*'

echo "== 3/4 Mot de passe vault_admin + comptes dynamiques orphelins"
docker exec -i -u postgres "$PG" psql -q -U postgres -d datacorp -v pw="$VAULT_DB_ADMIN_PASSWORD" <<'EOF'
ALTER ROLE vault_admin PASSWORD :'pw';
DO $$ DECLARE r text; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'v-%' LOOP
    BEGIN EXECUTE format('DROP ROLE %I', r); EXCEPTION WHEN others THEN RAISE NOTICE 'rôle % conservé : %', r, SQLERRM; END;
  END LOOP; END $$;
EOF

echo "== 4/4 Redémarrage de Vault et de la console, puis rejeu des étapes : $STEPS"
docker compose up -d vault >/dev/null
docker compose up -d --build lab-console >/dev/null
for i in $(seq 30); do   # vault status : 2 = scellé (attendu), 1 = injoignable
  curl -sf -o /dev/null "$CONSOLE/" && docker exec "$TB" sh -c 'vault status >/dev/null 2>&1; [ $? -eq 2 ]' && break
  [ "$i" = 30 ] && { echo "Vault ou la console ne répond pas" >&2; exit 1; }; sleep 2
done
for id in $STEPS; do
  res=$(curl -sN -X POST -H "X-Etudiant: formateur%20(r%C3%A9init%20Vault)" "$CONSOLE/api/run/$id" | tail -1)
  printf '   %-6s %s\n' "$id" "$(jq -r '.status // "?"' <<<"$res" 2>/dev/null || echo "$res")"
done
docker exec "$TB" vault-cles | tail -2
echo "Terminé. Nouveau jeton root et clés : bouton « Identifiants » de la console (ou : docker exec $TB vault-cles)."
