# =============================================================================
#  Politique Vault : data-engineer (Alice)
#  Développe et exploite le pipeline, sans accès aux IBAN en clair.
# =============================================================================

# Tester le pipeline avec les mêmes droits que lui
path "database/creds/app-ingest" {
  capabilities = ["read"]
}
path "rabbitmq/creds/pipeline" {
  capabilities = ["read"]
}
path "transit/encrypt/datacorp-pii" {
  capabilities = ["update"]
}

# Lire la configuration AppRole du pipeline (role_id) et générer un secret_id
path "auth/approle/role/ingest-pipeline/role-id" {
  capabilities = ["read"]
}
path "auth/approle/role/ingest-pipeline/secret-id" {
  capabilities = ["update"]
}

# Secrets de l'équipe data (lecture / écriture)
path "kv/data/datacorp/data-team/*" {
  capabilities = ["create", "read", "update", "list"]
}
path "kv/metadata/datacorp/data-team/*" {
  capabilities = ["list", "read"]
}

# Refus explicite : jamais de déchiffrement des IBAN
path "transit/decrypt/*" {
  capabilities = ["deny"]
}
