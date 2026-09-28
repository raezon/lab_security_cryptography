#!/usr/bin/env bash
# Fait confiance à la CA interne du lab (si elle a déjà été générée)
if [ -f /certs/ca.crt ]; then
  cp /certs/ca.crt /usr/local/share/ca-certificates/datacorp-lab-ca.crt
  update-ca-certificates >/dev/null 2>&1 || true
  mkdir -p /root/.mc/certs/CAs && cp /certs/ca.crt /root/.mc/certs/CAs/datacorp-lab-ca.crt
fi
exec "$@"
