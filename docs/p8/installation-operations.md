# P8 installation, operations and recovery runbook

Scope: synthetic Local/on-premises preparation. No hospital installation, clinical pilot or Production configuration is authorized. Follow [signed build/install/upgrade/rollback commands](deployment-notes.md); [delivery](delivery.md) identifies the exact exercised candidate and remaining constraints. The immutable Plan v6.2.1 §§14.3–14.8 supplies the architecture and operational baseline. Docker Desktop Linux rehearsal is separate from hospital OS/IT acceptance.

## Installation and prerequisites

1. Record approved source SHA, application image IDs, Node24/Docker/Compose/PostgreSQL versions, available disk/RAM, time synchronization, TLS trust, bundle fingerprint and test authorization. Obtain IT's actual sizing and network/ACL requirements; do not invent acceptance thresholds.
2. Build on the development host with internet permitted. Commit source first; build the three existing targets using exact `SOURCE_REVISION` and `MIGRATIONS_SHA256` and distinct P8 tags. Create a fresh signed bundle. Independently provision trusted tools and Ed25519 public key; verify exact media file set before executing media content. Keep signing private key off installation media.
3. On the isolated Linux test target, supply explicit synthetic runtime/project/loopback port. Runtime must be fresh and separate from media; a project with existing containers or volumes is refused. Bootstrap secrets using the signed operations image ID with network disabled. Retain generated keys outside the signed bundle. Never replace only one half of a key pair or regenerate keys for existing encrypted data.
4. Installer prepares persistent volumes, waits for private PostgreSQL, applies forward migrations/roles and simulator fixtures, then starts renderer/web/worker/proxy with no image pull/build. Migration failure prevents application startup. The migration ledger rejects changed, missing and backdated files; never edit applied migrations or repair the ledger by assertion.
5. Run actual HTTPS login, synthetic registration/worklist/HOLD/PDF smoke plus operator health. Record source/runtime/project and artifact hashes. `STARTED_NOT_ACCEPTED` and `/api/health`200 alone do not prove operational or clinical acceptance.

Container topology is unchanged: private PostgreSQL/data network; separate renderer network; only Caddy loopback HTTPS exposed; internal networks and ingress masquerade disabled. Fonts/runtime assets are local. LAN publication, hospital TLS/DNS, device paths, CIFS accounts/ACLs and live endpoints require separate IT authorization. No real HIS/HALOS/CFS connection is included.

## Start, stop and restart

Every manual Compose command must use the runtime directory, explicit project, `.nipt-compose.env` and base compose file. If `.nipt-runtime.json` records `appOverride`, also include that exact override file. Use the example in deployment-notes; do not infer the project from the current directory or omit a rollback override.

- Observe: `ps --all`; service logs restricted to authorized operators; read-only operator health JSON. Record queue/reconciliation counts and the live worker lock. Disabled inbound is distinct from worker failure. A recent restored heartbeat without a live worker must remain not ready.
- Stop writers: stop web/simulator, then gracefully stop worker with a bounded timeout. Verify worker exited0 and no writer/fixture/maintenance process remains. Do not assert quiescence after an unexplained forced exit.
- Ordinary shutdown: stop renderer/proxy/database after writers stop. Preserve named volumes, secrets, runtime marker and logs. Do not use volume deletion, prune, hard reset or broad cleanup.
- Ordinary restart: start database and wait for readiness, then renderer and unchanged application services using existing verified image IDs and override. Do not re-run initialization/seed merely to restart. Run login/PDF/worker health again; a successful new worker job is required after an idle restart before claiming recent successful work.
- Upgrade: first take and verify the bound backup described below. Invoke trusted upgrade from the new verified bundle. The tool validates the same runtime and backup under its runtime lock, drains the actual worker, migrates and starts the candidate. Do not bypass signature, provenance, migration or drain failure.

## Backup and restore procedure

Use existing V2 [backup/restore tooling](../operations.md#backup--restore) and its512MiB bounded synthetic archive contract. Stop all writers first. Back up the database plus complete immutable file store and every database-referenced P6 sandbox. Include configuration and encryption/signing keys in independently controlled escrow; keys are deliberately excluded from data archives. Retain source/backup/restore manifests and hash comparisons. No automatic deletion or retention assumption is implemented.

For a container rehearsal, run the verified operations image on its existing private data network, mounting the source file volume read-only, generated backup key read-only and a separate restricted output directory. Load the migration URL through its secret file, not a printed command value. Set `BACKUP_SOURCE_QUIESCENT=yes` only after verifying shutdown. Do not archive unrelated sandbox roots. Keep restored P6 artifacts in an archive directory; never activate or replay them automatically.

Create a fresh synthetic restore database and fresh disjoint file/archive destinations. Use `RESTORE_TO_NEW_SYNTHETIC_DATABASE=yes` with the explicit target. Restore authenticates encryption/hash/manifest, rejects unsafe paths/links/occupied targets and restores SQL transactionally without ownership/ACL. Reapply reviewed roles separately. Verify migration checksums, all relevant table/lineage/audit digests, receipts and every referenced file hash before use. A restored health probe must not claim a worker is alive merely from backed-up heartbeat rows.

Only after that actual verification, create the upgrade evidence record specified in deployment-notes, binding runtime/project/current revision and the exact encrypted archive SHA256 to the retained restore evidence. `restoreVerified:true` is an operator attestation backed by artifacts; it is never produced merely by making a backup file.

Plan §14.6 baseline is encrypted nightly database/base backup with WAL, versioned incremental PDFs, separate consent/signature assets, weekly restore checks and supplementary Proxmox backups; full DR before go-live and quarterly. **These schedules are documented requirements, not installed hospital jobs.** IT must supply NAS destination/ACL/capacity, WAL/base-backup tooling, backup identity, escrow custodians, retention, monitoring/alert recipients and Q-I6 RPO/RTO. Stage approved jobs on a synthetic host and verify a restore before enabling hospital schedules. Do not turn a sample timetable into an approved hospital retention policy.

## Failure and rollback

- Renderer outage: retain queue/error observations; restore renderer, recover durable retry/pending work, verify exactly one receipt and immutable PDF bytes. Never fabricate completion or delete queue/audit evidence.
- Worker interruption: identify only the owned process, observe durable state, restart the worker, verify singleton lock, receipt idempotency and new successful work. Process-kill rehearsal is not physical power-loss/VM-loss acceptance.
- Migration failure: retain logs/ledger and phase marker. Investigate transaction boundaries and compatibility. A failed upgrade preserves last successful runtime state and schema uncertainty; no down migration or automatic ledger repair.
- Compatible application rollback: independently verify prior signed bundle, review schema compatibility, set the explicit compatibility gate and invoke trusted rollback. Only web/worker/renderer image overrides change; SQL/database topology and data remain. Preserve override for all subsequent manual operations.
- Incompatible schema or host loss: restore into a new database/file store, recover keys from authorized escrow, validate data/lineage/audit/receipts and obtain separate cutover authority. Never overwrite a running database or infer receiver delivery from restored P6 files.
- Abandoned installer lock: inspect owned process/containers and retained marker first. Only an authorized operator may remove that exact stale lock after proving no deployment is active; do not edit a marker to manufacture success.

## Evidence and incident record

Record actual start/stop/barrier/recovery times, archive size/hash, source/restore counts, failed jobs, lost committed receipts, role checks and health output. Separate measured observations from unapproved hospital RPO/RTO and forecast/x5 load criteria. Restrict raw service/command logs, review before sharing, and use bounded secret-free health codes for routine monitoring. Secrets must never enter source, signed bundles, screenshots or support reports.

The [cutover evidence](cutover-evidence.md) retains a synthetic frozen in-flight list. Under OD-26(c), pre-cutoff cases continue the legacy workflow; only evidence-eligible completed records enter Historical, and post-cutoff cases enter the new runtime. A frozen list does not authorize an exception to historical eligibility. Actual cutoff/anchor/list approval, single Lab-ID/HIS sender authority, paper fallback/training, staff/physical UAT, clinical adapter/templates/consent and signed AL-7 remain HOLD.
