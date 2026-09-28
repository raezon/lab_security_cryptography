#!/usr/bin/env bash
# =============================================================================
#  pg-admin.sh [options psql]
#  Ouvre une session psql en tant que superutilisateur "postgres" (compte
#  "bris de glace") en lisant son mot de passe dans Vault — jamais en dur.
#  Chaque utilisation est tracée par Vault (audit device) ET par PostgreSQL.
# =============================================================================
set -euo pipefail
PGPASSWORD=$(vault kv get -field=password kv/datacorp/break-glass/postgres) \
  exec psql -U postgres -d "${PGDATABASE:-datacorp}" "$@"
