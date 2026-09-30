# =============================================================================
#  Politique Vault : dpo-auditor (Claire — DPO)
#  Vérifie QUI a accès à QUOI (revue des habilitations), sans accès aux secrets.
# =============================================================================
path "sys/policies/acl" {
  capabilities = ["list"]
}
path "sys/policies/acl/*" {
  capabilities = ["read"]
}
path "sys/auth" {
  capabilities = ["read"]
}
path "sys/mounts" {
  capabilities = ["read"]
}
path "auth/userpass/users" {
  capabilities = ["list"]
}
path "auth/userpass/users/*" {
  capabilities = ["read"]
}
path "auth/approle/role" {
  capabilities = ["list"]
}
path "auth/approle/role/*" {
  capabilities = ["read"]
}
path "transit/keys/datacorp-pii" {
  capabilities = ["read"]      # métadonnées de clé : versions, date de rotation (pas la clé)
}

# Navigation dans l interface web : lister les cles transit pour atteindre datacorp-pii
path "transit/keys/" {
  capabilities = ["list"]
}
