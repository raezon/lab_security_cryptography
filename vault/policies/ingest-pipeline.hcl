# =============================================================================
#  Politique Vault : ingest-pipeline
#  Identité : AppRole "ingest-pipeline" (le pipeline RabbitMQ -> PostgreSQL/MinIO)
#  Principe du moindre privilège : le pipeline peut CHIFFRER mais pas DÉCHIFFRER,
#  obtenir des identifiants éphémères INSERT-only, lire SON secret MinIO.
# =============================================================================

# Identifiants PostgreSQL dynamiques (rôle app_ingest = INSERT uniquement)
path "database/creds/app-ingest" {
  capabilities = ["read"]
}

# Identifiants RabbitMQ dynamiques
path "rabbitmq/creds/pipeline" {
  capabilities = ["read"]
}

# Chiffrement applicatif des IBAN (encryption as a service)
path "transit/encrypt/datacorp-pii" {
  capabilities = ["update"]
}

# Compte de service MinIO du pipeline (secret statique, rotation manuelle)
path "kv/data/datacorp/minio/svc-ingest" {
  capabilities = ["read"]
}

# Le pipeline peut renouveler / révoquer ses propres baux
path "sys/leases/renew" {
  capabilities = ["update"]
}
path "sys/leases/revoke" {
  capabilities = ["update"]
}
