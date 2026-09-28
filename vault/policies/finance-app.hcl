# =============================================================================
#  Politique Vault : finance-app
#  L'application de paiement est la SEULE à pouvoir déchiffrer un IBAN,
#  au moment d'émettre un virement.
# =============================================================================
path "transit/decrypt/datacorp-pii" {
  capabilities = ["update"]
}
path "database/creds/app-readonly" {
  capabilities = ["read"]
}
