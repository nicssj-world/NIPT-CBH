# P4b Pooling / QC2 / F4 — restricted synthetic continuation

2026-10-13. Existing branch `feat/p4b-halos-export-contract`, Draft PR #2. P4 main merge `5d859c3a8be433b10668a9b097396cf1be69c54e` was merged without conflict as `c0535f7`. Original P4b `424e9c520d3a5dc193e1e5148bc8debf880cdf51` and all 44 HALOS contract tests are preserved. PR #4 was not used. No Production, live HIS, real patient data, XLSX writer, DNB, sequencing or HALOS connection.

## Authority and architecture

The session start order authorizes safe synthetic implementation, commit/push and updating Draft PR #2, while forbidding merge and requiring pending decisions to remain HOLD. Read-only source: `NIPT_CBH_Implementation_Plan_v6.2.1_Reviewed_2026-10-11.md`, SHA-256 `261acf8cebec7915d255abaccf02e2bb55d76de0a59b26d9c7abc7b0c7703c2e`, rechecked this session. Applied §§12.12, 12.20–12.23, Appendix C.3 FS-03–07, F4 field inventory and §12.26 eligibility. Reviewed P4 delivery and existing HALOS mapping evidence. Available later P4 owner locks concern receipt sorting and tube labels; no approval of OD-28/29/30/31 or F4 inventory was found in the reviewed evidence.

Extend P4 in separate `packages/pooling` modules, preserving identity/placement/QC1/document contracts. Add insert-only Pool attempts/events, observations/reviews, QC2 decisions, F4 originals/copies and final snapshots. Reuse transactions, RBAC/sessions/CSRF, audit chain, immutable file store, checksum-enforcing migrations and isolated Chromium. No HALOS adapter is called or enabled.

Clinical F4 and PoolAccepted require approved counting/volume/precision/criteria and remain unavailable. The explicitly separate `SYNTHETIC_SIMULATION` purpose produces visibly labelled simulation Pre-work/Completed artifacts for testing. These are **not operational worksheets or approved controlled forms**. PDFs/derivatives say not for clinical use. No setting can promote them into approval. Operational issue/accept/export return `OWNER_DECISIONS_HOLD` (423) to authorized certifiers.

## Behavior and provenance

- Membership is derived from immutable Placement snapshots. Patient attempts need current round/assignment, no withdrawal/Hold/resume decision, `InProgress`, Sheet `ExecutionVerified`/`CompletedIssued`, Verified QC1 with a different-person confirmation and Accepted decision referencing that exact observation. Any disposition excludes the slot. Empty/unfinalized positions never produce patient rows or zero values.
- Explicit unapproved scenarios distinguish Patient-only from Patient+PC+NC. Blank40 is always excluded. PC/NC inclusion remains OD-28. Frozen data includes physical position/plate, Printed ID/LN Halos, case/round/attempt lineage, QC1 observation/review/decision and Placement IDs/revisions/hashes. Tube date uses Bangkok time.
- Decimal precision 40/HALF_UP, formula version, inputs/constants and scenario pipette precision (2–6) are persisted. FS-04 per-member values are kept at computation precision; FS-05 exact total and rounded-command total/buffer are separate. Total/buffer serialization uses 24 decimal places. Reject empty N, duplicate positions, invalid/nonpositive concentration or parameters, negative buffer including after command rounding, and volumes rounded to zero. No clinical tolerance, buffer policy or manual-pipette cutoff is invented.
- Seeded sampling without replacement uses proposed `k=min(3,N)`. API/browser hide system results until submission. Exact comparison at scenario precision; values, seed, positions, actor/time/result are immutable. Mismatch records nonconformity HOLD and requires a new Pool attempt. Automated fixtures enter synthetic answers; this is **not witnessed Lab validation or signed Excel goldens**. Independent arithmetic: `160*16/(2*10)=128 µL` each; sum `256`; scenario desired `768`; buffer `512`.
- F4 simulation requires successful sampling and an actor-bound preview of the same current evidence. Preview is transient/DRAFT. Pre-work has empty execution boxes and no actual values/ticks. Original bytes are SHA-256 addressed and reused for Original reprint. Working/status copies have independent hashes, original-hash reference, serial, actor/time and repeated page footer. Currentness is shown outside the original PDF.
- Server-anchored Start/End prevent early Transfer/QC2. Actual Buffer differs from planned Buffer. Paper entries require a current working copy, event time/precision (or explicit NOT_RECORDED), source and separate verifier. Correction/remeasure inserts evidence with exact supersession/reason; old values remain immutable.
- QC2 and Standards need verification. Criteria version is pinned `QC2-WI-BM19-UNAPPROVED-OD31-v1`; no Accepted option or automatic clinical pass. Remeasure requires new QC2 and fresh review; Hold/Failed block the Pool. Replacement creates a new Pool attempt, never a patient analytical attempt.
- Completed simulation requires every Transfer, actual Buffer, QC2/Standards Verified, End and human `SyntheticReviewed` on current QC2. The final snapshot freezes calculation, QC1/QC2, sampling/execution, actor/time and F4/hash references, revision 1, `acceptance=HOLD`, `exportAllowed=false`.
- Mutations serialize through the Batch row/optimistic version; source reads lock Sheets. Upstream changes atomically Stop-use downstream evidence, including placement/QC1/disposition/attempt/Hold/withdrawal/cancellation. Automatic events identify the system and source row, never a fabricated human. Source digests recheck currentness on actions/reads. Stop-use blocks execution/working copies. Immutable recall is required before replacement. Cancelled batches retain original evidence read/reprint/recall.

## Database and security

Additive migrations `011_p4b_pooling_synthetic.sql`, `012_p4b_pool_cancellation_guard.sql`, `013_p4b_system_invalidation_actor.sql`. 001–010 remain byte-identical to main. HALOS library/tests remain byte-identical to previous P4b. Applied only to disposable loopback synthetic databases using the normal migrator; iteration databases retained, no ledger repair/reset or remote mutation. Checksums: [migrations.md](migrations.md).

Lab records/samples/prints; certifier reviews/decides QC2/recalls; Auditor reads; ANC denied. Pool tables grant `app_rw` SELECT/INSERT only, worker no access. DB guards enforce immutable evidence, observation scope/anchors/copy provenance/exact supersession, second-person review, verified QC2 and synthetic/HOLD constraints. API validates sessions/CSRF/strict schemas, returns no-store and audits denials. CSP permits blob frames only on the Pooling preview route. Typed renderer escapes text and blocks network.

## Verification

New tests: `p4b-calculation.test.ts`, `p4b-f4.test.ts`, `p4b-pooling.test.ts`, `p4b-native.test.ts`, `p4b-pooling.spec.ts`. Cover one/three-sheet partial membership, PC/NC/Blank, invalid calculations, blind checks, preview/early execution, planned/actual values, paper reconciliation, QC2 remeasure, immutable snapshots, cancellation/Stop-use/recall/replacement, byte-preserving reprint, multipage Thai PDF/footer, native app_rw races/rollback and browser/RBAC/clinical gates. Axe/responsive checks include populated members at 375/768/1280/1440 px; keyboard access is provided for the scrollable table.

Final local validation: typecheck, lint (zero warnings), source guard (299 files), build and production dependency audit (zero vulnerabilities) passed. Vitest: 1,072 passed and one existing external-parser differential skipped, including all eight native PostgreSQL tests on PostgreSQL 17.11. Playwright: all 54 passed on Windows, including existing visual baselines. Exact-head CI results are recorded in PR #2. Existing tests/baselines retained. Build has three pre-existing tracing warnings in unchanged PDF-preview/secrets routes. With native tests enabled the sole skip is the existing legacy differential requiring an external parser. Full browser runs use a fresh reserved browser DB: the preliminary reused-fixture run correctly failed Foundation's three-row assertion, followed by a clean-seed rerun without changing tests/baselines. Populated-table axe also caught keyboard scrolling, fixed by a named focusable region.

## HOLD / next milestone

| HOLD | Required owner evidence |
| --- | --- |
| OD-28 | Counting contract, PC/NC, partial membership, sampling population/k |
| OD-29 | Constant/desired volume/units, buffer, pipette precision/rounding/tolerance, manual grouping |
| OD-30 | QC2 failure/remeasure/dilution/repool pathway |
| OD-31 | Approved QC1/control/QC2 effective criteria |
| Field inventory / Q-G4 | Lab+QA-signed fields, controlled codes/content, physical print acceptance |

Inherited OD-04 responsibilities, OD-33 stability, OD-36 verification and P4 clinical/consent decisions remain separate. No AL-4b acceptance, operational F4, PoolAccepted, HALOS adapter/export, vendor import or deployment. Future HALOS integration must load a persisted accepted/current Pool snapshot and exact Placement/identity lineage; a caller-provided synthetic snapshot is not approval.
