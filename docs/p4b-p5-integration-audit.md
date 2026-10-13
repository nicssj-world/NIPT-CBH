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

## Preflight (before the Draft integration PR)

Remote heads: `main` 5d859c3, PR #2 branch b039521, PR #5 branch afa660a (unchanged). Both PR heads are ancestors of the candidate; nothing was rebased or force-pushed. The remote also holds `feat/p4b-integration-synthetic` (PR #4, closed draft, b94b15f): an older, narrower P4b slice (HALOS contract + P4 placement preflight) that is not contained in this candidate and does not conflict with it. After the last validated code commit (`2bd1b9b`) only this document changed.

Known limits kept as blockers for any clinical adapter or release (not addressed here): `app_rw` can still change attempt state directly; P5 does not read P4b Stop-use/recall; QC5, the clinical adapter and clinical acceptance are not implemented.

## Migrations

Fresh PostgreSQL 17: 001–018, 050, 051 apply in order; re-run is idempotent; `roles.sql` applies twice without error. Upgrading a database at main (001–010) applies 011–018, 050, 051. Source bytes of 011–018, 050, 051 are identical to their branches; 001–010 are identical to main. A database that already holds 050/051 (a P5-only ledger) is refused by the forward-only runner (`Backdated migration violates forward-only ordering`): integration must use new databases, never repair a ledger.

## Final stabilization (2026-10-13)

Commits on `integ/p4b-p5-audit` after the merge: `4529bb5` P4b timestamp fix (cherry-pick of `a0f5223`, authored on `fix/p4b-direct-entry-db-clock` in `NIPT-CBH-P4B-FIX`, based on P4b `b039521`), `78ee37d`, `1060343`, `c291a39`, `2bd1b9b` (test and P2-UI fixes below). No migration was added; 011–018, 050, 051 are unchanged.

### Root causes found and proven

| # | Symptom | Root cause | Fix | Proof |
| --- | --- | --- | --- | --- |
| 1 | `p4c_qc4_observation_check3` / `p4b_pool_observation_check3` (native tests, E2E) | DIRECT_ENTRY `event_time` came from the application clock; `recorded_at` and the execution anchors come from the PostgreSQL clock. Skew in either direction violates `CHECK(event_time <= recorded_at)` or `EVENT_BEFORE_EXECUTION_ANCHOR` | `dbClock()` (`clock_timestamp()`) is the single time source for DIRECT_ENTRY in Pool, DNB and QC4; PAPER event times keep their meaning and are validated against the same clock. Constraints, triggers and migrations untouched | New native test `tests/contracts/p4b-direct-entry-clock-native.test.ts` runs the full chain with the app clock skewed +3 s and −3 s: red before (deterministic), green after. Native loop 48/48 over 8 fresh databases (was ~3/8 failing) |
| 2 | P2 "Bangkok exposure" E2E failed (16/40 repeated) | `RequestForm.close()` fired an async `load()` and unmounted; reopening before it finished initialised the form from stale case data, so conditional fields did not exist | Dialog stays until `onSaved()` resolves (product fix, P2 UI) plus a dialog-gone wait in the spec | 24/40 → 40/40 |
| 3 | P2 "doctor maker/checker" E2E (about 1 in 9 full runs) | The propose button was usable before the doctor list/units loaded, so `units[0]` was empty and the proposal was rejected | Button disabled while loading | Deterministic repro by delaying the API (red), green after; kept as `tests/e2e/zz-p2-doctor-loading-race.spec.ts` |
| 4 | `native.test.ts` `HEARTBEAT_INVALID` (once) | Smoke read the worker heartbeat on first sight of the job receipt, but the worker writes `lastSuccess` after the handler returns | Bounded poll for the heartbeat; assertion unchanged | Soak 200/200 |
| 5 | Harness | Stale worker/renderer processes (MSYS PIDs could not kill Windows processes) and a reused web server could pair a run with another database | PowerShell runner: ports must be free, real PIDs, fresh DB + seed + simulator per run, leftover check | Used for all final runs |

### Unexplained / environmental (not code defects found)

- One run: Playwright process died at start (exit `0xC0000409`, empty log) before any test ran.
- One run: a single static JS chunk request was aborted (status −1) so the login page never hydrated (P5 responsive test timed out at 30 s).
- Worker smoke exited non-zero with empty stdout/stderr in 3 of 120 runs during one soak, then 0 of 240 in later soaks (no captured error).

### Final validation (fresh disposable databases each time)

Source guard 376 files PASS; typecheck, lint PASS; `npm audit --omit=dev --audit-level=high` 0 vulnerabilities; build PASS; Vitest 1174 passed / 2 skipped (legacy-ZIP sample tests, env-gated) including all native PostgreSQL suites on a shared database as in CI. Full Playwright E2E (E2E_SKIP_VISUAL=1, worker and renderer running): **64/64 on three consecutive runs on three new databases** (3.3–3.4 min each) after the last fix.

### Safety re-check

- Database release HOLD: `p5_release_authorized()` is false; tested that a forced `AnalysisComplete → FinalQcAccepted` still cannot create `CertifiedReleased` or a `result_release` row. `result.certify` and `notice.release` remain denied in the policy.
- `FinalQcAccepted` is never produced by the simulation (P4b writes nothing to `analytical_attempt.state`); RG-06/RG-07 stay BLOCKED (tested end to end).
- Stop-use, recall and currentness suites of P4b pass unchanged. P5 rejects F4/F5 task forms as RESULT versions (tested).
- A14/A23 tests pass; both parity matrices intact.
- RBAC: roles.sql only adds grants (no removals vs main); no `app_rw` DELETE, no worker access to P4b/P4c tables, `result_release` read-only for `app_rw`.

### Open risk: `app_rw` can still change attempt state directly

`app_rw` has UPDATE on `analytical_attempt` and the transition guard allows `InProgress → AnalysisComplete → FinalQcAccepted` without evidence. The release HOLD still blocks release, but before any clinical adapter is enabled: (1) add a forward migration so those two transitions are only possible through a SECURITY DEFINER function that verifies current, non-Stop-use QC4/QC5 evidence for that exact attempt and a second-person decision; (2) revoke direct state UPDATE from `app_rw` for those states; (3) make P5 RG-06/RG-07 read the same function's currentness (including P4b Stop-use/recall); (4) keep `p5_release_authorized()` false until AL-5. Not implemented here.

## Findings and risks

1. **P5 gates do not read P4b/P4c state.** `RG-06/RG-07` read only `analytical_attempt.state`. P4b never writes that column, so the simulation (QC4 reviewed, `ANALYSIS_COMPLETE`, F5 Completed) never becomes `AnalysisComplete`/`FinalQcAccepted`; P5 stays BLOCKED (tested). Consequence for the future QC5/FinalQcAccepted adapter: it must also consume P4b Stop-use/recall/currentness, because P5 currently has no such input.
2. **Direct writer risk.** `app_rw` has UPDATE on `analytical_attempt`, and the state guard permits `InProgress → AnalysisComplete → FinalQcAccepted`. A forced state satisfies RG-06/07 (tested). The database release HOLD (`p5_release_authorized() = false`) still refuses `CertifiedReleased` and any `result_release` row (tested). Keep that hold independent of any adapter.
3. **Pre-existing P4b defect (not a merge effect) — fixed.** DIRECT_ENTRY `event_time` came from the application clock while `recorded_at` and the anchors use the database clock (`CHECK(event_time <= recorded_at)`). See Final stabilization, root cause 1: DIRECT_ENTRY now reads `clock_timestamp()`; also recommended for PR #2 as `a0f5223`.
4. **Parity matrices.** Both matrices are intact and byte-identical to their branches. Rows in `legacy-functional-parity-matrix.md` that say P5 result import/UI is absent are now stale; `p5-legacy-parity-matrix.md` supersedes them. A row-level reconciliation is still to do. A14/A23 and the deferred gaps (A19, A21, A22) are unchanged.

## New regression test

`tests/db/p4b-p5-integration.test.ts` (real services, one PGlite database): full 47-member Pool → DNB/QC3 → handoff → sequencing → QC4 → ANALYSIS_COMPLETE; attempt identity is unchanged and matches the P5 link target; RG-06/07 BLOCKED; forced state still cannot release; Redraw/Repeat/Stop keep RG-05 blocking and P4 guards survive; F4/F5 originals are never imported as RESULT versions.
