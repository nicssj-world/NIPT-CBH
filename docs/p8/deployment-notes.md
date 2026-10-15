# P8 signed deployment tooling notes

Local synthetic preparation only. `STARTED_NOT_ACCEPTED` records orchestration completion; it does not certify smoke, staff acceptance, AL-7, a hospital DR exercise or a clinical pilot. No applied migration or clinical HOLD was changed.

## Build and bundle

Commit all intended source first; the release tool rejects tracked or untracked source changes and checks HEAD again before signing. Use distinct P8 image tags; do not overwrite existing release tags.

```sh
export SOURCE_REVISION="$(git rev-parse HEAD)"
export MIGRATIONS_SHA256="$(node --input-type=module -e "import {migrationInventory} from './deploy/scripts/release-contract.mjs'; console.log((await migrationInventory('db/migrations')).sha256)")"
export NIPT_IMAGE_TAG="p8-$(git rev-parse --short=12 HEAD)"
for service in web operations renderer; do
  docker build --target "$service" --build-arg SOURCE_REVISION --build-arg MIGRATIONS_SHA256 -t "nipt-cbh-$service:$NIPT_IMAGE_TAG" .
done
npx tsx tools/release-bundle.ts "bundles/nipt-cbh-$NIPT_IMAGE_TAG"
```

Each image build recomputes migration hashes from copied bytes before recording provenance. Bundling verifies immutable IDs/labels, reads the baked provenance and independently hashes migrations present in operations/renderer images. PostgreSQL/Caddy are selected by the existing pinned references. Archives are saved by immutable ID, so installation never relies on restored tags. New bundling destinations must be fresh, inside local `bundles`, with no linked ancestry. A failed partial destination is retained; use a fresh name after investigation.

## Trusted Linux invocation

Provision `deploy/scripts` and the signing public key independently of media; verify their provenance and public-key fingerprint out of band. Only built-in Node APIs are required by the trusted orchestration helpers. Run the trusted entry point from the signed media directory:

```sh
export NIPT_MODE=synthetic
export NIPT_TRUSTED_TOOLS=/opt/nipt-trusted-tools
export TRUSTED_RELEASE_PUBLIC_KEY=/etc/nipt-trust/release-public.pem
export NIPT_RUNTIME_ROOT=/srv/nipt-synthetic-p8-rehearsal
export NIPT_COMPOSE_PROJECT=nipt-synthetic-p8-rehearsal
export NIPT_HTTPS_PORT=18443
cd /media/nipt-cbh-p8
sh "$NIPT_TRUSTED_TOOLS/deploy/scripts/preflight.sh"
sh "$NIPT_TRUSTED_TOOLS/deploy/scripts/install.sh"
```

Runtime must be a fresh absolute directory, separate from media. Project must start `nipt-synthetic-` and have no existing containers/volumes. Ingress stays loopback; omitted port defaults8443. Secrets/config are generated outside signed media with the verified operations image ID and no bootstrap network. Compose validation runs against the prepared runtime, not missing media secrets. Database readiness, volume preparation, migrations and simulator preparation complete before app services start. Any migration failure prevents app startup. A runtime lock prevents overlapping orchestration.

The runtime marker `.nipt-runtime.json` records target/project/port, immutable images, revision and status. After app rollback, include its `appOverride` file in every manual Compose command; otherwise manual restart could restore the newer app IDs from base compose. For example:

```sh
docker compose --project-directory "$NIPT_RUNTIME_ROOT" --project-name "$NIPT_COMPOSE_PROJECT" \
  --env-file "$NIPT_RUNTIME_ROOT/.nipt-compose.env" -f "$NIPT_RUNTIME_ROOT/compose.yaml" \
  -f "$NIPT_RUNTIME_ROOT/rollback-apps.json" ps
```

Use the last `-f` only when the marker records that override. Record operational smoke separately using the P8 health/rehearsal tooling. Liveness alone is insufficient.

## Upgrade and failure recovery

Stop all writers and perform the independently verified backup/restore procedure first. `BACKUP_VERIFIED=yes` additionally requires `NIPT_BACKUP_EVIDENCE` pointing to an operator-reviewed JSON record:

```json
{"syntheticOnly":true,"restoreVerified":true,"runtimeRoot":"/srv/nipt-synthetic-p8-rehearsal","project":"nipt-synthetic-p8-rehearsal","sourceRevision":"<current runtime 40-hex revision>","archive":"/absolute/path/backup.enc","sha256":"<actual archive 64-hex SHA256>"}
```

The tool checks the target/revision and actual archive hash; the operator's restore assertion still requires retained drill evidence. From the new signed bundle, invoke trusted `upgrade.sh` with the same runtime/project/port and backup evidence. It stops Web/simulator, then gracefully stops Worker; a missing worker or nonzero exit prevents migration. This is bounded synthetic drain evidence, not hospital HIS reconciliation.

Failure records the phase, attempted revision and last successful runtime state. A failed initial install has no prior release and cannot claim app rollback. A failed upgrade can use trusted compatible rollback with `PREVIOUS_BUNDLE` as an absolute independently verified signed prior bundle and `SCHEMA_COMPATIBLE_WITH_PREVIOUS=yes` only after reviewing actual schema/ledger. Rollback changes Web/Worker/Renderer only; it does not run/reverse SQL or replace database configuration. Failed migration attempts retain `schemaStatus=REVIEW_REQUIRED_AFTER_ATTEMPT` and no asserted schema revision. Incompatible schema requires the existing fresh-target restore procedure and separate cutover authority.

Private `.nipt-last-command-error.log` retains command diagnostics on CLI failures; do not publish it without reviewing for sensitive operational content. Retain partial runtime/backup artifacts for investigation. A process killed outside normal cleanup can leave `.nipt-deploy.lock`; verify no installer is running before an authorized operator removes only that stale lock. Do not edit markers to invent successful installation.

## Focused checks

After image loading, upgrade/rollback reacquire the current runtime marker under the exclusive runtime lock. Upgrade also revalidates its bound backup and actual archive checksum under that lock. Any marker change since the earlier observation aborts before draining services or changing configuration; the newer marker remains intact and the lock is released. Earlier preflight observations do not authorize a later mutation.

`node --test tests/deploy/deployment-order.node.mjs tests/deploy/p8-deployment.node.mjs` exercises real signature/file verification and filesystem operations with a recorded Docker adapter. It covers verification-before-mutation, isolated target addressing, immutable image selection, missing backup, drain failure, migration failure, compatible app rollback and failed-upgrade recovery. These tests are orchestration evidence only; the controller separately records actual Docker installation/startup/upgrade/rollback and packaged smoke.
