# P5H Historical Backfill — Synthetic Foundation

2026-10-13 · branch `feat/p5h-historical-backfill-synthetic` (from `origin/main` bd50f16, after PR #6) · Plan v6.2.1 · Gate AL-8 **NOT READY**.

**Status: restricted synthetic build — pure foundation (commit 5c6a28a) plus the integrated Bulk Import described in §6.** The Bulk Import adds migration 070, a worker job, API routes, a three-step UI, second-person batch confirmation and guarded promotion. No real data, HIS/LAN access or Clinical approval is involved. Passing these tests does not make Historical Backfill ready for use: every clinical decision in §7 stays **Fail Closed** (nothing is eligible or promotable until the Owner approves it) and no path sends a historical result to HIS/CFS.

## 1. What exists

`packages/historical/` (pure TypeScript, no I/O): `dates` (resolution-aware dates, Asia/Bangkok, legacy date parsing), `eligibility` (Anchor + cutoff + NIPT-activity evaluation, deterministic snapshot hash), `precheck` (LN/draft/intake/identity duplicates), `lifecycle` (Draft and Record state machines, promotion/revision/withdrawal decisions), `evidence` (NOT_IN_EVIDENCE values, completeness, past-certification text), `legacy-map` (NIPTY row → draft seed), `cutoff` (versioning, OD-27 interim guard, impact report), `barrier` (outbound deny-by-default), `audit` (sanitised vocabulary).
Tests: `tests/unit/p5h-*.test.ts` (66 tests incl. fast-check properties), `tests/db/p5h-invariants.test.ts` (6 tests, PGlite, current schema).

## 2. Legacy NIPTY source → P5H mapping

Source read: `NIPTY_handover.zip` `source/app/database.py`, `maintenance.py`, `services/matcher.py`, `services/thai_date.py` (identical to `NIPTY.zip` per the parity matrix). Nothing was extracted, run or committed; no database, PDF or `.res/.ok` content was read.

| Legacy | P5H target | Rule |
| --- | --- | --- |
| `nipt_orders.ln` (UNIQUE text) | draft LN (`normalizeLn`, leading zeros kept) | duplicates checked against `case_ln`, drafts, intakes |
| `hn`, `dspname`/name parts, `dob` | identifiers for pre-check | HN alone never links; ≥2 comparable identifiers to call a match |
| `request_date`, `specimen_date` (HIS STAT facts) | `ORDER_REQUEST` / `COLLECTION` events on a `LEGACY_DB_RECORD` item | not an Anchor; not an NIPT receipt time |
| `nipt_results` final row + verified PDF | `FINAL_RESULT_REPORT` evidence (+ SHA-256) | Anchor candidate only if the PDF hash was recomputed by the migration run |
| `nipt_results` without verified PDF | `LEGACY_DB_RECORD` | `PDF_NOT_AVAILABLE_NO_ANCHOR` |
| `result_type='redraw_notice'` | `REDRAW_NOTICE` evidence, event `OTHER` | never a result or Anchor |
| `collection/received/reported_date` (`DD-Mon-YYYY`), STAT `YYYYMMDD[HHMMSS]`, ISO | `HistoricalDate` DAY precision | unreadable → UNKNOWN (legacy matcher failed open; not ported); year ≥ 2400 → `AMBIGUOUS_YEAR_ERA`, never converted |
| `t21…qc_status` `''` | `NOT_IN_EVIDENCE` | never Normal |
| several final results per order | `reportVersions` list, `currentVersion=null` | no inference; `MULTIPLE_FINAL_RESULTS_REQUIRE_REVIEW` |
| `nipt_exports` (`.res`/PDF export history) | `LEGACY_EXPORT_LOG` informational evidence | never a Release/Export/his_export; `LEGACY_EXPORT_NOT_A_RELEASE` |
| `deleted_at` orders | skipped with `LEGACY_SOFT_DELETED_ORDER` | reported, not imported |
| 45-day matcher cutoff | unrelated to `go_live_cutoff` | not used |
| `maintenance.py audit/repair-match/reparse/backfill-ga` | not ported | stay DEFERRED (P7); repair-match would auto-link and is contrary to D-46 |

## 3. Requirement trace

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| AT-HIST-01/07 evidence only, no signature/consent snapshot/current-user certification | strict zod schemas; past-certification text | p5h-dates-eligibility (evidence strict), p5h-legacy-evidence | pure part done; file storage/immutable PDF **pending** (needs migration) |
| AT-HIST-02/04/13 no downstream chain, no HIS export | `barrier`, `PROMOTION_NEVER_CREATES`; existing DB guards | p5h-lifecycle, p5h-invariants | pure + current-schema guards done; P6 wiring **pending**; `his_export` DB trigger **pending** (table is P6) |
| AT-HIST-03 incompleteness | `evidenceCompleteness` | p5h-legacy-evidence | done (profile choice open, OD-18) |
| AT-HIST-05/12 LN & identity | `precheckHistoricalDraft` | p5h-lifecycle | pure done; DB lock/concurrency **pending** |
| AT-HIST-06/10/15 eligibility, Anchor, cutoff boundaries | `evaluateEligibility` + properties | p5h-dates-eligibility | done (cutoff value open) |
| AT-HIST-08 actual vs recorded date | event dates separate; recorded time lives in audit/rows | structural only | UI/timeline **pending** |
| AT-HIST-09/11 maker-checker, negatives, idempotency | `decidePromotion` etc. | p5h-lifecycle | pure done; transactional promotion **pending** |
| AT-HIST-14 cutoff change | `cutoff`, DB `OD27_REQUIRED` guard | p5h-lifecycle, p5h-invariants | interim (c) done; (a) impact review queue **pending** |
| AT-HIST-16 LN races | pure ordering outcomes | p5h-lifecycle | DB concurrency test **pending** |
| REQ-HIST-09 audit | `historicalAuditEvent` over `safeDetails` | p5h-lifecycle, p5h-invariants | vocabulary done; persistence with decisions **pending** |

## 4. Owner-confirmed vs still to decide

**Confirmed (LOCKED LD-10 and Owner scope message 2026-10-13):** evidence-only records; no QC/Batch/signature/certification fabrication; actual vs recorded dates separate; original-PDF import with provenance and no re-certification; no automatic HIS send (Phase 1 has no historical send path at all); LN/HN/identity/duplicate checks before any case; full audit; no conversion of current cases; in-flight cases at cutover follow **OD-26(c) as proposed** and are not Historical Import; Bulk Import of about one batch / 47 cases with a 3-step UX (upload Excel/CSV + PDF/ZIP → review rows and errors → confirm as a batch), keeping Draft/Eligibility/Cutoff/Duplicate/Independent review/Audit as background mechanisms.

**Mechanism proposed (D-41–D-50, implemented here, awaiting AL-1/AL-8 sign-off):** Draft→Promotion, Anchor, "latest possible date", verifier ≠ recorder, versioned cutoff.

**Open — not guessed anywhere in code:**
- the `go_live_cutoff` value and its approval (tests use a synthetic 2026-01-01);
- OD-18 scope, minimum dataset (a)/(b)/(c), scan attachment, accepted Anchor kinds (code requires an explicit list; tests use final report only);
- OD-19 reviewer model ((a) is incompatible with D-46; engine enforces verifier ≠ recorder for every case); sampling rate for (c);
- OD-20 display status, OD-21 ANC visibility (none implemented; Lab only), OD-22 (no send path either way), OD-23 completeness vs promotion, OD-26 frozen in-flight list, OD-27 (only interim "no change after first HISTORICAL case" implemented), Q-G7 DPO/retention/validation criteria; and OD-26(c) cutover date and the in-flight list itself.
- Interpretations to confirm: **Q-P5H-01** an event whose date is UNKNOWN fails closed (`EVENT_DATE_UNKNOWN`); **Q-P5H-02** a re-evaluation that fails only on dates/Anchor at promotion is refused and the draft stays Submitted (diagram has no Submitted→NotEligible); **Q-P5H-03** whether a controlled legacy register/DB record may be an Anchor (excluded now); **Q-P5H-04** the verifier must also differ from every earlier editor, not only the first recorder; **Q-P5H-05** `Conflict` has no exit in the diagram (resolution path via the D-18 queue undefined); **Q-P5H-06** unlinked `.pet` intake dated before the cutoff does not block.

## 5. Schema gaps found in the foundation round — status after Bulk Import

| Gap | Resolution |
| --- | --- |
| 1. `case_guard()` mixed "no HISTORICAL insert" with immutability | Replaced in migration 070: insert allowed only inside `historical_promote()` after the trigger itself re-checks draft/evaluation/verification; immutability kept (tests `p5h-bulk`, `p5h-invariants`) |
| 2. `DOCUMENT_VERIFIED` rejected | `case_ln` CHECK widened; `ln_insert_guard`/`ln_guard` rewritten: HISTORICAL cases must be `HISTORICAL_DOCUMENT/DOCUMENT_VERIFIED`, current cases may not; a historical LN can never become `VERIFIED_BY_PET` |
| 3. `history.promote` hard-denied | **Policy change made, needs your acceptance:** removed from the hard-deny list in `packages/security/policy.ts`; only the matrix `A` cell of `HISTORICAL_VERIFIER` grants it (permission test added). It is inert in practice because the service refuses to confirm unless `historical_backfill` and `go_live_cutoff` are Active and approved. `history.send` stays denied for every role |
| 4. `go_live_cutoff` default null | Unchanged (fail closed); read from the active setting; new CLINICAL setting `historical_backfill` (default `PENDING_OD18`) added to the catalog, form metadata and coverage matrix |
| 5. No `his_export` on main | Still true. P6 must call `assertOutboundAllowed` (see §8); `his_order` for HISTORICAL remains rejected by the existing trigger |
| Migration band | 070 chosen after reading the P6 worktree read-only: P6 uses 060 (uncommitted at the time). `packages/jobs/worker.ts` and `packages/db/roles.sql` are shared files touched additively; P6 also edits `worker.ts`, so expect a trivial merge at integration |

## 6. Bulk Import — implemented (restricted synthetic)

**Owner scope (2026-10-13):** about one batch / 47 cases; three steps: upload Excel/CSV + PDF/ZIP → review rows and errors → confirm as a batch; Draft, Eligibility, Cutoff, duplicate checks, independent review and Audit stay background mechanisms; cases still in progress at cutover follow OD-26(c) as proposed and are never imported as historical.

| Step | What the user does | What the system does |
| --- | --- | --- |
| ① Upload (`/historical`) | Picks one `.xlsx`/`.csv` and PDFs and/or a ZIP; template download available | `createBatch`: stores originals content-addressed, records files (ZIP members expanded in memory, non-PDF flagged), enqueues job `synthetic_historical_stage` |
| background (worker) | — | `stageBatch`: reads the table (limits: 5 MB, 1000 rows, at most `maxBatchRows`), parses each PDF with the P5 parser for LN/HN/DOB/report date, matches PDF to row (file name, else unique LN in PDF), builds evidence and events with date resolution, creates one Draft per row, flags duplicate LNs inside the sheet (all rows of the group blocked), checks `case_ln`, other drafts, HIS intakes and identity (HN alone never links), evaluates eligibility (fail closed), moves rows to `Submitted` / `NotEligible` / stays `Draft` with findings |
| ② Review (`/historical/[id]`) | Sees only the rows that need work, with plain-language reasons; edits just those cells with a reason (min 8 chars) or abandons the row | `fixRow` creates a new append-only revision, adds the editor to the draft's contributors, re-matches the PDF, re-runs checks; a sibling that was blocked only by a duplicate is released automatically |
| ③ Confirm | A different person with `HISTORICAL_VERIFIER` opens each original PDF (access-audited), ticks LN / report date / PDF binding / identity (at least 2 identifiers) per row; there is deliberately no "tick all" | `confirmBatch`: per-row savepoint and LN lock; re-evaluation; `decidePromotion`; `historical_verification` (a DB trigger forbids any contributor and requires the role); `historical_promote()` creates the `HISTORICAL` case, the `HISTORICAL_DOCUMENT/DOCUMENT_VERIFIED` LN and `historical_record`. A mismatch returns the row to editing; a registered LN becomes `Conflict`; replays are idempotent |

Decisions taken (flag if you disagree): **partial batches are allowed** — each ticked row succeeds or fails on its own, unticked rows stay waiting; a `Discrepancy` row re-enters the flow after correction; the Q-P5H-01…06 interpretations in §4 are unchanged; registry findings that only say "a person should look" (same patient seen again, same name+DOB under another HN) are warnings, everything else blocks.

**Deliberately not there:** any send/export/release/certification for a historical case; ANC visibility (OD-21 pending: Lab and verifier only); a display status or Dashboard entry for historical cases (OD-20 pending); withdrawal and post-promotion revision screens (decision logic exists in `lifecycle.ts`, no UI); a Conflict resolution queue; cutoff-change UI and impact review (the OD-27 interim "no change after the first HISTORICAL case" is enforced by the existing DB guard).

## 7. Remaining HOLD and approvals (nothing below is guessed or enabled)

| Item | State |
| --- | --- |
| `go_live_cutoff` value and approval | HOLD — tests use a synthetic 2026-01-01 |
| OD-18 Anchor kinds, minimum dataset, scan policy | HOLD — setting `historical_backfill` is `PENDING_OD18` by default, so every row is NotEligible and confirmation is refused |
| OD-19 reviewer model and sampling | HOLD — interim: a second person for every row (stricter than the sampling options) |
| OD-20 display status, OD-21 ANC visibility, OD-22 send path, OD-23 completeness vs promotion, OD-26 frozen in-flight list, OD-27, Q-G7 (DPO, retention, transcription validation) | HOLD / approval needed; AL-8 stays NOT READY |
| Real data migration from NIPTY (database / PDFs) | Not authorized; `legacy-map.ts` only maps synthetic rows; nothing was run against real files |
| Accepting the `history.promote` policy change (§5.3) | needs your decision at AL-8 |
| P6 wiring of `assertOutboundAllowed`; DB rejection of historical `his_export` (AT-HIST-13) | after P6 merges |
| Usability acceptance with real staff (AT-UX-LDR-01, UQ-11) and visual baselines | not done — only automated axe AA and a functional Playwright run |
| Native PostgreSQL two-session concurrency test for AT-HIST-16 | the lock and the unique index are in place; the two-session test is not written |
| Excel: multi-sheet workbooks, `.xls`, date cells other than integer serials | not supported (first sheet only) |

## 8. Hand-off notes

- P6: call `assertOutboundAllowed({origin, lnVerification})` before queueing, building or publishing anything; historical cases have origin `HISTORICAL` and LN `DOCUMENT_VERIFIED`.
- Integrator: apply migration 070 after 060; re-run `tools/prepare-db.ts` to refresh grants; keep the worker running (`synthetic_historical_stage` is registered in `JOB_KINDS`).
- To try it locally: activate `go_live_cutoff` and `historical_backfill` through Settings (Certifier proposes, Clinical Approver approves), give the importer `HISTORICAL_ENTRY` and the reviewer `HISTORICAL_VERIFIER`. `tests/e2e/p5h-bulk.spec.ts` does exactly this against the real web app and worker.

## 9. Evidence

2026-10-13, branch `feat/p5h-historical-backfill-synthetic`: `tsc --noEmit` clean · `npm run lint` clean · `npm run guard` PASS (411 files) · `npm run build` (production) compiles with the new routes · `npx vitest run`: 54 files passed, 13 skipped (environment-gated native/legacy-sample suites), 1,261 tests passed, 14 skipped, 0 failed · Playwright `tests/e2e/p5h-bulk.spec.ts` (real web app, real worker, PostgreSQL 17, axe WCAG 2.2 AA on the pages): 2 passed — 47 cases uploaded as CSV + ZIP, one broken row fixed in the UI, a different verifier confirmed all 47, 47 `HISTORICAL` cases and 0 `his_order` rows. Migration 070 and the new grants were also applied by `tools/prepare-db.ts` to a real PostgreSQL 17 database.
Not run: the other Playwright specs (they need a freshly recreated browser database; the only shared UI change is a sidebar link shown solely to users holding `HISTORICAL_ENTRY` or the verifier role), the native-PostgreSQL contract suites (`NIPT_TEST_DATABASE_URL`), and any real-data run.
