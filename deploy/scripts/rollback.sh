#!/bin/sh
set -eu
test "${NIPT_MODE:-}" = synthetic
test -n "${PREVIOUS_BUNDLE:-}"
test -n "${NIPT_RUNTIME_ROOT:-}"
test "${SCHEMA_COMPATIBLE_WITH_PREVIOUS:-}" = yes
test -n "${NIPT_TRUSTED_TOOLS:-}"
cd "$PREVIOUS_BUNDLE"
sh "$NIPT_TRUSTED_TOOLS/deploy/scripts/preflight.sh"
for image in images/*.tar; do docker load --input "$image"; done
node "$NIPT_TRUSTED_TOOLS/deploy/scripts/verify-images.mjs" "$PWD"
cd "$NIPT_RUNTIME_ROOT"
docker compose stop worker
cp "$PREVIOUS_BUNDLE/compose.yaml" compose.yaml
cp "$PREVIOUS_BUNDLE/deploy/Caddyfile" deploy/Caddyfile
docker compose up -d --pull never --no-build --no-deps --force-recreate web worker renderer
# Incompatible schema rollback requires a separately verified restore into a new database.
