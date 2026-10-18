# P8 — Windows offline installer (test environment)

Status: built and rehearsed on one Windows 11 host. **Test environment only.** Nothing here installs on a hospital host, connects a HIS, applies a Production migration or accepts clinical use (`clinicalAcceptance` and `hospitalOperationalAcceptance` are always `false` in the health report). It complements, and does not replace, the Linux/Docker signed bundle in [delivery.md](delivery.md).

## What it is

A **package folder** produced from a clean committed source, and an **operator CLI** that installs, runs, backs up, restores, upgrades and rolls back one installation under one root folder. No internet, Docker, Caddy or installer service is needed on the target.

```
nipt-cbh-<version>/                 (package; Ed25519-signed manifest over every file's SHA-256)
  installer/   Install-Nipt.ps1, Nipt-Admin.ps1, nipt-admin.mjs, supervisor.mjs, https-proxy.mjs, lib.mjs, ...
  payload/release/   app/ (Next standalone), ops/ (worker, renderer, migrations, backup tools, node_modules), release.json
  payload/runtime/   node/ (Node 24), pg/ (PostgreSQL 17 bin+lib+share), browsers/ (Chromium headless shell), runtime.json   [full packages only]
  manifest.json, manifest.sig
```

Installed layout (`<Root>`, default `C:\NIPT-CBH`):

| Folder | Content |
|---|---|
| `runtime\` | Node, PostgreSQL binaries, Chromium (installed once; upgrades must not change them) |
| `releases\<version>\` | immutable `app\` and `ops\` of each installed release |
| `admin\`, `nipt.cmd` | operator CLI of the current release |
| `data\pgdata`, `data\files`, `data\integration\{inbound,outbound,results}`, `data\master` | database cluster and file stores (never inside a release) |
| `secrets\` | database passwords/URLs, renderer token, identity key, integration keys, backup key, TLS passphrase, test accounts (ACL: installing user, SYSTEM, Administrators) |
| `config\` | `nipt.json`, `share-policy.json`, `backup-policy.json`, `tls\` (self-signed PFX + certificate) |
| `backups\`, `restores\`, `logs\`, `run\` | encrypted backups, restored trees, service logs, supervisor state |
| `install-state.json` | current/previous release, status, history; `status` stays `INSTALLED_NOT_ACCEPTED` |

## How it runs

One Windows **scheduled task** (`\NIPT-CBH\nipt-cbh-<instance>`; `-TaskMode system` at boot as SYSTEM, `-TaskMode user` at the installing user's logon) starts `supervisor.mjs`. The supervisor starts the private PostgreSQL cluster (loopback only, SCRAM), then the **renderer**, **worker**, **web** and **HTTPS front** (a small Node TLS proxy, replacing Caddy), restarts any that exits with a bounded backoff (1 → 30 s), writes `run\state.json` and `logs\*.log`, and stops them in order (HTTPS → web → **worker through its IPC graceful stop** → renderer → PostgreSQL) when `run\stop.request` appears. The task is configured to restart the supervisor after failure. Web and worker use the least-privilege logins `nipt_web` / `nipt_worker`; the owner login is used only by the installer's migration and backup steps.

## Commands

`Nipt-Admin.ps1 <command> -Root <dir>` (or `node installer\nipt-admin.mjs`):

| Command | What it does |
|---|---|
| `verify-package` | signature (public key supplied independently) and exact file set |
| `preflight` | Windows, Node 24, root safe/empty, ≥ 8 GB free, ports free, package verified, runtime present, master workbook SHA-256, Task Scheduler |
| `install` | preflight → copy runtime and release → secrets/TLS/policies → `initdb` → forward migrations → mark operational → least-privilege logins → six test accounts → startup task → start → health → **first verified backup** |
| `start` / `stop` [`--keep-database`] / `restart` / `status` / `health` | lifecycle and the operator health report (`tools/p8/health.ts`) plus supervisor and HTTPS probes |
| `backup` | stops the writers, takes the existing quiescent encrypted operational backup, restarts |
| `restore --backup <dir> [--activate --confirm-source-fenced yes]` | restore into a **new quarantined database and file tree**, verify digests/ledger/files; activation fences the source first, then switches the installation to the restored database |
| `upgrade --package <dir>` | verify, schema-compatibility gate, **pre-upgrade backup**, stage release, forward migrations, switch, start, verify; automatic rollback if the new release is not healthy |
| `rollback` | switch back to the previous release **only if the database is not newer than that release** |
| `uninstall --confirm <folder name> [--remove-data]` | stop, remove the task and releases; data kept unless `--remove-data` |

## Safety rules (enforced in code and covered by tests)

- Package: unsigned, tampered, extra/missing files, symlinks, unsafe paths, wrong version syntax and non-test manifests are refused. Packages carrying a rehearsal fault are refused unless `--allow-test-fault yes`.
- Install root must be empty, not a drive root, and neither contain nor sit inside the package. `testEnvironmentOnly:true` is mandatory in configuration; database names must start `nipt_operational_` and may not look synthetic/template/postgres.
- Migrations are forward-only with SHA-256 checksums (existing runner). Upgrade refuses a database that knows a migration the new release lacks or whose checksum differs. A failed migration leaves the old release running when it is still compatible; otherwise the state is `UPGRADE_FAILED_MIGRATION_RESTORE_REQUIRED`.
- Rollback never edits the schema. If the database is newer than the target release, rollback is refused and the pre-upgrade backup must be restored into a new database.
- Backup/restore reuse `deploy/scripts/operational-backup.mjs` unchanged (AES-256-GCM, fenced source, fresh targets, table-digest comparison). A backup needs the approved owner master workbook; the installer verifies its SHA-256 and keeps a read-only copy.

## Limits of this rehearsal

See [windows-installer-runbook.md](windows-installer-runbook.md) (procedures) and the evidence section of [delivery.md](delivery.md) once updated. Not covered: elevated SYSTEM-task install (the rehearsal session was not Administrator), a code-signing certificate or MSI/EXE wrapper, hospital TLS/DNS/LAN publication, UNC/SMB shares and service-account ACLs, hospital PostgreSQL sizing, NAS backup targets and key escrow, physical power-loss tests, antivirus/endpoint policy.
