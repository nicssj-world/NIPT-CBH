# P8 Windows offline installer — rehearsal evidence (final, 2026-10-19)

Source commit of the tested package: `dea292765c2083d4adc7def1f1b8d187f18c8bc0` (descends from the frozen baseline `baseline-pre-p8-win-20261019`, `3d11e62`). Package: `nipt-cbh-1.0.0`, manifest SHA-256 `4d4383d56bbcaa8da7ca744cb62273b3a4a30921ee095990563aae1950644bc3` (see `docs/release/artifact-record.json`).

Environment: one Windows 11 Home host (build 10.0.26300), Node 24.15.0, PostgreSQL 17.11 binaries, Chromium headless shell 1248 and PowerShell 7.6.6 taken from the package, Microsoft Excel installed, loopback ports 19860–19863, **user-level** startup task (the session was not Administrator), an installation root containing spaces, synthetic test data and the approved owner master workbook. Nothing was pushed, merged, deployed, applied to Production or connected to a HIS. This is the developer machine, **not hospital infrastructure**.

## What was run (two separate runs, reported separately)

| Run | Scope | Result | Evidence |
|---|---|---|---|
| **Direct-Excel run** (`rehearse.ts --fresh-build`) | all 22 steps S00–S16 (incl. S02b, S06b, S06c, S13b, S13c), **one uninterrupted run, 39 minutes**, fresh `next build`, packages rebuilt from the commit | **22 of 22 passed** | `docs/p8/evidence/windows-rehearsal-final-direct-22steps.json` |
| **Bridge-Excel run** (`rehearse.ts --excel-mode bridge --only S03,S04,S05,S06,S06b,S07,S08,S13b,S14,S15`) | install with the Excel bridge, health, crash recovery, installed operational journey, HIS file check, backup, restore, DR drill, stop/start, uninstall; the other steps were not selected | **10 selected steps passed**, the rest recorded as not selected | `docs/p8/evidence/windows-rehearsal-final-bridge-selected-steps.json` |

Earlier runs stopped at defects that were fixed and are kept for history in `docs/p8/evidence/superseded/` and in the commit log; the table above does not combine them with the final runs.

## Direct-Excel run, step by step

| Step | What was proven | Time |
|---|---|---|
| S00 | five signed packages built from the committed source after a fresh `next build` (full 1.0.0 with 23 579 files; app-only 1.0.1 with a failing migration, 1.0.2 whose web cannot start, 1.1.0 and 1.1.1 with an additive migration) | 413 s |
| S01 | signature and exact file set verified; one appended byte → `PACKAGE_CHECKSUM_MISMATCH`; another public key → `SIGNATURE_INVALID` | 78 s |
| S02 | preflight refuses an occupied port, a non-empty root, a **non-ASCII root** and a missing master workbook | 23 s |
| S02b | read-only host check on this host: 22 PASS, 2 WARN (not elevated; DHCP address), 10 INFO, 0 FAIL | 8 s |
| S03 | install into a root with spaces: runtime copy, private PostgreSQL, 47 migrations, six accounts, startup task, services, **first verified backup** | 47 s |
| S04 | four listeners; secrets folder not readable by broad groups; `nipt_web`/`nipt_worker` not elevated; operational mode; `pg_hba` without `trust`; Excel mode direct | 2 s |
| S05 | worker, web and renderer killed → restarted; supervisor killed → services recovered (children did not survive the kill, so stale-child reaping was **not** triggered) | 10 s |
| S06 | **installed operational journey** over HTTPS: 45 test patients, 2 certified releases, 2 outbound transfers, no browser errors | 417 s |
| S06b | the 2 RES + PDF + OK + per-release backup written by the installed Worker conform to the frozen contract (`docs/p8/evidence/his-outbound-contract-report.json`); both transfers `AWAITING_CONFIRMATION`; `hisConfirmed` is false for all | <1 s |
| S06c | a synthetic photo uploaded over HTTPS; the original served byte-identical (SHA-256); storage consistent | 2 s |
| S07 | encrypted backup (97 files); business data unchanged | 7 s |
| S08 | restore into a new quarantined database (140 tables, 97 files, 45 cases); the live installation untouched | 8 s |
| S09 | tampered package refused; failing migration → old release keeps running; a release that cannot start → automatic rollback after 112 s, data unchanged | 225 s |
| S10 | upgrade 1.0.0 → 1.1.0: pre-upgrade backup, forward migration, switch, health, data intact | 75 s |
| S11 | rollback refused (`ROLLBACK_REQUIRES_DATABASE_RESTORE`) because the database is newer | 6 s |
| S12 | application-only upgrade 1.1.0 → 1.1.1 and compatible rollback | 29 s |
| S13 | DR: fence confirmation missing → refused; an older backup over changed work → `RESTORE_SOURCE_CHANGED_SINCE_BACKUP`; `restore --fresh --activate`: source fenced, restored database active, data equal; the **photo is still served byte-identical, storage consistent, root relocated to the restored copy and verified again**; the restored installation backs up again | 33 s |
| S13b | DR drill (measurements on this host, 72 MB, 141 tables, 97 files): backup 3.9 s, restore 1.9 s, restart to healthy 6.2 s, nothing activated, drill copy removed | 12 s |
| S13c | a Thai backup destination is refused (`BACKUP_ROOT_MUST_BE_ASCII`); an ASCII destination set; daily backup task registered and **executed by Task Scheduler**; a new verified backup appeared; task removed | 9 s |
| S14 | graceful stop (worker over IPC), no listener left; start recovers | 6 s |
| S15 | uninstall keeps data by default; `--remove-data` removes everything; no leftover process | 16 s |
| S16 | the installed CLI removes its own installation (root path with spaces) | 8 s |

Unit tests for the installer logic: `tests/unit/win-installer-lib.test.ts` (version order, configuration limits incl. Excel/SYSTEM and HTTPS host rules, ASCII/space roots, package authenticity, schema-compatibility and rollback gates, health verdict, supervisor backoff, CRLF ledger parsing).

## Bridge run

Installed with `--excel-mode bridge` (the services still ran as a user-level task). Health reported the bridge idle (`excelBridge: "idle"`), and the installed operational journey passed (45 cases, 2 releases, 2 transfers, no browser errors, 417 s) with the supervisor setting `NIPT_NATIVE_EXCEL_SPOOL`; the application's export code uses the spool exclusively when that variable is set, so the Task List PDFs of the journey went through the bridge. This is an inference from the code path; the bridge's own log was removed with the installation. It does **not** test the SYSTEM account or a reboot.

## Defects found by the rehearsals and fixed

| Defect | Effect | Fix |
|---|---|---|
| `pg_ctl start` with captured stdio | installer hung until PostgreSQL exited | stdio ignored |
| Next standalone output links packages by symlink | package build failed without symlink privilege | dereference when staging |
| Windows `psql` ends lines with CRLF | every matching migration checksum looked "changed": upgrade wrongly refused | `parseLedgerOutput` + regression test |
| Installed CLI deleting its own `node.exe`; deferred-removal `cmd` quoting with a path containing a space | `--remove-data` failed / never completed | delete everything else, verbatim `cmd /d /s /c` |
| **PostgreSQL cannot start from a non-ASCII root** (`initdb` looked for a path of `?`) | install failed on a Thai folder name | preflight refuses a non-ASCII root (`INSTALL_ROOT_MUST_BE_ASCII`) |
| **`pg_dump.exe` cannot write into a non-ASCII backup folder** | a scheduled backup failed with a Thai destination | `set-backup-root` and the host check refuse it (`BACKUP_ROOT_MUST_BE_ASCII`) |
| Photo/HIS verifier assumptions (Origin header, `photoId`, per-release backup layout) | rehearsal tools failed, product unaffected | tools corrected |
| Activation-gate refusal reported generically | unclear message | mapped to `RESTORE_SOURCE_CHANGED_SINCE_BACKUP` |

## Not exercised (and why)

- **Elevated SYSTEM startup task, Windows reboot recovery, SYSTEM + Excel bridge** — the session was not Administrator and no authorized test host exists. Commands and acceptance steps are in `docs/release/windows-installation-runbook.md` §4. These are **not passed**.
- Stale-child reaping branch of the supervisor (triggered by no test; defensive code).
- LAN browser access, hospital certificate, DNS, firewall rule, UNC/SMB shares, NAS backup target, key escrow, physical power loss, antivirus/EDR on the hospital image, code-signing/MSI wrapper.
- Activating an *older* backup over changed work is deliberately refused by the existing gate and has no automated override.
- Clinical acceptance, Staff UAT, OD-R1b label test and HIS integration remain open (`docs/release/outstanding-gap-register.md`).
