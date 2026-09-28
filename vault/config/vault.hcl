# =============================================================================
#  HashiCorp Vault — configuration serveur du lab DataCorp Secure
#  Mode "server" (et non "-dev") : Vault démarre SCELLÉ (sealed) et doit être
#  initialisé puis descellé avec le partage de Shamir (TP1).
# =============================================================================

ui            = true
api_addr      = "https://vault:8200"
disable_mlock = true   # lab en conteneur ; en production : mlock actif (cap IPC_LOCK)
                       # pour empêcher l'écriture des secrets dans le swap

storage "file" {
  path = "/vault/file"  # production : stockage intégré "raft" en cluster de 3 ou 5 nœuds
}

# Chiffrement en transit : l'API Vault n'est exposée qu'en HTTPS
listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_cert_file   = "/certs/vault/server.crt"
  tls_key_file    = "/certs/vault/server.key"
  tls_min_version = "tls12"
}

default_lease_ttl = "1h"
max_lease_ttl     = "24h"
