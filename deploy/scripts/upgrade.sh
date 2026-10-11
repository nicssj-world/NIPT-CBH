#!/bin/sh
set -eu
test "${NIPT_MODE:-}" = synthetic
test "${BACKUP_VERIFIED:-}" = yes
docker compose stop worker
# The signed new bundle's migrator checks ledger drift before applying forward migrations.
exec sh deploy/scripts/install.sh
