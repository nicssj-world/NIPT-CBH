# P8 Windows offline installer — rehearsal evidence (2026-10-19)

Environment: one Windows 11 host, Node 24.15, PostgreSQL 17 binaries and Chromium from the package, loopback ports 19860–19863, test accounts and the approved owner master workbook, **user-level startup task** (the session was not Administrator). Baseline `baseline-pre-p8-win-20261019` (3d11e62). Raw evidence: [run 8, S00–S15](evidence/windows-rehearsal-run8-S00-S15.json), [re-run, S16](evidence/windows-rehearsal-rerun-S16.json), [installed journey](evidence/windows-installed-journey.json). Nothing was pushed, merged, deployed, applied to Production or connected to a HIS.

## Result

**Passed 17 of 17 steps.** S00–S15 are from one uninterrupted run (run 8, source `7419b74`, about 24 minutes). S16 failed in that run and passed after the fix in a targeted re-run (`--only S00,S16`, source `b37ccfa`); the fix touches only the branch S16 exercises. Earlier runs 3–7 stopped at defects listed below, each fixed and rehearsed again.

| Step | What was proven | Time |
|---|---|---|
| S00 | five signed packages built from the committed source (full 1.0.0, app-only 1.0.1 with a failing migration, 1.0.2 whose web cannot start, 1.1.0 and 1.1.1 with an additive migration); 22 449 files in the full package | 410 s |
| S01 | signature and exact file set verified; one appended byte → `PACKAGE_CHECKSUM_MISMATCH`; a different public key → `SIGNATURE_INVALID` | 68 s |
| S02 | preflight refuses an occupied port, a non-empty root and a missing master workbook | 18 s |
| S03 | install: runtime copy, private PostgreSQL cluster, 47 migrations, six accounts, startup task, services, **first verified backup** | 47 s |
| S04 | four listeners; secrets folder not readable by broad groups; `nipt_web`/`nipt_worker` not elevated; operational mode; `pg_hba` has no `trust` | 1 s |
| S05 | worker, web and renderer killed → restarted; supervisor killed → restarted, services healthy | 10 s |
| S06 | **installed operational journey** over HTTPS: 45 test patients, 2 certified releases, 2 outbound transfers, no browser errors | 421 s |
| S07 | encrypted backup of the working installation (95 files); business data unchanged afterwards | 9 s |
| S08 | restore into a new quarantined database (140 tables, 95 files, 45 cases); the live installation untouched | 8 s |
| S09 | tampered package refused; failing migration → old release keeps running, nothing switched; release that cannot start → automatic rollback after 113 s, data unchanged | 232 s |
| S10 | upgrade 1.0.0 → 1.1.0: pre-upgrade backup, forward migration `105_p8_rehearsal_marker.sql`, switch, health, data intact | 75 s |
| S11 | rollback refused (`ROLLBACK_REQUIRES_DATABASE_RESTORE`) because the database is newer; nothing changed | 5 s |
| S12 | application-only upgrade 1.1.0 → 1.1.1 and compatible rollback to 1.1.0 | 29 s |
| S13 | DR: no fence confirmation → refused; an older backup over changed work → `RESTORE_SOURCE_CHANGED_SINCE_BACKUP` (live data untouched); `restore --fresh --activate`: source fenced, restored database active, data equal, the restored installation backs up again | 32 s |
| S14 | graceful stop (worker over IPC, no listener left), start recovers | 9 s |
| S15 | uninstall keeps data by default; `--remove-data` removes everything; no leftover process | 13 s |
| S16 | the installed CLI removes its own installation (root path contains a space) | 6 s |

Unit tests: 17 in `tests/unit/win-installer-lib.test.ts` (version order, configuration limits, package authenticity incl. tamper/forgery/unsafe paths/symlinks, schema-compatibility and rollback gates, health verdict, supervisor backoff, CRLF ledger parsing).

## Defects found and fixed during the rehearsals

| Defect | Effect | Fix |
|---|---|---|
| `pg_ctl start` run with captured stdio | installer hung until PostgreSQL exited | stdio ignored |
| Next standalone output links packages by symlink | package build failed without symlink privilege | dereference when staging |
| Windows `psql` ends lines with CRLF | every matching migration checksum looked "changed": upgrade wrongly refused | `parseLedgerOutput` + regression test |
| Installed CLI deleting its own `node.exe` | `--remove-data` failed with EPERM | delete everything else, deferred removal of the rest |
| Deferred removal quoting | never ran for a root path containing a space | verbatim `cmd /d /s /c` arguments (reproduced in isolation first) |
| Restore activation error | gate refusal was reported as a generic failure | mapped to `RESTORE_SOURCE_CHANGED_SINCE_BACKUP` |
| Rehearsal assertions | expected the audit chain not to grow, children to outlive the supervisor, a backup-then-restore with running writers | corrected; `restore --fresh` added for the supported drill |

## Not exercised (and why)

- **Elevated SYSTEM startup task** — the session was not Administrator; the code path exists (`-TaskMode system`) and refuses without elevation, but was never run.
- **Stale-child reaping** — under Task Scheduler the job object ends the services with the supervisor (`childrenSurvivedSupervisorKill: 0`), so the reaping branch was not triggered; it is covered only by code review.
- Hospital TLS/DNS/LAN publication, UNC/SMB shares and service-account ACLs, NAS/WAL backup targets, key escrow, physical power loss, antivirus policy, code-signing and an MSI/EXE wrapper.
- Activating an *older* backup over changed work is deliberately refused by the existing gate and has no automated override.
- Clinical acceptance, Staff UAT, OD-R1b label test and HIS integration remain open in the go-live readiness report.
