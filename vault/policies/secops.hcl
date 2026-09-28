# =============================================================================
#  Politique Vault : secops (Samira — Data Security Engineer)
#  Administre les moteurs de secrets et les clés, sans lire les secrets métier.
# =============================================================================

# Gestion des clés de chiffrement (création, rotation, configuration)
path "transit/keys/*" {
  capabilities = ["create", "read", "update", "list"]
}
path "transit/keys/+/rotate" {
  capabilities = ["update"]
}
path "transit/rewrap/*" {
  capabilities = ["update"]
}

# Configuration des rôles dynamiques PostgreSQL / RabbitMQ
path "database/roles/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "database/config/*" {
  capabilities = ["read", "list"]
}
path "database/rotate-root/*" {
  capabilities = ["update"]
}
path "rabbitmq/roles/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Révocation d'urgence (incident) : tous les baux d'un moteur
path "sys/leases/revoke-prefix/*" {
  capabilities = ["update", "sudo"]
}
path "sys/leases/lookup/*" {
  capabilities = ["list", "sudo"]
}

# Politiques : lecture / écriture
path "sys/policies/acl/*" {
  capabilities = ["create", "read", "update", "list"]
}

# Audit devices : consultation
path "sys/audit" {
  capabilities = ["read", "sudo"]
}

# Pas de lecture des secrets KV ni de déchiffrement
path "kv/data/*" {
  capabilities = ["deny"]
}
path "transit/decrypt/*" {
  capabilities = ["deny"]
}
