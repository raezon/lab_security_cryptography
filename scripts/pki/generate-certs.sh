#!/usr/bin/env bash
# =============================================================================
#  PKI du lab DataCorp Secure
#  Génère une autorité de certification (CA) interne + un certificat serveur
#  par service. Exécuté une seule fois par le conteneur "certs-init".
#  Idempotent : ne régénère rien si la CA existe déjà.
# =============================================================================
set -euo pipefail
OUT="${CERTS_DIR:-/certs}"
DAYS=365

if [ -f "$OUT/ca.crt" ]; then
  echo "[pki] certificats déjà présents dans $OUT — rien à faire"
  exit 0
fi
mkdir -p "$OUT"

echo "[pki] création de la CA DataCorp Lab Root CA (RSA 4096)"
openssl req -x509 -newkey rsa:4096 -sha256 -days $((DAYS*5)) -nodes \
  -keyout "$OUT/ca.key" -out "$OUT/ca.crt" \
  -subj "/C=FR/O=DataCorp Secure/OU=Lab PKI/CN=DataCorp Lab Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

# gen <service> <uid> <gid> <crt_name> <key_name> <subjectAltName>
gen() {
  local name=$1 uid=$2 gid=$3 crt=$4 key=$5 san=$6
  local d="$OUT/$name"
  mkdir -p "$d"
  openssl req -newkey rsa:2048 -nodes -keyout "$d/$key" -out "$d/server.csr" \
    -subj "/C=FR/O=DataCorp Secure/OU=$name/CN=$name" 2>/dev/null
  cat > "$d/ext.cnf" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
  openssl x509 -req -in "$d/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
    -CAcreateserial -out "$d/$crt" -days $DAYS -sha256 -extfile "$d/ext.cnf" 2>/dev/null
  cp "$OUT/ca.crt" "$d/ca.crt"
  rm -f "$d/server.csr" "$d/ext.cnf"
  chown -R "$uid:$gid" "$d"
  chmod 750 "$d"
  chmod 600 "$d/$key"
  chmod 644 "$d/$crt" "$d/ca.crt"
  echo "[pki] certificat émis pour $name ($san)"
}

# uid/gid = utilisateur qui fait tourner le service dans son image officielle
gen postgres 999 999  server.crt server.key  "DNS:postgres,DNS:localhost,IP:127.0.0.1"
gen vault    100 1000 server.crt server.key  "DNS:vault,DNS:localhost,IP:127.0.0.1"
gen rabbitmq 999 999  server.crt server.key  "DNS:rabbitmq,DNS:localhost,IP:127.0.0.1"
# MinIO attend public.crt / private.key et les CA de confiance dans CAs/
gen minio    0   0    public.crt private.key "DNS:minio,DNS:localhost,IP:127.0.0.1"
mkdir -p "$OUT/minio/CAs" && cp "$OUT/ca.crt" "$OUT/minio/CAs/datacorp-ca.crt"

chmod 600 "$OUT/ca.key"          # clé privée de la CA : jamais distribuée
chmod 644 "$OUT/ca.crt"
chmod 755 "$OUT"
rm -f "$OUT/ca.srl"
echo "[pki] terminé"
