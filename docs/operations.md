# Synthetic operations runbook

## Development and release preparation (internet permitted here)

`npm ci`; `npx tsx tools/init-dev.ts`; `docker compose build`; `docker compose up -d`. All mounts/keys/data stay in ignored local directories. PostgreSQL is private; only loopback HTTPS 8443 is exposed. Internal data/render/proxy networks isolate application services; the ingress bridge disables IP masquerading. There are no runtime CDN/font/npm dependencies.

Build the distributable after all tests pass:

```powershell
npx tsx tools/release-bundle.ts bundles/nipt-cbh-0.1.0
node deploy/scripts/verify-bundle.mjs bundles/nipt-cbh-0.1.0 data/keys/release-public.pem
```

The bundle has five OCI image archives, immutable image IDs in compose, CycloneDX production SBOM, migrations, scripts, documentation and Ed25519 signed exact file set. No PHI, credentials, private keys or original sources. `docker save/load` does not preserve registry RepoDigests: bundled compose therefore references local image IDs, including PostgreSQL/Caddy.

## Offline Linux host installation

Host prerequisites: Docker Engine + Compose, Node 24 and OpenSSL installed from hospital-approved media; sufficient disk/RAM for Chromium. Provision a trusted verifier/tools directory and trusted Ed25519 public key independently of the bundle (out-of-band fingerprint verification). Never execute an unverified script from media as the trust root.

```sh
export NIPT_MODE=synthetic
export NIPT_TRUSTED_TOOLS=/opt/nipt-trusted-tools
export TRUSTED_RELEASE_PUBLIC_KEY=/etc/nipt-trust/release-public.pem
export NIPT_RUNTIME_ROOT=/srv/nipt-synthetic
cd /media/nipt-cbh-0.1.0
sh "$NIPT_TRUSTED_TOOLS/deploy/scripts/install.sh"
```

Installer verifies signature + exact file set, loads archives, checks image IDs, copies verified compose/Caddyfile to a runtime directory outside the signed bundle, and bootstraps random keys/passwords using the verified operations image with `--network none`. It sets key ownership UID/GID1000, files0440/directories0750; PostgreSQL gets supplementary GID1000. Images run `--pull never --no-build`; migrations/roles/seed run before Web/Worker. Do not alter signed media to add runtime secrets. On initial failure retain logs and correct the runtime prerequisite; do not bypass signature/checksum or migration checks.

Acceptance smoke: HTTPS login; actual authenticated health page; create/read a Thai synthetic PDF twice with identical bytes; different session denied; Worker heartbeat; simulator scan; no external egress; restart/retry/cancel; schema ledger and audit chain. A static `/api/health` 200 is liveness only. It does not prove database, worker or HIS readiness.

## Upgrade and rollback

Take and verify an encrypted backup before upgrade. Set `BACKUP_VERIFIED=yes` only after a verified restore drill for that backup, then invoke trusted `upgrade.sh` from the new signed bundle. Worker drains before forward migrations. Migrator rejects changed, missing and backdated applied files; no automatic down migration or ledger repair.

Rollback requires `PREVIOUS_BUNDLE` as an absolute path to a compatible independently verified prior bundle and `SCHEMA_COMPATIBLE_WITH_PREVIOUS=yes` after reviewing migrations. Trusted `rollback.sh` re-verifies files/signature/images, reloads exact prior image IDs and replaces only Web/Worker/Renderer. It does not reverse SQL. For incompatible schema, restore into a **new** database/file store and validate before a separately authorized cutover. v0.1.0 has no previous production release to attest.

## Backup / restore

`deploy/scripts/backup.mjs` uses PostgreSQL17 custom dump, file-store copy, tar and AES-256-GCM with format AAD, random IV, tag and encrypted-payload SHA256. Keys are not in the archive. Native execution needs PostgreSQL17 client tools in `PG_BIN`; the operations image also contains these binaries/dependencies.

```powershell
$env:PG_BIN='C:\Program Files\pgsql\bin'
node --env-file=.env.local deploy/scripts/backup.mjs
# Create an empty local database named nipt_synthetic_restore_* first.
$env:RESTORE_TO_NEW_SYNTHETIC_DATABASE='yes'
$env:RESTORE_DATABASE_URL='postgresql://local_operator@127.0.0.1:55432/nipt_synthetic_restore_drill'
node --env-file=.env.local deploy/scripts/restore.mjs '<backup base without extension>' '.local/new-restored-files'
```

Use environment/file secrets, never paste real passwords into commands or logs. Restore authenticates GCM and checksum before extraction; rejects unsafe paths, existing destination file store and nonempty public schema; uses `--no-owner --no-acl`. Reapply reviewed roles through owner-controlled preparation. Verify table counts, audit hash chain and every referenced file hash. Partial failed restores must remain isolated; retry into another new target. Backups need the independently retained encryption key; loss of key means no recovery.

The local native restore drill is evidence for tooling, not hospital RPO/RTO or a signed DR exercise. Mount-agent in P1 is simulator-only: read-only source proof and last-known-good versioned activation; real CIFS/service account, NAS retention/monitoring and per-HIS-result backup remain governed integration work.
