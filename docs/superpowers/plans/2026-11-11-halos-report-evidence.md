# HALOS report evidence implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify this plan inline.

**Goal:** Confirmed, matched HALOS results are the completed-analysis and paper-document evidence at report time. Do not demand QC/Pooling worksheet transcription or digital request/consent again.

**Architecture:** Bind a separate HALOS evidence reference to each report review. Reuse this exact source in validation, certification and outbound eligibility; never manufacture bench reviews, QC measurements or paper-registration records. Scope the change to internal reports generated from current confirmed patient HALOS rows.

**Tech stack:** TypeScript, PostgreSQL forward migrations, Vitest, synthetic PGlite and native Microsoft Word.

**Spec:** Owner instructions in the current session: batch intake owns document readiness; HALOS output means completed analysis and paper request/consent readiness at reporting.

## Constraints and review focus

- Continue the existing working tree and migration 219; do not modify applied migrations or Production.
- Preserve exact sample/round identity, current HALOS evidence, explicit withdrawal/refusal, active holds, PDF integrity, signer authority and EQA outbound exclusion.
- Do not let arbitrary external PDFs or unconfirmed/control HALOS rows use the new evidence path.
- Keep source-specific review evidence so later replacement/dismissal invalidates approval and outbound eligibility.
- Grant required read/execute permissions to actual app/worker roles; test both role paths where available.

## Tasks

- [ ] Add a regression with confirmed HALOS, empty QC/Pooling/Seq worksheet and no repeated digital paper-document check; observe failure first.
- [ ] Add migration 220 with current HALOS source helpers, a distinct QC5 evidence class, and scoped validation/release/outbound support.
- [ ] Update preparation, report review, result gate facts and report detail to consume that evidence without rechecking upstream worksheet/documents.
- [ ] Run focused regression/native report tests, typecheck/lint and migration rehearsal; review the complete diff.
- [ ] Report exact scope and local verification. Production publication is a separate action.
