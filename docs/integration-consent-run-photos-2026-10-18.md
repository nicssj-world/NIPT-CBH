# Integration: Paper Consent refusal + Run Photo Evidence (2026-10-18)

Branch `integ/consent-run-photos-20261018`, worktree `NIPT-CBH-INTEG-CONSENT-PHOTOS`. Local commits only. Nothing was pushed, merged into `main`, or deployed, and no Production or operational database was touched. Every test ran on synthetic data in disposable databases.

## Sources (verified with git, not taken from reports)

| Source | Branch | HEAD | Base |
| --- | --- | --- | --- |
| A: Consent / Go-Live | `feat/task-list-parity-p0` | `d52c4ec` (feature `58b2083`) | `6d6e41c` |
| B: Run Photo Evidence | `feat/run-photo-evidence` | `855e1ee` | `6d6e41c` |

Both source worktrees were clean, with no uncommitted changes, and were not modified. `merge-base` = `6d6e41c`. `main` (`ea48e62`) is an ancestor of both.

## Method

1. A new branch was created from `d52c4ec`.
2. `855e1ee` was cherry-picked with `-x`, so the commit records its origin. The two branches share no changed files, so there were no textual conflicts.
3. The one real collision was the migration number, resolved as described below.

## Migration 102 collision

`tools/migrate.ts` keys the ledger by file name and applies files in lexicographic order. It is forward-only: it refuses a ledger row that is missing from the bundle and a gap before the last applied file. Checksums are SHA-256 of the file bytes; only five historical operational files have dual-checksum exceptions.

**Decision:**
- `102_p2_paper_consent_refusal.sql` stays as it is.
- The photo migration was renamed with `git mv` to `103_run_photo_evidence.sql`. Its content is byte-identical, so the SHA-256 is still `f11c8080…009b03f9`.
- 099–102 are unchanged.

**Why this is safe:**
- `main` stops at 095, so neither file has been applied in Production.
- 103 creates only `run_photo*` objects and references `lab_batch` and `app_user`. Those tables exist long before 102.
- No object is shared between 102 and 103.

**Synthetic DBs from the photo branch:** these record `102_run_photo_evidence.sql` in their ledger. The runner refuses them with "Applied migration missing from bundle". They are disposable and must be rebuilt, and they are never evidence of a Production apply.

Final sequence 096–103 is listed with checksums in `docs/migrations.md`.

Tests in `tests/db/migration-103.test.ts`:
- **Bundle:** one file per number from 096 on; Consent is 102, photos are 103; the checksum is unchanged and recorded in the docs.
- **Fresh install (PGlite and native PostgreSQL 17.11):** 001–103 apply in order, and a second run changes nothing.
- **Upgrade, populated 102 → 103 (PGlite and native PG 17):**
  - Synthetic cases, receipts and a Run are created at 102.
  - Every pre-existing table keeps the same row count and content digest.
  - The only new tables are empty `run_photo*` tables.
  - The 001–102 ledger is unchanged.
  - Re-running is idempotent.
  - The 102-era Lab workflow (cancel/create Run) still works afterwards.
- **Photo-branch ledger:** refused, and no photo tables are created.

**Rollback compatibility:** the system is forward-only. 103 is additive and nothing in the clinical workflow reads it, so an application-only rollback to the Consent HEAD keeps working on a 103 schema. 102 is required by the Consent application (see `docs/go-live-readiness-2026-10-19.md`).

## Regression evidence

All results are from this branch, on disposable synthetic data.

| Gate | Result |
| --- | --- |
| Source guard | PASS, 872 files |
| Typecheck (`next typegen && tsc`) | PASS |
| Lint (`eslint --max-warnings 0`) | PASS |
| Deploy contracts (`node --test tests/deploy/*.node.mjs`) | 13 / 13 |
| Vitest, default (no native URL) | 2155 passed, 0 failed, 58 skipped (native and fixture-gated) |
| Vitest, native PG 17 + fixtures, full run | 2210 passed, 1 failed, 2 skipped. The failure was the new native migration-103 test (a column-alias bug in the test); after the fix it is 5 / 5. |
| The 2 remaining skips | Run separately with `NIPT_TASK_MASTER_PATH`, `NIPT_TEST_OLD_MASTER_PATH` and `NIPT_TEST_NATIVE_EXCEL=yes`: 4 / 4 pass |
| **Vitest total** | **2213 / 2213 tests executed and passed, 0 skipped** |
| Build (`next build`, standalone) | PASS |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Playwright, all specs except `p8-installed` | 93 / 93 passed across three runs (see below), 0 skipped |
| Operational journey `verify-positive-journey.ts --anc --recovery` | PASS (production build; backup/restore, migration reapply, restored worker without duplicate release). Physical Halos, hospital LAN and HIS confirmation: NOT_RUN by design. |

**Playwright runs:**
- **Run 1, full:** 56 passed. The standalone web process then exited with no log output while serving the P0-5 native Excel PDF test, after its Task 1 PDF had downloaded. The remaining 27 tests failed with `ERR_CONNECTION_REFUSED`, and 9 did not run.
- **Run 2, everything from `p4-task-list` on:** 38 passed, including P0-5, with 0 failed. P6 skipped (no `NIPT_P6_NATIVE_URL`).
- **Run 3, P6 with `NIPT_P6_NATIVE_URL`:** 1 passed.

The web exit in run 1 did not reproduce. It is recorded here as an unexplained transient, not a pass, and the final UX-phase full run re-checks it.

`p8-installed` is excluded because it needs an installed Windows candidate (`NIPT_P8_INSTALLED_SMOKE=yes`), which does not exist. That is the known blocker "no packaged Windows deployment".

**Coverage of the requested areas:**

| Area | Covered by |
| --- | --- |
| Consent: Doctor Registry and signature, Signature Pad, Digital Consent PDF, Paper marker-only, Paper refusal, withdrawal/decline blocking, clinical review, BG-04 / RG-10, Result/HIS guards | `tests/db/digital-consent-evidence`, `p2*`, `migration-101/102`, the e2e `p2.spec.ts` (incl. the marker and refusal journeys), `anc-forms.spec.ts`, and the operational journey |
| Run Photo Evidence: upload, gallery and viewer, search (Run/date/LN Halos/LN HIS), sample range, audit and hash, storage path and UNC, old photos after a path change, authorisation, backup/restore, storage offline | `tests/db/run-photos`, `tests/unit/run-photos`, the e2e `run-photos.spec.ts` (8 tests) |
| Core: HIS PET/OK, registry, FIFO / Task List 1–3, QC / Pooling / Sequencing, labels, P5 manual scan and upload, matching and review, RES/PDF/OK, Settings and roles | Contract and native tests, the e2e `p3`/`p4*`/`p5*`/`p7`/`settings-operational`/`foundation`, and the operational journey |

## Test infrastructure added

- `tools/integration-e2e/e2e.ts` is the photo runner pattern without Docker, because the Docker address pools on this machine are exhausted:
  - It uses a disposable loopback PostgreSQL 17 named by `NIPT_INTEG_E2E_PG_URL` (bootstrap `postgres` database), on ports 19828 (web) and 19830 (renderer).
  - Each run gets a fresh reserved `nipt_synthetic_p2_browser_photos_*` database.
  - It runs only in this worktree or the UX worktree.
- Native contracts use the same disposable cluster, with databases `nipt_synthetic_test_ci`, `nipt_p6_synthetic_ci` and `nipt_synthetic_p7_ci` prepared as in `.github/workflows/foundation.yml`.

## Still pending (unchanged by integration)

- Production authorisation for migrations 096–103.
- The physical photo acceptance items (real UNC share with the service account, phones on the LAN, the hospital backup schedule for photo roots).
- Every clinical Go-Live blocker in `docs/go-live-readiness-2026-10-19.md`.
