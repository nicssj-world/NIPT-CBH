# NIPT-CBH v1.1.3 — Master Checklist

Branch `feat/v113-integrated` (worktree `D:\NIPT-CBH-v113`). Base `origin/main` 31cc9c1 (Production v1.1.2) + PR #14 merge a76c33e (Fast Development Pipeline, tools/docs only, merged cleanly).
Migrations 181–185 (Production range 001–180). Status values: NOT STARTED · IN PROGRESS · PASS · PARTIAL · FAIL · BLOCKED · NOT APPLICABLE. PASS needs a test result, not code existing.
Old WIP `origin/backup/home-update-113-20261030` (b5a62ff) was never cherry-picked as a whole; files were ported one by one after comparison.

## Tooling record
- **UX UI Pro Max and Impeccable skills: UNAVAILABLE** (not installed; searched plugins, skills and the skill list on 2026-11-03). Not used and not claimed. UX was done against `DESIGN.md` and existing components and checked in a real browser (below). The skill-specific review remains PENDING.
- Node 24.22 from `C:\NIPT-CBH\toolchain\node` (read-only use); PostgreSQL 17.11 via the repo's native harness and the worktree-local dev cluster (`.local/dev`, ports 3100/3101/55452, stopped after use). No Production, Staging, other worktree or shared runtime was touched.

## Decisions recorded (Owner may veto)
1. EQA is an ordinary LAB_DIRECT case through the normal Task List/QC/HALOS/ReadyGen/report/certification path. Differences, all enforced in code or the database: no HIS PET, never any HIS outbound.
2. The GenQA/EMQN 2026 referral card has **no EDD**. The engine's GA cross-check needs an anchor, so one is **derived internally** (collection date + 280 − GA-by-scan days). It is not stored as patient data and not printed; the report prints GA only.
3. EQA reporting option 3 (13/18/21/X/Y + fetal sex): RG-11 passes for EQA only after the normal report-content review; patient RG-11 is unchanged.
4. HN of an EQA case is the organizer's "Hospital No." (e.g. `03NIPT26`). The PDF HN reader accepts alphanumeric references (superset of digits).
5. EQA is excluded from the patient NAS archive until a storage policy is verified.

## Phase 1 — Worker Queue (PARTIAL)
| ID | Requirement | Decision | Status | Evidence |
|---|---|---|---|---|
| Q1 | Admin overview, evidence-derived status, paging, no payload | MODIFY old `admin-center` | PASS | `worker-queue-113` PGlite 7/7 |
| Q2 | pg-boss read-only overview | old 170 used `createdon/startafter/retrycount`; pg-boss 12.37.1 has snake_case → migration 182 | PASS | native, real pg-boss |
| Q3 | Clear = immutable request; Worker decides; web cannot touch job state | MODIFY (167/168 `p_actor` functions dropped) | PASS | native role tests |
| Q4–Q6 | Pending cancel, Dispatched cancel only on pg-boss proof, start-during-cancel not cancelled, 3-session race | new `queue-clear-worker` | PASS | PGlite + native `worker-queue-native` 4/4 |
| Q7 | Archive clear: unclaimed / live claim / expired claim / uncertain publication | old archive-worker patch + new | PASS (DB) | `worker-queue-113`; native cancel-during-NAS-write NOT run |
| Q8 | Retry | archive FAILED via existing probe | **PARTIAL** — outbox and pg-boss Retry MISSING | – |
| Q9 | External HIS reconciliation | – | **BLOCKED** — only flagged `RECONCILIATION_REQUIRED`; no automatic retry | – |
| Q10 | UI: tabs, status filters, pager, consequence dialog | MODIFY | PASS (browser) | `qc.mjs`: Worker Queue loads, 3 tabs select and render, Clear All disabled when empty, 390 px no page scroll, LAB redirected, no page errors |
| Q11 | Worker restart/recovery | – | **NOT STARTED** | – |

## Phase 2 — PET case history/count (PASS, browser PARTIAL)
`packages/inbound/case-pet-evidence.ts`; five separate counters (files, distinct contents, resend sightings, verified HIS receipts, specimen rounds); case-level scan executions explicitly not attributable. Raw `his_inbound_scan_run` untouched (old 164/166 dropped). `case-pet-evidence-113` 2/2. Panel rendered in the existing case workspace; **browser check of the panel not run**.

## Phase 3 — EQA (PASS in tests; Owner browser acceptance pending)
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| E1 | Immutable `eqa_case` (organizer, year, sample ref, referral-card identity, GA, collection date, pregnancy); only a new LAB_DIRECT case with no PET/order/release/migration record | PASS | `eqa-no-his-113` 11/11 PGlite; `eqa-no-his-native` 3/3 PostgreSQL 17, `app_rw`/`worker_rw` |
| E2 | DB: no `p6_transfer`, no outbox naming EQA case/release/version/transfer, no HIS receipt (`his_order`), `p6_release_eligible` wrapped | PASS | same; also asserted end to end |
| E3 | Round 1 local receipt allowed only for EQA (trigger, migration 184); LN Halos issuer unchanged | PASS | `eqa-receipt-113` 3/3 (patient round-1 local receipt still refused) |
| E4 | Lab gates BG-01/04/05/06 narrow EQA branches; BG-02 acceptance and all other gates unchanged | PASS | `eqa-receipt-113`; batch placement succeeded in e2e |
| E5 | Release guard accepts EQA at the two branches that required "clinical ready" (migration 185 patches the CURRENT definition, fails if shape changes) | PASS | e2e |
| E6 | Result gates RG-09/10/11 EQA branches; certification takes the outbound-suppressed branch | PASS | e2e |
| E7 | Normal report engine, ReadyGen interpretation, Word DOCX→PDF, signers, certification; referral-card identity; vendor (NIFTY) export | PASS | `eqa-native-pathway-113`: EQA singleton + EQA twins + patient in one Run, Word-rendered signed PDFs CertifiedReleased; PDF has card name/HN/GA and no EQA/GenQA/EMQN text; EQA: 0 outbox, 0 transfer, eligible=false, forged outbox refused; patient: outbox 1, eligible=true; no archive job for EQA |
| E8 | EQA not in patient NAS archive | PASS | e2e + `eqa-no-his-113` |
| E9 | GenQA submission copy (logo/authorisation removed, provider lab reference added, one PDF per case) | **NOT STARTED** — original certified PDF is never altered; submission status not recorded (no verifiable evidence) | – |
| E10 | Twin fetal-sex wording for DCDA | uses the existing twin template/interpretation holds; no Y-only inference added | PARTIAL — Owner/clinical review of the twin PDF content pending |

## Phase 4 — Quality Control (PASS in tests and browser)
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| C1 | EQA registry: year/search/paging, LN/LN Halos, Run, status, report state | PASS | `eqa-registry-113` 2/2; browser |
| C2 | Report access from the EQA list: view, download, print, certification details, sample detail; one authoritative report; no regeneration; no filesystem path in the browser; server-side authorisation; access logged | PASS | `report.mjs` 15/15: same bytes for view and download, print frame created and not visible, ANC 403, anonymous 401, access log +3, version count unchanged |
| C3 | EQA registration form from the referral card | PASS | browser: registered, LN Halos issued without PET, duplicate refused with a specific message |
| C4 | IQC PC (slot 1) / NC (slot 25) values from the latest workbook revision; keys from the approved master (`slot.N.libraryQc` = ng/uL); Blank/patients excluded; no thresholds, means, SD or pass/fail | PASS | `eqa-registry-113` (DB); browser empty state; **real-data view PARTIAL** — no operational Run in the dev DB |
| C5 | Draft preview of an unreleased report inside the EQA page | PARTIAL — links an existing draft version when present; ReadyGen preview itself is unchanged | – |

## Browser acceptance (real Chromium against the worktree dev stack)
`.local/browser/qc.mjs` 27/27 (two consecutive runs), `report.mjs` 15/15. Covers: LAB QC page, EQA registration, registry, search/empty states, IQC, keyboard focus moves, 390 px width with content (no page scroll; table scrolls in its own container), Worker Queue (3 tabs, status, mobile), LAB and ANC denied, ANC API 403.
Defects found by the browser and fixed: registration form nested inside the search form (submitted the wrong form); empty search fields coerced to year 0 (page error); print frame visible because the page CSP blocks inline style; generic error text for duplicates.
Observations, not caused by this work: Next dev server logs 33 CSP "inline style" errors on first load of every page (also `/lab`, `/cases`); one transient hydration warning seen once during an HMR window, not reproducible in 3 reruns. The certified-report download filename is the existing generic `synthetic-result.pdf`. On a phone the "Report" column is to the right of the scrollable table. **Not done:** keyboard-only walkthrough of every dialog, screen-reader pass, dark theme, the Owner's own acceptance.

## Regression record
| Revision | Scope | Result |
|---|---|---|
| ce9a477 + uncommitted results/archive edits | `tests/db`+`tests/unit`+`tests/permissions` | 1915 passed, 43 skipped, 0 failed (227 files) |
| 64b6aae | same + 2 native Word contracts | 1928 passed, 34 skipped, 2 failed (migration-099/100 pinned-prefix fixtures lacked the new `eqa_case`); fixed in test scaffolding `pre-102.ts`, both pass |
| 59e4e1f (final, clean tree) | full ESLint 0 problems; typecheck clean; tests/db+tests/unit+tests/permissions+task3-native-pathway+eqa-native-pathway-113 | 223 files passed, 8 skipped; 1932 tests passed, 34 skipped, 0 failed |
| 59e4e1f | native PostgreSQL 17 (worker-queue-native, eqa-no-his-native, archive-native) | 3 files, 10/10 passed |

## Open items that block a Release GO
- **HIS duplicate-transfer risk (Q9 / Q11):** in-flight HIS transmissions are only flagged, never reconciled; Worker restart recovery is untested. **EQA HIS bypass risk is closed by database guards and tests; keep it under review for any new outbound path.**
- Outbox / pg-boss Retry missing; NAS publish-versus-cancel race not run against a real share.
- HIS path "verify only" test (changing one outbound path validates all three) NOT RUN.
- Backup/restore, upgrade/rollback rehearsal, `release:preflight`, Windows package inspection NOT RUN.
- UX UI Pro Max / Impeccable reviews pending (skills unavailable).
- Owner acceptance of EQA report content (including the derived-EDD anchor and twin wording) and GenQA submission copy.
- Production: **NO-GO**; nothing deployed, nothing merged to main.
