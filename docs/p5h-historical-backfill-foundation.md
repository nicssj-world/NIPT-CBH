# P5H Historical Backfill — Synthetic Foundation

2026-10-13 · branch `feat/p5h-historical-backfill-synthetic` (from `origin/main` bd50f16, after PR #6) · Plan v6.2.1 · Gate AL-8 **NOT READY**.

**Status: restricted synthetic pure foundation only.** No UI, API route, worker job, migration, real data, HIS/LAN access or Clinical approval is involved. Passing these tests does not make Historical Backfill ready for use; it proves that the rules which can be decided without Owner/Clinical Governance input are implemented and cannot be bypassed.

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

## 5. Gaps found in the current schema (why no migration was added)

1. `case_guard()` (001) mixes "no HISTORICAL insert" with origin/identity immutability in one trigger; a promotion migration must replace it so creation is allowed only with a passing evaluation while immutability stays.
2. `case_ln` CHECK and `ln_insert_guard()` accept only `AWAITING_PET/VERIFIED_BY_PET/RETIRED`; `DOCUMENT_VERIFIED` (D-47) is rejected (test documents this).
3. `history.promote`/`history.send` are hard-denied in `authorize()` and `history.draft` has no verifier-separation hook; enabling promote is a policy (clinical) change and needs approval.
4. `go_live_cutoff` catalog default is null and Settings coverage lists it Deferred to P5H; the OD-27 DB guard exists and is now tested.
5. No `his_export` exists on main (P6 branch only); the AT-HIST-13 DB rejection must be added with/after P6 — P6 must call `outboundBarrier`/`assertOutboundAllowed`.

**Migration proposal (not applied):** a single forward migration in a new reserved band `070–079` (P6 currently uses none beyond 051; confirm with the P6 owner before use) adding `historical_draft`, `historical_eligibility_evaluation`, `historical_record`, `historical_evidence_item`, `historical_event`, `historical_result_import`, `historical_verification` and a bulk-batch table (below), plus replacement of `case_guard`, `ln_insert_guard`, the `case_ln` CHECK, insert-only/CHECK(verifier≠recorder) triggers and a `his_export`/`his_order` rejection for HISTORICAL. Needs Owner/reviewer approval before authoring.

## 6. Bulk Import — NEXT IMPLEMENTATION TASK (not started; per Owner scope 2026-10-13)

Not built this round (usage limit). Gaps to close:
- Row parser for Excel/CSV (template columns: LN, HN, name, DOB, collection/report dates with resolution, Consent-as-written, pregnancy type, original location, PDF file name) → per-row `HistoricalDate`, evidence items, events; `legacy-map` already gives the shape for NIPTY-derived rows.
- PDF/ZIP matching to rows by LN with SHA-256 and identity-in-file check (reuse P5 `extract`/parser, no HIS path); unmatched/duplicate/extra files as errors.
- `bulkBatch` model: one batch ≈ 47 rows, all-or-nothing confirm or per-row outcome (decision needed), per-row error list, idempotent confirm, batch hash, batch audit.
- Background automation for the Owner's 3-step UX: batch creates drafts → auto pre-check → auto eligibility → reviewer queue showing batch + per-row errors → independent reviewer confirms the batch (verifier ≠ every recorder) → per-row Promotion transaction under LN lock. Needs the migration above and an Owner decision on partial-batch behaviour and how row-level original checking (D-46 item 3) is evidenced for a batch.
- UI (3 steps), API routes, worker job, accessibility/visual gates (AT-UX-LDR-01 historical mode), Playwright E2E.
- DB concurrency tests AT-HIST-16, `his_export` rejection AT-HIST-13 with P6, permission rows for the verifier role and policy change for `history.promote`.
- Still blocked by AL-8 decisions in §4.

## 7. Evidence (this branch, 2026-10-13)

`npx tsc --noEmit` clean · `npm run lint` clean · `npm run guard` PASS · `npx vitest run`: 52 files passed, 13 skipped (environment-gated legacy-sample/native suites), 1234 tests passed, 14 skipped, 0 failed. Playwright E2E was not run (no UI changed). P6 worktree untouched.
