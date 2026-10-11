#!/bin/sh
set -eu
test "${NIPT_MODE:-}" = synthetic
test -n "${NIPT_TRUSTED_TOOLS:-}"
sh "$NIPT_TRUSTED_TOOLS/deploy/scripts/preflight.sh"
for image in images/*.tar; do docker load --input "$image"; done
node "$NIPT_TRUSTED_TOOLS/deploy/scripts/verify-images.mjs" "$PWD"
test -n "${NIPT_RUNTIME_ROOT:-}"
case "$NIPT_RUNTIME_ROOT" in /*) ;; *) echo "Absolute runtime directory required" >&2; exit 1;; esac
test "$NIPT_RUNTIME_ROOT" != "$PWD"
test "$NIPT_RUNTIME_ROOT" != /
case "$NIPT_RUNTIME_ROOT" in "$PWD"/*) echo "Runtime must stay outside signed bundle" >&2; exit 1;; esac
mkdir -p "$NIPT_RUNTIME_ROOT/data"
cp compose.yaml "$NIPT_RUNTIME_ROOT/compose.yaml"
mkdir -p "$NIPT_RUNTIME_ROOT/deploy"
cp deploy/Caddyfile "$NIPT_RUNTIME_ROOT/deploy/Caddyfile"
# Bootstrap with the verified image, no npm, image pull or network. Keys stay outside the bundle.
docker run --rm --network none --user 0:0 \
  -v "$NIPT_RUNTIME_ROOT:/runtime" -w /runtime nipt-cbh-operations:0.1.0 \
  sh -c 'node --import /app/node_modules/tsx/dist/loader.mjs /app/tools/init-dev.ts && chown -R 1000:1000 data && find data -type d -exec chmod 750 {} + && find data -type f -exec chmod 440 {} +'
cd "$NIPT_RUNTIME_ROOT"
# No registry pull or build is permitted on the offline host.
docker compose up -d --pull never --no-build
