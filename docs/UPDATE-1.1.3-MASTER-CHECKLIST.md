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

## Phase 2 — PET history/count (NOT STARTED)
| ID | Requirement | Decision | Status |
|---|---|---|---|
| P1 | Per-case PET counts: scan runs, PET files/versions, verified HIS receipts, specimen rounds, shown separately with source evidence | MISSING (old WIP had scan-run only) | NOT STARTED |
| P2 | Old 164/166 raw-scan deletion (24 h compaction) | **DROP** (Owner rejected) | NOT APPLICABLE |
| P3 | Old `inbound/queue.ts` hiding of "compactable" rows | **DROP** (hides raw history) | NOT APPLICABLE |

## Phase 3 — EQA (NOT STARTED)
Old WIP changes `eqaVerified` into RG-09/10/11, P3/P4 gates (`lab/gate,core,batch`, `p2/service`, `results/{service,gates}`) and migrations 161/162/165/169. All **MODIFY, narrow rewrite only**; none ported yet. Hard requirement E-HIS (no outbox/transfer/RES/CFS, every layer incl. DB guard) will be designed against `p6_release_eligible` and the composed release guard on current main first.

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
