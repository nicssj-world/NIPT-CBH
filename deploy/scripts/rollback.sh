#!/bin/sh
set -eu
: "${NIPT_TRUSTED_TOOLS:?Independently provisioned trusted tools required}"
exec node "$NIPT_TRUSTED_TOOLS/deploy/scripts/deployment.mjs" rollback
