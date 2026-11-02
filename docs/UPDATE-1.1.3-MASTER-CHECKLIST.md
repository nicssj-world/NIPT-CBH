# NIPT-CBH v1.1.3 — Master Checklist

Branch `feat/v113-integrated`, based on `origin/main` 31cc9c1 (Production v1.1.2). Migrations continue at **181** (Production range 001–180).
Status values: NOT STARTED · IN PROGRESS · PASS · PARTIAL · FAIL · BLOCKED · NOT APPLICABLE. PASS needs a test result, not code existing.
Old WIP: `origin/backup/home-update-113-20261030` (b5a62ff). Never cherry-picked as a whole; files are ported one by one after comparison.

## Tooling record
- UX UI Pro Max and Impeccable skills: **UNAVAILABLE** — neither is installed in this environment (searched `~/.claude/plugins`, `~/.claude/skills`, the skill list). Not used and not claimed. Substitute: the repository's own `DESIGN.md` / `PRODUCT.md` / existing component classes, plus the accessibility checks listed per item. Install the skills to run the formal review.
- Node 24.22 from `C:\NIPT-CBH\toolchain\node` (read-only use). `npm ci` done in this worktree. Native PostgreSQL 17.11 via the repository's native-archive harness (temporary cluster, removed after the run).

## Phase 1 — Worker Queue
| ID | Requirement | Source / decision | Status | Test | Result | Risk / remaining |
|---|---|---|---|---|---|---|
| Q1 | Admin overview of HIS outbox + NAS archive by category and evidence-derived status, paged, no payload | old `admin-center.ts` → **MODIFY** (rewritten: status derived from receipt/outcome, paging, filters) | PASS (DB) | `tests/db/worker-queue-113.test.ts` | 7/7 PGlite | Browser not yet run |
| Q2 | pg-boss read-only overview | old 170 → **MODIFY**: old SQL used `createdon/startafter/retrycount`, pg-boss 12.37.1 has `created_on/start_after/retry_count` (old would fail at call time) → migration 182 | PASS (native) | `worker-queue-native.test.ts` real pg-boss | 4/4 | none known |
| Q3 | Clear Selected / Clear All = immutable request only; Worker decides | old `admin-clear.ts` → **MODIFY**: web no longer writes `job_outbox`/`pdf_archive_job` (matches migration 160 principle); old 167/168 `p_actor` functions DROPPED (identity came from the app) | PASS | PGlite + native role tests | app_rw cannot update either table, cannot write outcomes; worker_rw cannot write requests | – |
| Q4 | Pending → Cancelled; completed receipt untouched | `queue-clear-worker.ts` (new) | PASS | `worker-queue-113` | – | – |
| Q5 | Dispatched cancelled only on pg-boss evidence (not started); else RECONCILIATION_REQUIRED; start-during-cancel not reported cancelled | new | PASS | PGlite fake boss + native real pg-boss | cancelled via `boss.cancel`; active → RECONCILIATION_REQUIRED | uncertain external HIS effect is only flagged, no automated reconciliation (see Q9) |
| Q6 | Multi-worker race | new | PASS | native, 3 concurrent sessions | 1 cancel, 1 outcome per job | – |
| Q7 | Archive clear: unclaimed → CANCELLED; live claim → stop before NAS write; expired claim / uncertain publication → RECONCILIATION_REQUIRED, never CANCELLED | old archive-worker patch (applied) + new | PASS (DB); native cancel-during-publication NOT YET | `worker-queue-113`, `archive-worker` unit | – | race with real NAS publish untested natively |
| Q8 | Retry (archive FAILED via existing probe, excludes cancel-requested) | existing `retryFailedArchive` + 1-line guard → **REUSE** | PARTIAL | route + UI wired; no browser test | – | outbox/pg-boss Retry **MISSING**; must not auto-retry a possibly-sent HIS transfer |
| Q9 | External HIS effect reconciliation | MISSING | BLOCKED | – | – | needs receipt/RES evidence model; fail closed (flag only) |
| Q10 | Admin page UX (tabs, status filters, pager, dialog with consequences, a11y) | old page → **MODIFY** | PARTIAL | tsc + eslint clean | – | real browser test + keyboard/responsive pass pending |
| Q11 | Worker restart/recovery | – | NOT STARTED | – | – | – |

## Phase 2 — PET case-level history/count
| ID | Requirement | Source / decision | Status | Test | Result | Remaining |
|---|---|---|---|---|---|---|
| P1 | Per-case counts kept separate: PET files, distinct contents, resend sightings, verified HIS receipts, specimen rounds; scan executions explicitly "not attributable to a case" | `his_inbound_file`/`his_inbound_source`/`his_order`/`specimen_round_current` read-only → new `packages/inbound/case-pet-evidence.ts` (**MODIFY**: old WIP had scan-run only) | PASS (DB) | `tests/db/case-pet-evidence-113.test.ts` | 2/2: S1 + same-bytes resend at another day = 1 file, 1 sighting; redraw S2 = 2 rounds/2 receipts/2 files; another patient's PET not shown; scan history delete still blocked | native roles not run; technical repeat is not a PET event (no count by design) |
| P2 | Shown in existing Case Workspace (no duplicate page) | `PetEvidencePanel` in `case-workspace.tsx`, payload `getCase().petEvidence` | PARTIAL | tsc/eslint; p2/lineage/inbound regression 80/80 | – | **Browser check not run**; historical-migration cases show "no PET evidence" instead of 0 (historical PET provenance via `migration_pet_binding` not yet surfaced) |
| P3 | Raw `his_inbound_scan_run` preserved | old 164/166 compaction and `queue.ts` hiding **DROPPED** | PASS | immutable-trigger assertion in P1 test | – | – |

## Phase 3 — EQA without PET
Audit result (current main): the PET-less analytical path already exists for LAB_DIRECT (`labOperationalRoute` passes BG-01..07 with paper markers), so **no Task List / gate change is needed for EQA**. The old WIP's BG-01/03 changes and `roundPetOrEqaOk` are DROPPED. Outbound pathways found by audit: (1) `p6_transfer` insert, (2) `job_outbox` `result_release_completed` at certification (`results/service.ts`), attestation withdrawal and P6 reroute, (3) `synthetic_outbound_retry` (HIS retry), (4) worker eligibility `p6_release_eligible`, (5) PET→`his_order` receipt, (6) NAS archive of `result_release_completed` (not HIS; excluded until storage policy verified).
| ID | Requirement | Decision | Status | Test | Result | Remaining |
|---|---|---|---|---|---|---|
| E1 | Immutable EQA classification (organizer, year, round, sample id, evidence ref+SHA-256, registrar, verifier); new LAB_DIRECT case only; refuses cases with PET/order/release/migration record | migration 183 `eqa_case` (**MODIFY** of old 161/162) | PASS | `eqa-no-his-113` (PGlite) 4 tests; `eqa-no-his-native` (PostgreSQL 17, app_rw/worker_rw) | worker_rw cannot classify, no role can edit/delete | registration API/UI/service not written yet |
| E2 | DB: no `p6_transfer` for EQA release | `eqa_transfer_guard` | PASS | PGlite + native | `EQA_NO_HIS_TRANSFER` | – |
| E3 | DB: no outbox job naming EQA case/release/version/transfer (delivery, retry, replay, reroute) | `eqa_outbox_guard` (text compare, malformed payload cannot skip) | PASS | PGlite + native as worker_rw and app_rw | `EQA_NO_HIS_OUTBOUND`; unrelated and patient jobs still accepted | – |
| E4 | DB: later PET cannot become HIS receipt of EQA case | `eqa_his_order_guard` | PASS | PGlite + native | `EQA_CASE_REJECTS_HIS_RECEIPT` | inbound worker's handling of that error (file state) not yet exercised end to end |
| E5 | Worker eligibility false for EQA; composed guards preserved | `p6_release_eligible` **wrapped** (rename chain, same as 165/166) | PARTIAL | structure test + native `false` | wraps `migration_presence_unfiltered_release_eligible` | positive-path equivalence for a certifiable normal release needs the Word/PDF contract tests (owner assets) |
| E6 | TS certification: EQA must take the "outbound suppressed" branch instead of enqueueing | `results/service.ts` | NOT STARTED | – | – | – |
| E7 | Narrow gate exception (RG-09 clinical, RG-10 consent) only for verified EQA; RG-11 not excepted (fetal-sex disclosure rule for EQA is an open clinical decision) | – | NOT STARTED | – | – | Owner decision needed for RG-11 |
| E8 | Registration (no LN reuse, no PET linking at registration, organizer identity, no fabricated HN/DOB/EDD), report identity fields, PDF without EQA mark | – | NOT STARTED | – | – | `registerP2` calls `linkIntakeAtRegistration`; EQA must skip it |
| E9 | EQA excluded from NAS archive until a storage policy is verified | – | NOT STARTED | – | – | one-line filter in `archive-worker.ts` |
| E10 | End-to-end: EQA + patient in one Run, certified PDF, normal patient still reaches HIS | – | NOT STARTED | – | – | needs owner assets (`.local/task3-sources`) |

## Phase 4 — Quality Control (NOT STARTED)
EQA annual registry and IQC PC/NC from the approved workbook. Source keys must be verified against the approved workbook before any chart/calculation.

## Phase 5 — Reliability
| ID | Requirement | Decision | Status |
|---|---|---|---|
| R1 | Archive claim expiry / crash during publication / SHA mismatch / idempotent retry | VERIFY ONLY (+ minimal patch on failing test) | PARTIAL (Q7 only) |
| R2 | HIS path: changing one outbound path validates all three (`his-check.ts`) | VERIFY ONLY first; old changed-only patch NOT applied | NOT STARTED |

## Cross-cutting
| ID | Gate | Status | Evidence |
|---|---|---|---|
| X1 | typecheck (`tsc --noEmit`) | PASS | 2026-11-03 |
| X2 | eslint on changed files | PASS | – (full lint not yet run) |
| X3 | Migration numbers 181–182 vs Production 180 | PASS (no clash) | – |
| X4 | Permissions suite | PASS | 857 tests in the run that included `tests/permissions` |
| X5 | Native PostgreSQL | PARTIAL | worker-queue-native 4/4, archive-native 3/3 |
| X6 | Full unit/db/contracts, browser E2E, build, Windows package, backup/restore, upgrade rehearsal | NOT STARTED | – |
| X7 | Production | BLOCKED | PR #14 pipeline unresolved; no Production action authorized |
