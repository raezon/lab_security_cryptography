#!/usr/bin/env bash
# =============================================================================
#  check-stack.sh — vérifie que chaque service répond et présente un
#  certificat TLS valide signé par la CA du lab.
#  Usage (dans la toolbox) : /lab/scripts/check-stack.sh
# =============================================================================
CA=/certs/ca.crt
ok()   { printf "  \e[32m[OK]\e[0m  %s\n" "$*"; }
ko()   { printf "  \e[31m[KO]\e[0m  %s\n" "$*"; }

tls_check() {  # tls_check <nom> <hôte:port> [option starttls]
  local name=$1 target=$2 starttls=${3:-}
  local out
  out=$(timeout 8 openssl s_client -connect "$target" -servername "${target%%:*}" \
          -CAfile "$CA" -verify_return_error ${starttls:+-starttls $starttls} </dev/null 2>&1)
  if grep -q "Verify return code: 0 (ok)" <<<"$out"; then
    ok "$name ($target) — TLS $(grep -m1 -oE 'TLSv1\.[23]' <<<"$out") — certificat vérifié"
  else
    ko "$name ($target) — TLS non vérifié ou service indisponible"
  fi
}

echo "== Chiffrement en transit (TLS) =="
tls_check "PostgreSQL" postgres:5432 postgres
tls_check "Vault"      vault:8200
tls_check "MinIO"      minio:9000
tls_check "RabbitMQ"   rabbitmq:5671
tls_check "RabbitMQ management" rabbitmq:15671

echo "== État des services =="
if pg_isready -q -h postgres; then ok "PostgreSQL accepte les connexions"; else ko "PostgreSQL"; fi

vstatus=$(vault status -format=json 2>/dev/null)
if [ -n "$vstatus" ]; then
  init=$(jq -r .initialized <<<"$vstatus"); sealed=$(jq -r .sealed <<<"$vstatus")
  ok "Vault joignable — initialisé=$init, scellé=$sealed"
  [ "$sealed" = "true" ] && echo "        → Vault est scellé : voir TP1 §4.2 (ou /lab/scripts/vault-unseal.sh)"
else
  ko "Vault injoignable"
fi

code=$(curl -s -o /dev/null -w "%{http_code}" https://minio:9000/minio/health/live)
[ "$code" = "200" ] && ok "MinIO vivant (health/live)" || ko "MinIO (HTTP $code)"

code=$(curl -s -o /dev/null -w "%{http_code}" http://audit-sink:8088/)
[ "$code" = "200" ] && ok "audit-sink (SIEM simulé) joignable" || ko "audit-sink (HTTP $code)"
