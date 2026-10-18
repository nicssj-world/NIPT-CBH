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

- Worklist tabs beyond `READY_SCAN_LIMIT` (10 000) show a capped-scan notice instead of the full count.
- Results CSV exports the current page only (stated in the UI).
- Photo search shows at most 300 photos per query (stated in the UI); each Run page lists all its photos.

## Verification (final tree 622db00 + doc commit)

| Check | Result |
| --- | --- |
| Vitest, default (PGlite) | 2 223 passed, 58 skipped (native-PG/fixture gated) |
| Vitest, native PG 17 + owner fixtures | 164 files, 2 280 passed, 1 skipped (`operational-workbook`/owner-master composition group needs a path not present in this run) — 0 failed |
| Playwright (all specs, real Chromium) | 93 passed, 0 failed |
| Typecheck, ESLint `--max-warnings 0`, source guard, production build | passed |
| Operational positive journey (built web, native PG) | passed, no browser errors |
| Browser at 1440 / 768 / 390 px (Lab worklist Gate tab, 4 997 rows) | no horizontal overflow, 50 rows rendered, pager usable |

Intentional baseline changes: the registry screenshots (foundation + p2, 4 widths each) differ only by the pager row and the "Lab searches by LN Halos" hint. E2E tests that read the old unpaged `/api/p4/worklist` or the removed registry "load more" were updated to the paged API/controls; no assertion was removed or weakened.
Not run: `p8-installed` (installer, unrelated), npm audit, timing runs at 100/500/1 000 cases.
