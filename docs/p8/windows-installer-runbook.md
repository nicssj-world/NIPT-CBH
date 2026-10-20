# P8 Windows installer — operator runbook (test environment)

Scope: the procedures below were exercised by `tools/win-installer/rehearse.ts` on a disposable root. They authorize **nothing** on a hospital host: no clinical use, no HIS connection, no Production database. Commands run from an elevated prompt for `-TaskMode system` and from a normal prompt for `-TaskMode user` (starts at that user's logon).

## 0. Prerequisites (offline)

- A package folder `nipt-cbh-<version>` on local or removable media, built from a clean committed source on the build host, and the **public key** file delivered through a separate channel (never read from the package).
- Windows 10/11 or Server with the Task Scheduler service and PowerShell 5.1; at least 8 GB free; the approved owner master workbook (SHA-256 is checked against `packages/workbook/master-manifest.json`); free loopback ports (defaults 5432 PostgreSQL, 3000 web, 443 HTTPS, 3001 renderer; change with `-Ports`).
- Node, PostgreSQL 17 binaries and Chromium are inside a *full* package. Upgrade packages (`app-only`) must not change them (`RUNTIME_CHANGE_NOT_SUPPORTED`).

## 1. Install

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\Install-Nipt.ps1 -Root C:\NIPT-CBH `
  -PublicKey E:\keys\package-signing-public.pem -MasterWorkbook D:\owner\NIPT_CBH_Final_Combined_Master.xlsx -TaskMode system
```

`preflight` runs first and refuses on any failed check. On success the installer prints the URL, the credentials file (`<Root>\credentials.txt`, six test accounts, restricted ACL) and the health report. The install ends with the **first verified backup**; `technicalReady` is true only while a verified, recent backup exists and the job backlog is empty.

Add `-ExcelMode bridge -ExcelUser DOMAIN\name` (and `-TaskMode system`) when the services must start at boot as SYSTEM; the named user must be able to log on interactively on this host, have Microsoft Excel and a default printer, and stay logged in (or log in after a reboot) for Task List PDFs to be produced. Run `Nipt-Admin.ps1 host-check ...` first.

Self-signed certificate: trust `<Root>\config\tls\server.cer` on test clients, or use the browser exception. Hospital TLS/DNS is an IT decision and is not configured.

## 2. Daily operation

| Task | Command |
|---|---|
| Status / health | `<Root>\nipt.cmd status` / `health` (health = operator probe `tools/p8/health.ts` + supervisor + HTTPS) |
| Stop for maintenance | `nipt.cmd stop` (HTTPS → web → worker graceful over IPC → renderer → PostgreSQL). `--keep-database` stops only the applications |
| Start | `nipt.cmd start` (the startup task starts the supervisor at boot/logon; a crashed supervisor's children are reaped on the next start) |
| Logs | `<Root>\logs\supervisor.log` (JSON lines), `web.log`, `worker.log`, `renderer.log`, `postgres.log` |

A service that exits is restarted with backoff (1, 2, 4, 8, 16, 30 s). A health failure that persists after restarts is an incident: keep the logs, do not edit `install-state.json`.

Starting an installed root or retrying Setup also re-enables its existing NIPT-CBH scheduled task when that task is disabled, then starts the recorded task without replacing its action or principal. This lets a later compatible release recover an `INSTALLED_NOT_ACCEPTED` installation after a failed prior upgrade.

## 3. Backup and restore

- **Backup** (`nipt.cmd backup`): stops the applications, takes the quiescent AES-256-GCM operational backup (database + file store + outbound roots + master workbook), restarts. The backup key is `<Root>\secrets\backup.key`: **escrow it separately**; a backup is unreadable without it. Schedules, NAS targets, retention and RPO/RTO are IT-owned and are not installed by this tool.
- **Backup destination and schedule**: `nipt.cmd set-backup-root --path \\NAS\share\nipt-backups` (the account that runs the scheduled task must be able to write it), then `nipt.cmd schedule-backup --time 02:00`. The backup stops the applications while it runs. `nipt.cmd backups` lists them. Retention and off-site copies are IT-owned.
- **Run Photo Evidence**: photos live under `data\files\run-photos` by default and are therefore inside every backup. An administrator can move the storage path to a drive or UNC folder (Settings); files there are **not** in the operational backup: back them up with `nipt.cmd photos backup <empty folder>` (verified copy + manifest) on the same schedule. After a restore on a different host use `photos restore` and `photos relocate`, then `photos verify`.
- **Measure, don't guess**: `nipt.cmd dr-drill` reports backup, restore and restart seconds on this host.
- **Restore for inspection**: `nipt.cmd restore --backup <dir>` creates a new quarantined database and a fresh file tree and verifies table digests, ledger and files. The live installation is untouched.
- **Disaster recovery**: `nipt.cmd restore --backup <dir> --activate --confirm-source-fenced yes`. The source database is fenced first, the restored target is activated, the configuration points to it, and the running release's forward migrations are applied (a backup from a *newer* release than the one running is refused). The existing activation gate refuses (`RESTORE_SOURCE_CHANGED_SINCE_BACKUP`) when the live database changed after the backup was taken, because activating would silently discard that work; the restored copy then stays quarantined for inspection. For a drill or planned move use `restore --fresh --activate --confirm-source-fenced yes`: the applications are stopped, a fresh backup of the quiescent source is taken and that exact backup is restored and activated, so nothing can change in between. Verify health and data, then decide separately about the old database; never un-fence it casually. Activating an *older* backup over changed work is a deliberate data-loss recovery that needs an Owner/IT-authorised procedure; it is not automated here.

## 4. Upgrade and rollback

1. Obtain the new `app-only` package and verify with `nipt.cmd upgrade --package <dir> --public-key <key>` (signature and exact file set are checked first).
2. The tool refuses a package that is not newer, a database that knows migrations the package lacks, or a changed checksum. It takes a **pre-upgrade backup**, stages the release, applies forward migrations, switches the release pointer atomically, restarts and verifies health.
3. If the migration fails: the new release is discarded and the old one keeps running when the schema is still compatible (`UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING`); otherwise the state is `UPGRADE_FAILED_MIGRATION_RESTORE_REQUIRED` and the pre-upgrade backup must be restored.
4. If the new release does not become healthy, the failed health checks and live service/database probes are recorded in `install-state.json` and the Setup log. Application rollback occurs only when the previous release supports the live migration ledger. If the migration makes the previous binary incompatible, Setup reports `UPGRADE_FAILED_HEALTH_RESTORE_REQUIRED`, leaves the new release current, retains the verified backup, and does not restore or claim rollback. Keep the installation in place and repair forward with a compatible later release; do not launch the old binary against the newer schema.
5. A health check is `HEALTHY` only when authenticated database access, migration checksums, worker heartbeat, web, renderer, file storage, Supervisor process ownership, HTTPS, audit chain, restricted roles and quarantine state all pass. This technical health state is separate from Owner acceptance (`NOT_ACCEPTED`); an HTTP 200 or successful login alone does not accept a release.
6. **Manual rollback** (`nipt.cmd rollback`) is application-only and allowed only when the database is not newer than the previous release. When a forward migration was applied, rollback is refused (`ROLLBACK_REQUIRES_DATABASE_RESTORE`) and nothing changes; the pre-upgrade backup can be restored for inspection (§3), but activating it over work done since the upgrade falls under the data-loss rule in §3. There is no down-migration. Plan upgrades so that additive migrations are accepted by the previous release, and rehearse the upgrade on a copy before the real one.

## 5. Uninstall

`nipt.cmd uninstall --confirm <root folder name>` stops everything, removes the startup task and the releases and keeps data and secrets. Add `--remove-data` to delete the whole root (irreversible; take and verify a backup first).

## 6. Not covered (and who owns it)

Elevated SYSTEM-task behaviour under the hospital account policy; antivirus/endpoint exclusions; LAN publication, DNS and hospital certificates; HIS inbound/outbound shares (UNC/SMB, service-account ACL — Q-I3/I4/I5 remain open); NAS, WAL archiving, key escrow and DR drills at the hospital; clinical acceptance (OD-R1b label test, DCC form approval, Staff UAT). These are tracked in [gap-register.md](gap-register.md) and the go-live readiness report.
