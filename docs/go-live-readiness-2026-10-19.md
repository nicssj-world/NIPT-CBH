# Go-Live readiness: technical verdict for 19 October 2569 (2026-10-19)

Branch `feat/task-list-parity-p0`. Updated after the three Consent Owner decisions (HEAD `58b2083`, migration 102). Nothing was pushed, merged or deployed, and no production system or real database was touched. Everything below ran on synthetic data in isolated local databases.

## Verdict

| Scope | Technical verdict |
|---|---|
| Software candidate at this HEAD (every automated gate) | **GO** |
| Staff UAT / pilot on a controlled synthetic or operational-test installation | **GO**, after the installation steps below |
| **Clinical Go-Live on 19 Oct against the hospital HIS, on-prem hospital host and real patients** | **NO-GO**: the critical blockers below are external or Owner decisions, not code defects |

## Gates at HEAD

| Gate | Result |
|---|---|
| Lint / typecheck / source guard / production build | PASS |
| Vitest, native PostgreSQL 17 + native Excel | **2148 / 2148 passed** (152 files, 0 skipped) |
| Playwright, 18 specs | **84 passed, 0 failed, 2 skipped** (P6 CLI sandbox and P8 signed-installed: they need the packaged environment, not run here) |
| Deployment contracts (`node --test`) | 13 / 13 passed |
| Operational positive journey, real browser + Worker + isolated PostgreSQL + native Excel | **PASS**, 0 browser errors (re-run on HEAD `58b2083`: 24 events, 0 browser errors) |

The journey covers:
- HTTPS login and 45 registered cases;
- Worker PET ingestion and clinical review;
- S2 `BASER` label print and reprint;
- native F2–F5 documents and HALOS read-back;
- QC5, certification and P6 PDF → RES → backup → BOM-only OK, with HIS confirmation still false;
- backup rejected while a Worker is live;
- fenced restore to a new database, with the pending job completed exactly once and no duplicate release after the Worker restarts.

## What was checked and fixed in this pass

1. **Digital Consent (kept intact).**
   - New `tests/db/digital-consent-evidence.test.ts` proves the chain: the consent can name only the request's Doctor Registry version, and its stored signature travels into the immutable document.
   - The patient signs on the Signature Pad: 12 acknowledgements, vector + PNG + hash. The final consent exists only after the preparer re-authenticates.
   - A real Chromium render of the signed consent shows the decision, the doctor's name and both signature images.
   - The audit events are ordered and the hash chain is valid.
2. **Bug found and fixed: Paper Consent could be a silent default.**
   - LAB_DIRECT cases started with `consent_mode='Paper'`. After the marker-only change, every Lab-registered case would have passed the consent gate with nobody choosing it.
   - Consent now always starts Electronic, and Paper exists only after an explicit "ใช้ Paper Consent".
3. **Migration 101.**
   - Applied on real PostgreSQL 17.11 (44 migrations).
   - A populated database at 100 was cloned and upgraded: the ledger checksums verify, and no existing round's readiness changed.
   - Rollback is a new forward migration (the 088 body is in `docs/p2-paper-consent.md`).
   - Not applied to any real database.
4. **The 5 failing Playwright tests: all stale tests, none a product bug.**
   - Four registry screenshots were pre-UX-V2 baselines: the old sidebar against the approved premium UI, with identical data. They were refreshed.
   - The PDF byte-reuse test looked for a /health button that was removed in `0fd4a89`. It now calls the unchanged preview API directly, and still checks that bytes are identical and another user gets 403.
   - The registry spec also assumed a pristine registry. It now filters to the three seeded cases, so it no longer depends on spec order.
5. **Runtime bug found by the operational journey and fixed: CSP.**
   - Browser console errors appeared on every page (login, case and result pages). `next/image` emitted an inline style, and two iframes used style props, both blocked by the app CSP (`style-src` nonce, no `unsafe-inline`).
   - Logos are plain `<img>` now and the iframes use a CSS class.
6. **Stale harness assertions corrected.**
   - The journey still expected the pre-OD-R1 S2 label (base without R). It now asserts `BASER`.
   - The recovery check used the shell's `whoami`; it now uses `System32\whoami.exe`, like the backup tool, so it is shell-independent.
7. **One transient Windows crash.** A Vitest worker process crashed once on `p6-native` (exit code 3221226505 at startup). The file passed on two reruns (33/33) and in the next full run.

## Evidence inventory: what is tested and what is not

| Area | Tested (synthetic / local) | Not accepted or not run |
|---|---|---|
| Windows host runtime | Windows 11 + Node 24 + native PostgreSQL 17 + native Excel A4 export (2/2/2/1/1/1 pages) + HTTPS + Worker process, exercised by the operational journey | No Windows installer, service wrapper or signed package exists (packaging was out of scope). The signed install/upgrade/rollback evidence (P8) is a Linux Docker synthetic candidate. The P8 installed spec was skipped. |
| Worker | Singleton lock, least-privilege role, kill/restart, retry/idempotency, graceful stop; on-demand PDF scan only (no timer) | Service-account behaviour under the hospital OS |
| Database | 44 migrations forward-only with a checksum ledger; real PG 17 upgrade 100→101 on a populated clone; role/privilege guards | Hospital PostgreSQL sizing, roles and ownership under their policy |
| Backup / restore | Encrypted backup, fenced restore to a new DB and file store, live-Worker backup refused, pending job completes once after restore (journey today; P7 digest drill 2026-10-13: 113 tables / 168 rows equal) | The P7 dedicated-cluster drill was not re-run today. NAS, ACL, WAL/base-backup schedule, key escrow, RPO/RTO are IT-owned and not installed. |
| HIS PET in | ZIP-sample PET through the Worker (Settings path A→B), identity/LN/round rules, S2 PET | Real LAN/UNC/SMB share, service-account ACL, real HIS PET stream |
| RES / PDF / OK out | Synthetic RES, PDF, backup and BOM-only OK, written by the Worker to configured paths; `hisConfirmed=false` | Versioned RES profile (Q-I5, incl. DOB P[7]), real destinations (Q-I3), real ACK / reconciliation (Q-I4), AT-HISOUT-LAN-01 **NOT RUN**. A copied file is never reported as HIS-accepted. |
| Labels | 50×20 mm render parity; S2 `BASER` / `BASEDR` | Physical printer calibration (Q-I7) and the OD-R1b legibility check |

## Critical blockers for a clinical Go-Live (all outside the code)

1. **HIS integration is unproven on the hospital network.**
   - Missing: the share, ACLs and service account (Q-I3), the RES profile (Q-I5) and the confirmation method (Q-I4).
   - The signed LAN test has not been run.
2. **No packaged Windows deployment for the hospital host.** Decide the target (Docker on Windows or a Windows service), build the signed bundle from a clean committed HEAD (it includes migration 101), and rehearse install/upgrade/rollback there.
3. **Production backup and DR are not installed or accepted.**
   - Missing: NAS, schedule, key escrow, and RPO/RTO.
   - A restore drill is required before go-live.
4. **Governance and acceptance not signed.**
   - Staff UAT was not executed (P8-E01).
   - AL-5 / AL-7 remain HOLD.
   - DCC approval of the electronic forms is pending (ANC forms are DRAFT PREVIEW).
   - OD-06 channel mode is pending.
   - The OD-R1b physical label test must pass before clinical use.
5. **Migrations 099, 100, 101 and 102 are approved for synthetic databases only.** Applying them to the operational database needs an Owner-authorised procedure with a verified backup first.

## Consent Owner decisions: closed (2026-10-18)

The three open questions of the previous report were decided by the Owner and implemented (see [p2-paper-consent.md](p2-paper-consent.md) and the Owner Decision Register):

- **Paper refusal.** ANC has a "ผู้ป่วยไม่ยินยอม (Paper)" button. A refusal is separate from the marker and blocks Clinical review, Lab gates, result release and HIS release. Withdrawal still blocks.
- **DCC form signatures.** The system's signed Digital Consent PDF already shows both signatures and is unchanged. Previews stay DRAFT. Paper creates no digital signature or inferred decision.
- **Marker-only.** Unchanged since `719d56b`.

Remaining notes:
- **Mistaken refusal.** A refusal recorded by mistake can be lifted only by a later decisive Granted decision (a verified paper review through the API, or a completed Digital Consent signing). The dialog warns before saving. There is no UI to undo it.
- **Application vs schema.** The application at this HEAD needs migration 102: the Lab gate reads `p2_consent_latest_decision`. The installer applies migrations before it starts the application, so only the order matters. An application-only rollback to the previous version is safe.
- **Housekeeping.** The isolated P0 Postgres holds about 130 leftover synthetic databases. They are harmless and are not production.

## Update after the Windows installer and final Release Candidate (2026-10-19)

The "no packaged Windows deployment" blocker above is now **partly closed**: a signed Windows offline package exists and was rehearsed on a developer machine (install, upgrade, rollback gates, backup/restore/fresh activation, crash recovery, uninstall, installed operational journey). It is **not** proven under the SYSTEM account, after a reboot, on a LAN or on hospital infrastructure. The verdict stays **software GO, clinical NO-GO**. See `docs/release/release-candidate-report.md` and `docs/release/outstanding-gap-register.md`.
