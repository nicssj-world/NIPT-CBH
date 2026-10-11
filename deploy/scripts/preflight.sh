#!/bin/sh
set -eu
test "${NIPT_MODE:-}" = synthetic
test -n "${TRUSTED_RELEASE_PUBLIC_KEY:-}"
test -r "$TRUSTED_RELEASE_PUBLIC_KEY"
openssl pkeyutl -verify -pubin -inkey "$TRUSTED_RELEASE_PUBLIC_KEY" -rawin -in manifest.json -sigfile manifest.sig
test -n "${NIPT_TRUSTED_TOOLS:-}"
node "$NIPT_TRUSTED_TOOLS/deploy/scripts/verify-bundle.mjs" "$PWD" "$TRUSTED_RELEASE_PUBLIC_KEY"
docker info >/dev/null
docker compose config --quiet
