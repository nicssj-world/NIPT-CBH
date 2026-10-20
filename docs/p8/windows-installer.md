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
| `runtime\` | Node, PostgreSQL 17 binaries, Chromium, PowerShell 7 (installed once; upgrades must not change them) |
| `releases\<version>\` | immutable `app\` and `ops\` of each installed release |
| `admin\`, `nipt.cmd` | operator CLI of the current release |
| `data\pgdata`, `data\files`, `data\integration\{inbound,outbound,results}`, `data\master` | database cluster and file stores (never inside a release) |
| `secrets\` | database passwords/URLs, renderer token, identity key, integration keys, backup key, TLS passphrase, test accounts (ACL: installing user, SYSTEM, Administrators) |
| `config\` | `nipt.json`, `share-policy.json`, `backup-policy.json`, `tls\` (self-signed PFX + certificate) |
| `data\excel-spool\` | hand-off folder to the Excel bridge (only with `-ExcelMode bridge`) |
| `backups\`, `restores\`, `logs\`, `run\` | encrypted backups, restored trees, service logs, supervisor state |
| `install-state.json` | current/previous release and history; owner acceptance remains `NOT_ACCEPTED` until the separate Owner gate, while `healthCheck.status` records `STARTING`, `HEALTHY`, or `FAILED` |

## How it runs

One Windows **scheduled task** (`\NIPT-CBH\nipt-cbh-<instance>`; `-TaskMode system` at boot as SYSTEM, `-TaskMode user` at the installing user's logon) starts `supervisor.mjs`. The supervisor starts the private PostgreSQL cluster (loopback only, SCRAM), then the **renderer**, **worker**, **web** and **HTTPS front** (a small Node TLS proxy, replacing Caddy), restarts any that exits with a bounded backoff (1 → 30 s), writes `run\state.json` and `logs\*.log`, and stops them in order (HTTPS → web → **worker through its IPC graceful stop** → renderer → PostgreSQL) when `run\stop.request` appears. The task is configured to restart the supervisor after failure. Web and worker use the least-privilege logins `nipt_web` / `nipt_worker`; the owner login is used only by the installer's migration and backup steps.

## Commands

`Nipt-Admin.ps1 <command> -Root <dir>` (or `node installer\nipt-admin.mjs`):

| Command | What it does |
|---|---|
| `verify-package` | signature (public key supplied independently) and exact file set |
| `preflight` | Windows, Node 24, root safe/empty, ≥ 8 GB free, ports free, package verified, runtime present, master workbook SHA-256, Task Scheduler |
| `install` | preflight → copy runtime and release → secrets/TLS/policies → `initdb` → forward migrations → mark operational → least-privilege logins → six test accounts → startup task → start → health → **first verified backup** |
| `start` / `stop` [`--keep-database`] / `restart` / `status` / `health` | lifecycle and operator health report; `status` compares recorded service PIDs with live Windows Node command lines and reports PostgreSQL process state separately from authenticated database reachability |
| `backup` | stops the writers, takes the existing quiescent encrypted operational backup, restarts |
| `set-backup-root --path <drive or UNC folder>` | moves the backup destination (e.g. a NAS share); proves the account can write it and updates the backup policy |
| `schedule-backup --time HH:mm` / `unschedule-backup` / `backups` | daily scheduled task running `backup`; list of backups with hashes |
| `dr-drill` | timed backup + verified restore into a quarantined database, nothing activated, drill copy removed: RPO/RTO measurements for this host |
| `photos verify` / `backup <dir>` / `restore <backup> <rootId> <path>` / `relocate <rootId> <path> <reason>` | Run Photo Evidence maintenance (existing tool) with the installation's environment |
| `host-check [--backup-path ...] [--photo-path ...] [--inbound ...] [--outbound ...] [--hostname ...] [--cert ...]` | read-only hospital host check (also runnable as `node installer\host-check.mjs` before installation) |
| `restore (--backup <dir> or --fresh) [--activate --confirm-source-fenced yes]` | restore into a **new quarantined database and file tree**, verify digests/ledger/files; activation fences the source first, then switches the installation to the restored database |
| `upgrade --package <dir>` | verify, schema-compatibility gate, **pre-upgrade backup**, stage release, forward migrations, switch, start, verify; health failure details are retained, and application rollback occurs only if the previous release supports the applied schema |
| `rollback` | switch back to the previous release **only if the database is not newer than that release** |
| `uninstall --confirm <folder name> [--remove-data]` | stop, remove the task and releases; data kept unless `--remove-data` |

## Excel and the account the services run as

Task List PDFs are rendered by the desktop Microsoft Excel (A4, locked template). Two facts decide how the services may run:

- Excel automation is not supported from a service or SYSTEM session (session 0), and the export script reads the signed-in user's **default printer** (HKCU) and sets it to A4.
- The export script needs PowerShell 7 (.NET 5+ APIs); the package bundles it, so the host does not need it.

| Mode | When | How Excel is reached |
|---|---|---|
| `-ExcelMode direct` (default with `-TaskMode user`) | the services run in an interactive user session that has Excel and a default printer | the web process calls the export script directly |
| `-ExcelMode bridge` (**required** with `-TaskMode system`) | the services run as SYSTEM at boot | the web process writes the workbook to `data\excel-spool`; a second scheduled task `...-excel-bridge`, running as a **logged-on interactive user** (`-ExcelUser DOMAIN\name`), calls the same export script and returns the PDFs. No network listener. The bridge is restarted by upgrade and rollback and reported in `health` |

The installer refuses a SYSTEM task with direct Excel (`CONFIG_SYSTEM_TASK_REQUIRES_EXCEL_BRIDGE`) and refuses to install when Excel is not registered (`--allow-no-excel yes` overrides for test hosts; Task List PDFs then fail).

## Safety rules (enforced in code and covered by tests)

- Package: unsigned, tampered, extra/missing files, symlinks, unsafe paths, wrong version syntax and non-test manifests are refused. Packages carrying a rehearsal fault are refused unless `--allow-test-fault yes`.
- The installation root must be **ASCII-only** (spaces are fine). PostgreSQL's `initdb`/`postgres.exe` start child processes through ANSI Windows APIs and cannot start from a path the system code page cannot represent: a Thai folder name on a Western code page was refused by `initdb` during the rehearsal, so preflight refuses it (`INSTALL_ROOT_MUST_BE_ASCII`). Thai names are fine for photo roots and HIS shares, which Node handles; the **backup destination must also be ASCII** (`pg_dump.exe` writes through the ANSI command line; `set-backup-root` refuses it with `BACKUP_ROOT_MUST_BE_ASCII`).
- Install root must be empty, not a drive root, and neither contain nor sit inside the package. `testEnvironmentOnly:true` is mandatory in configuration; database names must start `nipt_operational_` and may not look synthetic/template/postgres.
- Migrations are forward-only with SHA-256 checksums (existing runner). Upgrade refuses a database that knows a migration the new release lacks or whose checksum differs. A failed migration leaves the old release running when it is still compatible; otherwise the state is `UPGRADE_FAILED_MIGRATION_RESTORE_REQUIRED`.
- Rollback never edits the schema. If the database is newer than the target release, rollback is refused and the pre-upgrade backup must be restored into a new database.
- Backup/restore reuse `deploy/scripts/operational-backup.mjs` unchanged (AES-256-GCM, fenced source, fresh targets, table-digest comparison). A backup needs the approved owner master workbook; the installer verifies its SHA-256 and keeps a read-only copy.

## Limits of the rehearsals

Procedures: [windows-installer-runbook.md](windows-installer-runbook.md). Evidence: [windows-installer-evidence.md](windows-installer-evidence.md) and the release-candidate documents under `docs/release/`. Not covered by any local rehearsal: elevated SYSTEM-task install (the rehearsal session was not Administrator), a code-signing certificate or MSI/EXE wrapper, hospital TLS/DNS/LAN publication, UNC/SMB shares and service-account ACLs, hospital PostgreSQL sizing, NAS backup targets and key escrow, physical power-loss tests, antivirus/endpoint policy.
