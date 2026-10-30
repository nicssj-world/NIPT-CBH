# OWNER LOCK — NIPT-CBH Hospital Installed Baseline

> **Owner confirmation: 27 October 2026.** This document supersedes earlier contradictory version assumptions. Do not change this baseline without a later explicit Owner confirmation that a new installation/update actually completed on the hospital server.

## Confirmed hospital state (Owner statement)

- **Product:** NIPT-CBH (on-premises Windows hospital server).
- **Currently installed version:** **1.1.0**.
- **Installation type:** **Fresh FULL INSTALL** performed on the morning of **2026-10-27**. Older installed versions are no longer used.
- **Next update must target:** **that installed 1.1.0 baseline only**. Update rather than reinstall.
- **Not hospital-installed baselines:** 1.2.0, 1.2.1 and 1.2.2. Those packages/builds may exist in developer worktrees but must not be treated as installed.
- **Installed exact revision / SHA:** not independently confirmed from hospital runtime. A source-package revision shown in a build record is *not* proof of what is installed.

## Mandatory release instructions for Claude, Codex and future assistants

1. Read this file and README before beginning any NIPT-CBH Windows update work. Use only the owner-confirmed **1.1.0** hospital baseline; do not spend effort rehearsing unsupported upgrade chains or build updates based on 1.2.x.
2. Before producing or installing an EXE, inspect the hospital's existing `install-state.json` read-only and confirm `current.version`, `current.revision`, installation root, and compatibility with the intended update. If access is unavailable, label hospital compatibility **NOT VERIFIED**; do not invent an installed revision.
3. Work in an isolated source/worktree; do not combine unrelated Claude/Codex work, overwrite active worktrees, clear another install/registry, or discard unrelated changes. Do not push/deploy or modify hospital runtime without an explicit instruction.
4. Produce one targeted Windows Update.exe (not a new full installer), pass isolated **1.1.0 → targeted Update** E2E rehearsal, migration/health/persistence/regression and backup/restore verification. No hospital installation before PASS and version compatibility.
5. Preserve all existing patient and case records, HIS PET+OK / RES+OK files, NAS paths, reports, authentication, Audit Log, file store and settings. Update must never automatically enable live HIS Auto Scan or import all discovered HIS files.
6. Admin Settings behavior requested by Owner: APP_ADMIN may directly save/activate routine system configuration including HIS Auto Scan without a second approver, mandatory free-text reason, or a user-managed settings-test queue. Keep automatic audit, validation, and distinct controls for clinical result release/certification.
7. A version number higher than 1.1.0 in a development EXE is not evidence of server installation. Change this documented base only after explicit Owner confirmation of a completed subsequent install.

## Current scope and distinction

| Item | Current state |
| --- | --- |
| Hospital Full Install baseline | **1.1.0 — Owner confirmed, installed 2026-10-27 morning** |
| 1.2.x as installed version | **No — superseded/development branch assumptions, not hospital baseline** |
| Next desired deliverable | Admin Settings / HIS Auto Scan **Update.exe compatible with the installed 1.1.0** |
| Proposed `NIPT-CBH-Update-1.1.1.exe` | Candidate build only; cannot infer deployment or rehearsal PASS |
| Exact hospital source revision | **NOT VERIFIED** until inspected read-only on hospital host |
| Hospital installation of a new update | **NOT DONE / DO NOT CLAIM** without evidence |

## Change control

This is a user-confirmed project baseline, not a statement that the developer source tree is already synchronized with the live server. Reconfirm the precise installed revision before packaging. Historical README sections about Synthetic development are not operational release authority.
