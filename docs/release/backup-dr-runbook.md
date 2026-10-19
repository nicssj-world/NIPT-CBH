# Backup, restore and disaster recovery — runbook and hospital acceptance checklist

**Status: tooling executed on the developer machine; hospital acceptance NOT performed.** The hospital NAS, service credentials, key escrow and RPO/RTO targets are not available to the project. Where a step needs them this document is an **IT acceptance checklist, not a result**. Sections 3 and 4 tell you exactly what was measured on the developer machine and what that does not prove.

Rules that this runbook never bypasses: the restore always goes to a **new, quarantined database** and a **fresh file tree**; the activation gate `RESTORE_SOURCE_CHANGED_SINCE_BACKUP` and the fence confirmation are never overridden; a running operational database is never overwritten; a production restore needs separate explicit Owner authorization.

## 1. What a backup contains

`nipt.cmd backup` (existing operational backup tool, unchanged) stops the applications, takes a quiescent AES-256-GCM encrypted snapshot of: the PostgreSQL database (custom-format dump, all 140 tables with per-table digests and the migration ledger), the complete file store `data\files` (immutable report PDFs, Task List documents, signatures, **and the Run Photo Evidence files when the photo root is the installation default `data\files\run-photos`**), the configured outbound folders (res/pdf/backup) and the approved owner master workbook. It writes `manifest.enc` and `metadata.json`; a backup is unreadable without `secrets\backup.key`.

Not inside the operational backup: Run Photo files when an administrator moved the photo root outside `data\files` (use `photos backup`, §2.9); the installation secrets and configuration (copy `secrets\`, `config\`, `install-state.json` with the key escrow procedure); HIS shares themselves.

## 2. Procedures

### 2.1 Encryption key management and escrow
`secrets\backup.key` (32 bytes) is generated at installation. **Escrow it separately** under the hospital key-management policy (two named custodians, sealed copy off the host). Test escrow by restoring a backup on another host using only the escrowed copy. Rotate by installing a new key only after taking a final backup with the old key and recording which backups need which key.

### 2.2 Backup destination (NAS/UNC)
```powershell
nipt.cmd set-backup-root --path \\NAS\share\nipt-backups
```
The command proves the **account running it** can write the folder, refuses locations inside `data\` and paths with non-ASCII characters (`pg_dump.exe` fails on them: `BACKUP_ROOT_MUST_BE_ASCII`), and rewrites the backup policy. The scheduled task runs as the installation's task account (SYSTEM or the named user): that account needs Modify on the share (for SYSTEM this means the computer account `DOMAIN\HOSTNAME$`). Test it by running `nipt.cmd backup` from a scheduled task, not only interactively (rehearsal step S13c).

### 2.3 Schedule
```powershell
nipt.cmd schedule-backup --time 02:00     # daily; use unschedule-backup to remove
nipt.cmd backups                          # list: time, release, file count, manifest SHA-256
```
The backup stops the applications while it runs (quiescent snapshot); choose a quiet hour. Retention, rotation and off-site copies are IT-owned; the tool never deletes a backup.

### 2.4 Restore to an isolated database (inspection)
```powershell
nipt.cmd restore --backup <backup folder>
```
Creates `nipt_operational_restore_<id>` and `restores\<id>\`, verifies every table digest, the migration ledger and every file hash, and leaves the restored database **quarantined and not in use**. The live installation is untouched. Compare counts with the live database, then drop the copy when finished.

### 2.5 Fingerprint verification and activation guard
A restore receipt carries the fingerprints of the source and target databases. Activation (`--activate --confirm-source-fenced yes`) refuses when the source database changed after the backup (`RESTORE_SOURCE_CHANGED_SINCE_BACKUP`), when the fence is not confirmed, or when the receipt does not match both databases. **Do not work around these.** Activating an older backup over changed work is a data-loss recovery that needs an Owner/IT-authorised procedure.

### 2.6 Planned move or recovery drill with activation
```powershell
nipt.cmd restore --fresh --activate --confirm-source-fenced yes
```
Stops the applications, takes a fresh backup of the quiescent source, restores **that** backup, fences the source database, activates the restored database and file tree, applies the running release's forward migrations and checks health. The old database stays fenced (quarantined) for inspection.

### 2.7 Recovery of interrupted operations
Jobs that were pending at backup time (HIS scans, outbound transfers) complete **once** after the restore and a duplicate queue message is rejected (verified by the existing recovery journey and the P7 drill). After any restore check: `nipt.cmd health` (backlog drains, no reconciliation items) and the Results/Transfers page for transfers in `RECONCILIATION_REQUIRED`.

### 2.8 Disaster recovery on a rebuilt host
1. Install the same package version on the new host (`Install-Nipt.ps1`) with the same `-Instance`; accept a throw-away first installation.
2. Copy the backup folder and the escrowed `backup.key` to the new host; place the key at `secrets\backup.key`.
3. `nipt.cmd stop`; `nipt.cmd restore --backup <folder> --activate --confirm-source-fenced yes` (the freshly installed database is the "source" and is unchanged since its own first backup only if no one used it — if the gate refuses, use a clean installation).
4. If the photo root was relocated or the host paths differ: `nipt.cmd photos restore <photo backup> <rootId> <path>` then `nipt.cmd photos relocate <rootId> <path> "<reason>"`, then `nipt.cmd photos verify`.
5. Replace the test TLS certificate, check health, verify counts and a sample of results, and record RTO (§2.11).
Production restore requires separate explicit Owner authorization.

### 2.9 Run Photo Evidence files
Default root: inside `data\files`, therefore inside every operational backup and restored with `restore`. After activation the database still points at the old absolute photo path; `photos verify` must report consistent, and `photos relocate <rootId> <restored path> "<reason>"` points the root at the restored copy (all files are hash-verified first and the move is append-only history). For a relocated root: `nipt.cmd photos backup <empty folder>` (verified copy + `manifest.json` + `manifest.sha256`) on the same schedule as the database backup.

### 2.10 Photo hash verification after restore
`nipt.cmd photos verify` (database ↔ file consistency; orphans are reported, never deleted) and fetch an original through the application (the server verifies SHA-256 on every read). Both are part of rehearsal step S13.

### 2.11 Measuring RPO and RTO on the hospital host
```powershell
nipt.cmd dr-drill
```
Takes a timed backup, restores it into a quarantined database, verifies, removes the copy and restarts the services. It reports `backup`, `restore` and `restartAndHealthy` seconds and sizes. **RPO** = the interval between successful backups (24 h with a daily schedule; shorter needs WAL archiving, which this package does not install). **RTO** on the same host ≈ restore + restart; on a rebuilt host add installation time. The hospital's required RPO/RTO is not defined by the project (Q-I6).

## 3. Measured on the developer machine (not hospital figures)

See `docs/p8/evidence/windows-rehearsal-*.json`, steps S07, S08, S13, S13b, S13c. The measurements come from a laptop-class host with a local SSD, a local backup folder, 45 test cases, 2 test releases and one test photo; the database was a few tens of MB. Hospital volumes, NAS latency, antivirus scanning and the number of photos will be larger.

## 4. Hospital acceptance checklist (to be executed by IT; results blank)

| ID | Check | Procedure | Expected | Result, tester, date, evidence |
|---|---|---|---|---|
| BDR-01 | Key escrow | §2.1; restore on another host with the escrowed key only | restore verifies | |
| BDR-02 | Backup destination permissions | §2.2 as the scheduled task account | `set-backup-root` succeeds; scheduled run writes a backup | |
| BDR-03 | Schedule runs unattended | §2.3, leave overnight | a new verified backup every night; failures alert someone | |
| BDR-04 | Encrypted backup | open a backup folder | only `.enc` files, `manifest.enc`, `metadata.json`; no plaintext PDF or SQL | |
| BDR-05 | Restore to isolated database | §2.4 | `restoreVerified:true`, counts equal | |
| BDR-06 | Fingerprint verification | tamper test on a copy: change one byte of an `.enc` file | restore refuses (`BACKUP_CIPHERTEXT_MISMATCH`) | |
| BDR-07 | Activation guard | §2.5 with a changed source | `RESTORE_SOURCE_CHANGED_SINCE_BACKUP`; live system unchanged | |
| BDR-08 | Database fencing | after §2.6 query the old database | `nipt_runtime_quarantined()` is true; application refuses it | |
| BDR-09 | Interrupted operations | §2.7 | pending job completes once | |
| BDR-10 | Photo files | §2.9/2.10 | verify consistent; sample photo byte-identical after restore | |
| BDR-11 | RPO/RTO measured | §2.11 on production-sized data | figures recorded and compared with the hospital target (Q-I6) | |
| BDR-12 | Rebuilt-host recovery | §2.8 on a spare host | service restored; RTO recorded | |
| BDR-13 | Drill schedule | IT policy | weekly restore check and quarterly full DR drill (Plan §14.6) scheduled and owned | |

Nothing in this checklist is signed or complete. Until BDR-01…BDR-13 have hospital results, Backup/DR acceptance is **NOT ACCEPTED**.
