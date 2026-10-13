# P5H — Owner questions Q-P5H-01…06 and integration notes (P6 060 + P5H 070)

2026-10-13 · status **Ready for Synthetic Integration** · AL-8 stays NOT READY · every item below is Fail Closed until the Owner decides.

## 0. Owner design baseline for the synthetic integration (2026-10-13)

Q-P5H-01(a), 02(b), 03(a), 04(a), 05(a), 06(a). Only 02 changed the code: a Submitted row whose re-evaluation fails now moves to `NotEligible` with the new evaluation, reasons and an audit event (`HIST_SUBMIT_NOT_ELIGIBLE`); migration 070's draft guard allows `Submitted → NotEligible`. This is a synthetic design baseline, not Clinical Approval; OD-18, the cutoff value and AL-8 remain HOLD.

## 1. Questions for the Owner (historical text, answered above) (actual behaviour today, options, short recommendation)

| # | What the code does now (real text) | Options | Recommendation |
| --- | --- | --- | --- |
| **Q-P5H-01** Event with an unknown date | Any recorded event (collection, receipt, report) whose date is unknown or illegible makes the case `NotEligible` (`EVENT_DATE_UNKNOWN`). A blank cell records no event at all; only the word `unknown` records an unknown one. The plan says the latest possible date of every event must be before the cutoff and an unknown date cannot be shown to be. | (a) keep: unknown = not eligible (b) unknown non-Anchor events are ignored if the Anchor and at least one dated event pass (c) Owner lists event types that may be unknown | (a) now; consider (c) after seeing real batches — unknown collection dates are common on old reports |
| **Q-P5H-02** Eligibility fails again at confirmation | The plan diagram has no `Submitted → NotEligible`. If at confirmation the re-check fails only on date/Anchor/cutoff, the row is refused (`REEVALUATION_NOT_ELIGIBLE`), stays Submitted, nothing is created. Activity found at that moment (registered LN, `.pet`, Batch…) instead makes it `Conflict`. | (a) keep (b) add the transition `Submitted → NotEligible` so it returns to editing | (b) — cleaner for staff; needs a one-line plan amendment |
| **Q-P5H-03** Legacy database record as Anchor | Only a final result report (and, if OD-18 (b) is chosen, a Lab control record) can be an Anchor. A NIPTY database row, the legacy export log, redraw notices, Request and Consent papers can never be. | (a) keep (b) allow a named controlled legacy register (Owner names it) | (a); revisit only if many cases have no report |
| **Q-P5H-04** Who counts as "the recorder" | The confirming person must differ from **everyone** who imported or edited that row, not only the first importer (a DB trigger enforces it). | (a) keep (b) only the first recorder | (a) — matches "recorder/editor" in plan §6.3 item 17 |
| **Q-P5H-05** Exit from `Conflict` | `Conflict` (LN or identity collided at confirmation) is terminal: no edit, no abandon, no re-promotion; it no longer blocks the LN. The plan defines no exit and no queue. | (a) keep; staff re-import the corrected row as a new draft (b) define a two-person conflict queue (D-18) | (a) for Phase 1; (b) if conflicts turn out to be common |
| **Q-P5H-06** `.pet` intake dated before the cutoff | An unlinked `.pet` intake received in HIS **on or after** the cutoff day (Asia/Bangkok) blocks eligibility; one received before does not, but any intake for the LN still shows as a blocking finding at staging (`INTAKE_EXISTS_FOR_LN`). | (a) keep (b) ignore intakes before cutoff entirely | (a) — safer; the staff sees why |

Also decided by the Owner on 2026-10-13 and now in force: `history.promote` is usable only by `HISTORICAL_VERIFIER` with approved settings, an independent verifier and the DB guards, and not for clinical use before AL-8; partial confirmation is allowed (each ticked row stands alone, the verifier attests every row before the batch is submitted).

## 2. Security review of the role/setting changes (with one tightening)

| Area | Finding | Result |
| --- | --- | --- |
| `history.promote` | Only the matrix `A` cell of `HISTORICAL_VERIFIER` grants it; `history.send` denied for all; service also needs active `go_live_cutoff` + `historical_backfill` (both CLINICAL Maker-Checker; `historical_backfill` defaults to `PENDING_OD18`) | OK, permission matrix test covers every role |
| DB: how a HISTORICAL case can appear | Only inside `historical_promote()`; `case_guard` re-checks Submitted draft, passing evaluation of the same version and a CONFIRMED verification by a non-contributor with the role | OK; native test confirms `app_rw` cannot insert one directly |
| **Fixed in this round** | A role with UPDATE on `historical_draft` could set the promotion flag and mark a draft `Promoted` without a case | Draft guard now also requires the matching `historical_record`; native test proves the forgery is refused |
| **Fixed in this round** | `worker_rw` had full UPDATE on the draft/batch tables | Reduced to column grants (state, issues, ln_key, evaluation, staging results). It cannot touch data, version, contributors or promotion columns; native test proves it |
| Worker and P2 data | The worker reads only `(case_id, hn)` of P2 identity (existing P3 grant); names/DOB are read only by the web role at confirmation. I removed a broader grant I had added earlier because the P3 least-privilege test (rightly) failed | OK |
| Audit | Codes only (existing allow-list); no LN/HN/name/date; chain verified in tests | OK |
| Remaining notes | Uploads are held in memory by Next (150 MB cap, header check only); a reverse-proxy body limit is advisable at deployment. Any user with `history.read` can open any batch (Lab-wide by design, OD-21 pending) | accept for synthetic |

## 3. Integration notes

**Order and numbering.** P5 `050–051` → P6 `060` → P5H `070`. 070 has no dependency on 060 and 060 none on 070 (checked read-only: P6 tables are `p6_*`; its fixture already restricts `origin` to `ANC`/`LAB_DIRECT`). If P6 renumbers above 070, nothing in 070 changes. Add both rows to `docs/migrations.md` (070 checksum is recorded there; it changed in this commit because the draft guard was tightened, so any database that applied the earlier 070 from commit 214ea66 must be recreated — only disposable local databases did).

**`packages/jobs/worker.ts`.** P6 adds one import (`runP6Cycle`) and one line inside the cycle; P5H adds one import (`STAGE_JOB_KIND`, `runHistoricalJob`), appends `STAGE_JOB_KIND` to `JOB_KINDS`, and one `else if(kind===STAGE_JOB_KIND)` branch in `execute`. The hunks do not overlap logically; if Git reports a conflict on the import block keep both imports. After merging, `JOB_KINDS` must still contain `STAGE_JOB_KIND` or staging jobs are rejected with `JOB_KIND_PROHIBITED`.

**Grants.** P5H appended to `packages/db/roles.sql` (applied by `tools/prepare-db.ts`). P6 keeps its grants in `packages/p6/grants.sql`, which `prepare-db.ts` does not apply today — the integrator should apply both. No P5H change to P6 files.

**Shared code touched by P5H** (review at merge): `packages/security/policy.ts` (one hard-deny entry removed), `packages/settings/{catalog,fields,coverage}.ts` (+1 key; `tests/unit/settings.test.ts` expects 12 keys — adjust the count if P6 adds keys), `src/components/navigation.tsx` and `src/app/(protected)/layout.tsx` (conditional link), `tests/contracts/p3-inbound.test.ts` (fixture now inserts the historical LN as `DOCUMENT_VERIFIED`), `docs/*`.

**Outbound barrier (no trigger created).** P6 has no table that references a case yet, so no HIS-export trigger was added. When P6 persists a case reference it should call `assertOutboundAllowed({origin, lnVerification})` from `packages/historical/barrier.ts` and add a DB check equivalent to "origin <> HISTORICAL and LN `VERIFIED_BY_PET`" on the table that holds the case reference.

**Running it.** Apply migrations then `tools/prepare-db.ts`; run the worker; activate `go_live_cutoff` and `historical_backfill` through Settings (Certifier proposes, Clinical Approver approves); grant `HISTORICAL_ENTRY` and `HISTORICAL_VERIFIER`. Native tests: `NIPT_MODE=synthetic NIPT_TEST_DATABASE_URL=postgresql://…/<name containing "synthetic"> npx vitest run tests/contracts/p5h-native.test.ts` (database persists between runs; the test activates settings only when absent).

## 4. Evidence added in this round

`tests/contracts/p5h-native.test.ts` on PostgreSQL 17 with real `app_rw`/`worker_rw` sessions (3 consecutive runs plus one on a recreated database): concurrent staging of one batch (single staging, no duplicate drafts); two verifiers confirming the same rows with the same key (6 PROMOTED + 6 ALREADY_PROMOTED, one case per LN); with different keys (4 PROMOTED, 4 rejected as already promoted); promotion racing Lab registration of the same LN (one `case_ln` per LN); forged promotion refused; worker column-grant limits; direct HISTORICAL insert refused.
