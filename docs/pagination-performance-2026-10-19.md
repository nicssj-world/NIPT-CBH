# Pagination & performance remediation — 2026-10-19

Branch `feat/pagination-perf-20261019` (from `1eb85ef`). Local only; not pushed, merged, deployed or applied to Production. Synthetic data only.

## What changed

| Page / API | Before | After |
| --- | --- | --- |
| Lab worklist `/lab`, `GET /api/p4/worklist` | loaded and rendered every attempt in every tab; PHI audit `slice(0,200)` | bounded facts loading (chunks of 400, `READY_SCAN_LIMIT` 10 000 with `scan.capped` notice), server filter/sort/page (25/50/100, default 50), audit logs only the ≤200 cases actually returned; FIFO, eligibility gate, Owner locks unchanged |
| ANC dashboard `/api/anc/dashboard` | all cases fetched then JS slice | single SQL projection, keyset cursor with pinned `asOf`, SQL totals; 20/page kept (10/20/50 selectable) |
| Patient registry `/`, `/cases` | newest 200 only | page-based, 25/50/100 (default 25), exact total, server search (incl. LN Halos / LN HIS), sort, filter change → page 1 |
| Run list `/lab/batches` | capped at 100 | 25/50/100 (default 25), search by Run number/id, total, newest first + secondary sort |
| Historical detail `/historical/:id` | whole batch in one response | server pages (50/100), LN search + status filter over the whole batch, total follows the filter, bulk operations unchanged |
| Historical list | unpaged | paged with total |
| Inbound `/inbound` | 100-row cut with no notice | independent pages per list, totals, LN search (only for roles that may see LN), waiting/file queue limits stated |
| Run Photo Evidence | 60/200 Runs and 300 photos shown as if complete | exact Run/photo totals, "load more" for older Runs, cap notice at 300; photos never gate work |
| Results queue | page without total | exact total/pages, default 50 (25/50/100), `BOUNDED_PAGE` kept, CSV is the current page and the UI says so |

Not changed: Admin users/units/audit, Doctor Registry, Case Detail, Task List 1–3, 48-slot layout, Pooling, Sequencing, Workbook, sample positions, control IDs, FIFO, QC gates, Consent.

Shared pieces: `packages/db/pagination.ts`, `src/components/shared/pager.tsx`.

## Database

`db/migrations/104_pagination_lookup_indexes.sql` — five indexes on `round_id` lookups. Root cause of the worklist cost: `attemptFacts` ran a Seq Scan per attempt (O(N²)). Indexes only, forward-only, no data change.

## Performance (local synthetic runtime, 5 000 cases / 4 997 attempts / 130 Runs / 5 000 results / 101 513 audit rows; Chromium 1440 px, median of 3)

Before = audit baseline on `1eb85ef`; after = this branch, same database.

| Page | Before | After |
| --- | --- | --- |
| Lab worklist | 15 914 ms API, 4 365 KB, 120 147 DOM nodes | ≈1.6 s API, 28 KB, 1 388 nodes (Gate tab, 50 rows) |
| ANC dashboard API | 6 159 ms | 822 ms, 15 KB |
| Registry `/cases` | 200 rows, 28 875 px tall, 94 KB | 25 rows, 4 207 px, API 94 ms / 12 KB |
| Run list | 99 KB, cap 100 | 25 rows, 47 KB, 24 ms |
| Historical detail | 12.5 MB, 33 537 nodes | 126 KB, 718 nodes, 30 ms |
| Results queue | 54 ms, 316 KB | 79 ms, 158 KB (total now computed) |
| Audit log / Users | unchanged | 24 ms / 14 ms |

Only 5 000 was measured in the browser. Smaller sizes (100/500/1 000) are covered by the paging tests, not by timing runs. The worklist remains the slowest call (the eligibility gate is evaluated in TypeScript over a bounded scan); it is no longer unbounded.

## Known limitations

- Worklist tabs: Ready/Gate are classified exactly for the first `READY_SCAN_LIMIT` (10 000) attempts in the requested order. Past that the scan continues only until the requested page is full, so no eligible case is dropped and FIFO order holds; totals are then a lower bound and the page says so (see "Pre-freeze review").
- Results CSV exports the current page only (stated in the UI).
- Photo search shows at most 300 photos per query (stated in the UI); each Run page lists all its photos.

## Verification (final tree 622db00 + doc commit)

| Check | Result |
| --- | --- |
| Vitest, default (PGlite) | 2 223 passed, 58 skipped (native-PG/fixture gated) |
| Vitest, native PG 17 + owner fixtures | 164 files, 2 280 passed, 1 skipped (an environment-gated test; which one was not identified) — 0 failed |
| Playwright (all specs, real Chromium) | 93 passed, 0 failed |
| Typecheck, ESLint `--max-warnings 0`, source guard, production build | passed |
| Operational positive journey (built web, native PG) | passed, no browser errors |
| Browser at 1440 / 768 / 390 px (Lab worklist Gate tab, 4 997 rows) | no horizontal overflow, 50 rows rendered, pager usable |

Intentional baseline changes: the registry screenshots (foundation + p2, 4 widths each) differ only by the pager row and the "Lab searches by LN Halos" hint. E2E tests that read the old unpaged `/api/p4/worklist` or the removed registry "load more" were updated to the paged API/controls; no assertion was removed or weakened.
Not run: `p8-installed` (installer, unrelated), npm audit, timing runs at 100/500/1 000 cases.

## Pre-freeze review (2026-10-19, after b321e07)

1. **The one skipped Vitest test** was `tests/db/workbook-f52-approved.test.ts` › "F52 native Excel: D52 draft/save/resume matches XLSX and PDF recalculation, then rebinds changed concentration". It is gated on `NIPT_TEST_NATIVE_EXCEL=yes` because it drives the installed desktop Excel. It was run for real on this host (Excel present): passed (25.9 s). Release impact: none; it covers the native Excel export, which Playwright's approved-F52 spec also exercised. Full Vitest with native PG, owner fixtures and native Excel: **165 files, 2 287 tests passed, 0 skipped**.
2. **Worklist scan boundary — defect found and fixed** (commit c9c06c5). Before: past 10 000 Ready attempts the scan stopped, so an eligible case behind 10 000 older Gate-blocked ones never appeared under Ready. Now the scan follows the requested sort and keeps classifying until the requested page of the active Ready/Gate tab is full; `READY_HARD_LIMIT` (100 000) bounds the id list. Tests (`tests/db/worklist-scan-limit.test.ts`, window shrunk through a tuning seam): all eligible cases reachable in FIFO order, desc is the exact reverse, an LN filter finds a case behind the window, lower-bound flag and hard limit, PHI audit covers only the rows disclosed. A real-size check with 11 997 Ready attempts also exposed a second defect: the id list and badge counts joined `specimen_round`/`case_ln`, and PostgreSQL (estimating 1 row after two opaque predicates) nested-looped seq scans per attempt, O(N²). With slim id queries the same calls dropped from 7.5–10 s to 0.8–1.5 s.
3. **`npm audit`**: 5 high, all in one development-only chain (`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`; advisory GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested glob patterns). `npm audit --omit=dev`: **0 vulnerabilities**. The offered fix (`npm audit fix --force`) installs `eslint-config-next@14.2.35`, a major downgrade of lint tooling for a non-runtime package; not applied. Impact: none at runtime; lint tooling reads only repository globs.
4. **Migration 104**: five `CREATE INDEX IF NOT EXISTS`, no table/column/constraint/trigger/data change, so no workflow code path can observe them except through plans. All five are used by the workload (`idx_scan` > 0 on the 12 000-case database). The whole regression (Vitest native + Playwright + operational journey) ran with 104 applied. `CREATE INDEX` (not CONCURRENTLY) takes a SHARE lock on five small tables while it builds; apply with the application stopped, as the installer does.
