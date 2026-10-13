# P4b + P5 focused integration audit (synthetic)

Date: 2026-10-13. Branch `integ/p4b-p5-audit` (local only, from `origin/main` 5d859c3). Merged: P4b `b039521` (Draft PR #2), P5 `afa660a` (Draft PR #5). Neither source branch/worktree was modified. Not pushed, no PR, no Production action. Synthetic evidence only; it approves neither AL-4b, AL-5 nor release.

## Merge conflicts and resolution

P4b merged cleanly. P5 conflicted only in shared files; every resolution keeps both sides and removes nothing.

| File | Resolution |
| --- | --- |
| `packages/db/roles.sql` | Both additive grant blocks kept (P4b/P4c evidence tables; P5 `result_*` tables). No line removed vs main. |
| `src/app/globals.css` | `.p4c-workspace` rules and the `.p5-*` block both kept. |
| `docs/migrations.md` | Checksum table continues 001–018 then 050–051 (verified equal to the ledger of a fresh database); both prose blocks kept. |
| `docs/implementation-ledger.md` | P4b and P5 sections both kept. |
| `docs/next-phases.md` | Newer P4b row and newer P5 row replace the two stale placeholder rows. |

## Migrations

Fresh PostgreSQL 17: 001–018, 050, 051 apply in order; re-run is idempotent; `roles.sql` applies twice without error. Upgrading a database at main (001–010) applies 011–018, 050, 051. Source bytes of 011–018, 050, 051 are identical to their branches; 001–010 are identical to main. A database that already holds 050/051 (a P5-only ledger) is refused by the forward-only runner (`Backdated migration violates forward-only ordering`): integration must use new databases, never repair a ledger.

## Findings and risks

1. **P5 gates do not read P4b/P4c state.** `RG-06/RG-07` read only `analytical_attempt.state`. P4b never writes that column, so the simulation (QC4 reviewed, `ANALYSIS_COMPLETE`, F5 Completed) never becomes `AnalysisComplete`/`FinalQcAccepted`; P5 stays BLOCKED (tested). Consequence for the future QC5/FinalQcAccepted adapter: it must also consume P4b Stop-use/recall/currentness, because P5 currently has no such input.
2. **Direct writer risk.** `app_rw` has UPDATE on `analytical_attempt`, and the state guard permits `InProgress → AnalysisComplete → FinalQcAccepted`. A forced state satisfies RG-06/07 (tested). The database release HOLD (`p5_release_authorized() = false`) still refuses `CertifiedReleased` and any `result_release` row (tested). Keep that hold independent of any adapter.
3. **Pre-existing P4b defect (not a merge effect).** `event_time` for DIRECT_ENTRY comes from the application clock but `recorded_at` from the database clock, with `CHECK(event_time <= recorded_at)`. When the database clock is up to ~1 ms behind the application clock the insert fails (observed in about 20–30 % of runs against a Docker database on Windows; reproduced on P4b alone, 2 of 10). Affects `p4c_qc4_observation` and `p4b_pool_observation`. Suggested fix: take DIRECT_ENTRY time from the database clock, or allow a small tolerance. Not changed here.
4. **Parity matrices.** Both matrices are intact and byte-identical to their branches. Rows in `legacy-functional-parity-matrix.md` that say P5 result import/UI is absent are now stale; `p5-legacy-parity-matrix.md` supersedes them. A row-level reconciliation is still to do. A14/A23 and the deferred gaps (A19, A21, A22) are unchanged.

## New regression test

`tests/db/p4b-p5-integration.test.ts` (real services, one PGlite database): full 47-member Pool → DNB/QC3 → handoff → sequencing → QC4 → ANALYSIS_COMPLETE; attempt identity is unchanged and matches the P5 link target; RG-06/07 BLOCKED; forced state still cannot release; Redraw/Repeat/Stop keep RG-05 blocking and P4 guards survive; F4/F5 originals are never imported as RESULT versions.
