# NIPT-CBH — TASK 1 + TASK 2 + UI INTEGRATION BASELINE & TASK 1.5 FULL IMPLEMENTATION

## MISSION

Implement Task 1.5 — Simplified ANC/LAB Registration & HIS PET Autofill.

**Execute implementation ONLY AFTER Task 1 and Task 2 are technically verified and a safe, isolated Task 1 + Task 2 + UI Integration Baseline has passed its preflight. The Owner expressly deferred hands-on acceptance to ONE Final Integrated Owner UAT after Task 3; do not require separate Owner sign-off for Task 1/Task 2 before Task 1.5.**

This is a complete implementation order for Task 1.5, not a preparation-only task.

Integrate the proven Task 1, Task 2, UI Remediation and APP_ADMIN changes into a protected **internal synthetic integration candidate**; implement, test and technically close Task 1.5. **Do not deliver a separate Owner UAT** or claim Owner Acceptance. Final Owner UAT occurs ONCE after Task 3 is integrated and verified.

**STRICT SCOPE. NO UNAPPROVED FEATURES. NO INVENTED REQUIREMENTS.**

## 1. PROJECT

Repository:

`D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`

Current Local UAT reference:

`https://127.0.0.1:19548`

The path and URL are historical references. Discover and verify the actual accepted working tree, database, running application, source revision and integration state at execution time. Do not assume they remain unchanged.

### Authoritative requirements

1. `NIPT-CBH_Registration_Workflow_Handoff_2026-10-24.md`
2. `docs/task1-5-registration-owner-lock-20261024.md`
3. Latest **technically verified** Task 1 Candidate and evidence (reference commit: `cf70065d8eed6f3096f870ebd683035db666d98d`; verify current evidence, not the short hash alone)
4. Latest **technically verified** Task 2 Storage source, migration 126, and evidence (note: shared checkout is dirty; provenance must be reconciled)
5. `docs/lab-workflow-owner-lock-2026-10-21.md`
6. `docs/his-workflow-owner-lock.md`
7. `docs/p2-paper-consent.md`
8. Existing accepted ANC/Consent and HIS/PET integration contracts
9. Latest actual Source Code and Database Schema
10. Latest UI Remediation **Corrective Action** implementation, after true visual Before/After corrections (the former 125 PASS summary alone is not acceptable visual evidence)
11. APP_ADMIN System-wide Access Owner Lock and cross-role permission tests
12. Owner's updated delivery instruction: **ONE integrated Owner UAT only after Task 3**, no separate Task UAT handoffs

Priority: Latest explicit Owner-approved decisions override older conflicting documents.

Do not interpret historical GitHub `main` as the latest development source.

## 2. PRECONDITIONS — MUST PASS BEFORE MODIFYING CODE

Verify:

- [ ] Task 1 Candidate is **technically completed and independently verified** (56/56 PASS, source/runtime parity in its original isolated candidate); Owner hands-on acceptance is deferred.
- [ ] Task 2 Storage is **technically completed and independently verified** (including storage interaction, persistence, movement audit and label readback); Owner hands-on acceptance is deferred.
- [ ] UI Remediation corrective source and APP_ADMIN source are inventoried and have relevant technical test evidence; Owner visual approval may remain pending until final integrated UAT.
- [ ] The actual verified code for Task 1, Task 2, UI/APP_ADMIN is present in the **isolated, provenance-checked integration baseline** and the no-regression baseline is frozen.
- [ ] Current Git branch, HEAD and worktree changes are inventoried.
- [ ] Current database schema/migration ledger is verified.
- [ ] Latest runtime source fingerprint and service versions are known.
- [ ] Current Local UAT data and files have a verified backup.
- [ ] Existing ANC, LAB, Storage, PET, Consent and LN Halos workflows are documented from actual source.
- [ ] Any overlap with accepted Task 1/2 code has been identified.

If either Task 1 or Task 2 has **not passed its technical acceptance**, or if the integration baseline fails its technical preflight, do not begin Task 1.5 code changes. Do **not** block implementation merely because the Owner postponed hands-on acceptance until after Task 3.

If the technically verified baseline is unclear, fail the affected preflight and identify the exact missing evidence. Do not guess, reset Git or overwrite verified work.

## 2A. MANDATORY INTEGRATION BASELINE — RUN BEFORE TASK 1.5 CODE CHANGES

This phase exists because isolated Task 1, Task 2 and UI UATs served different source trees and menus; the Owner must NOT need to switch among ports to inspect features. Treat all source candidates as inputs, NOT as a final integrated system.

### Source provenance and merge safety

1. Inventory exact HEAD, dirty status, source fingerprint, modified/untracked paths and evidence for the **Task 1 isolated Candidate**, **Task 2 Storage**, **UI corrective/APP_ADMIN worktree**, and **shared checkout**. Do not assume older summaries describe the current filesystem.
2. Preserve every original worktree and its files. Do not reset, discard, overwrite or force-commit shared/foreign work. Back up inputs where needed.
3. Create a **new isolated integration worktree and branch** from a proven baseline. Compose verified deltas with an explicit path-by-path ownership and conflict map. Do not bulk-copy stale `node_modules`, `.next`, `.local` runtime files, or synthetic secrets into source.
4. Avoid naive `ours`/`theirs` conflict resolution. Resolve functional conflicts against the latest approved Owner Lock and verify exact behavior in the integrated runtime.
5. Migration 123/124/125 belong to Task 1; **126 belongs to Task 2**. On an **isolated test DB only**, inventory migration hashes, ledger, data and backup; apply each unapplied migration safely and in order. Never repeat an applied migration or touch Production.
6. Confirm one candidate contains **Task 1 workflows, Task 2 Sample Storage, UI corrective layouts, ANC Top Navigation, APP_ADMIN system-wide permissions, and existing LAB navigation** simultaneously.
7. Specifically check that the final desktop/mobile `/sample-storage` actually displays Backup/Buffy Coat 9×9 boxes, Auto-fill, moves, search, labels, role-based navigation, and other technically verified Task 2 functionality. A page/route in an older worktree is NOT enough.
8. Cross-check all top-level and deep-link navigation, permissions and authenticated APIs on the merged candidate, and verify that the screen shown in the **runtime** matches the **source and approved visual changes**.
9. Verify source/build/runtime fingerprints, worker/renderer/web/database health, restart/persistence, preserved synthetic baseline and no regressions in Task 1/2. Test in an isolated synthetic environment; never mutate preserved Owner UAT data for destructive tests.
10. If a gate requires a clean Git tree, make only justified **local integration-candidate** checkpoint commits of reviewed code, when needed; do not commit the shared dirty worktree, and never bypass the gate.
11. Record the exact source commits/diffs, migration ledger, hashes, tests and outstanding infrastructure limitations before Task 1.5 starts. Do not conflate Technical PASS with Owner Acceptance.
12. Do not send an interim Owner UAT or ask the Owner to test Task 1/Task 2/UI separately again. Internal authenticated browser tests on the integrated candidate are required.

**Integration preflight PASS is mandatory before editing Task 1.5 implementation.** If a proven merge conflict requires a code compatibility fix, make the narrowest required fix and retest all affected contracts. Do not implement Task 3 during this phase.


## 3. OWNER-LOCKED FUNCTIONAL SCOPE

### A. LAB Registration

Implement the following workflow:

1. LAB enters **LN OR HN**. Either one is sufficient.
2. System locates eligible existing HIS PET evidence using the entered identifier.
3. After authorized, unambiguous matching, show basic data obtained from PET:
   - HIS LN
   - HN
   - Patient name
   - Date of birth
   - Sex
   - Collection date/time
   - HIS specimen receipt date/time
   - Ward (Ordering Department)
4. If HN matches multiple eligible LN/orders, the user must choose the correct one explicitly.
5. Verify matching PET, applicable `.ok` readiness, identity and actual HIS receipt before issuing LN Halos.
6. Generate LN Halos automatically using the already-approved receipt-trigger mechanism.
7. If LN Halos already exists, reuse it. Never generate a duplicate.
8. Allow missing GA, EDD/EDC, Singleton/Twins and other clinical data to be entered later in Sample Detail.
9. Provide Paper Consent / existing Electronic Consent channel choice.
10. Paper Consent is only a marker for the physical document accompanying the specimen. Do not require scan, upload, printing or a new signature to select the marker.
11. Do not show an Ordering Department dropdown.
12. Preserve the existing ability to print labels after a valid receipt/number allocation.

Do not introduce a second LAB receive confirmation, approval step or manual LN Halos generation action.

Preserve the distinction between LAB_OPERATIONAL and LAB_MANUAL_COMPLETE. Do not make historical/manual completion depend on a PET receipt.

### B. ANC Registration

1. Remove Ordering Department dropdown from ANC Registration.
2. ANC can register and complete its existing Request/Consent workflow before PET arrives.
3. While PET is absent, Ordering Department may display `รอข้อมูลจาก HIS`.
4. After valid PET matching, automatically populate Ordering Department from HIS Ward.
5. Display this value in Sample Detail.
6. Never use the logged-in user's department as a substitute for Ordering Department.
7. Preserve all accepted ANC Request, Consent, physician registry, signatures, forms, access control and clinical review behavior.

Do not create a new ANC Registration process or change approved Request/Consent templates.

### C. PET Mapping and LN Halos

Owner-locked PET fields:

- `P[2]` = HIS LN
- `P[3]` = HN
- `P[5]` = Patient name
- `P[7]` = DOB
- `P[8]` = Sex
- `P[21]` = HIS order timestamp
- `P[23]` before `^` = Collection timestamp
- `P[23]` after `^` = HIS receipt timestamp
- `P[33]` before `^` = Ward / Ordering Department
- `P[33]` after `^` = Patient identity, NOT Ward

Preserve the validated NIPT Section 7 / Test Code 70096 filtering and existing `.pet` / `.ok` contracts.

The HIS receipt is a real HIS event; do not substitute the time that the application read the file.

LN Halos must retain:

- Existing approved format
- Continuous sequence across days within the same month
- Monthly reset only
- Existing allocated numbers
- Idempotency and concurrency safety
- Existing S1/S2+ and resampling lineage rules

No daily reset. No renumbering. No fabricated PET or receipt.

## 4. CRITICAL INTEGRATION REQUIREMENTS

Before editing, inspect and trace the actual interfaces between Task 1.5 and the accepted Task 1/Task 2 implementation.

### Integration I01 — ANC ↔ LAB Registry

Both registration methods must continue to use the same central patient/case identity model.

Do not create duplicate patients, cases or conflicting current rounds.

### Integration I02 — HIS PET ↔ Registration

Verify:

- PET discovery
- `.ok` readiness
- Stored file and hash validation
- LN/HN matching
- HN with multiple LN
- Missing PET
- Ambiguous PET
- Identity mismatch
- Concurrent registration
- Registration retry

Do not expose unauthorized patient information through an HN-only search.

### Integration I03 — Registration ↔ LN Halos

Registration may establish/open a case, but number allocation must remain tied to the approved valid specimen-receipt event.

Verify the existing DB trigger and locking strategy. Do not add a competing number allocator.

### Integration I04 — Registration ↔ Consent

Check Paper Consent marker semantics against the current accepted downstream guards.

Preserve refusal, revocation, clinical review, certification and release protections.

Selecting Paper Consent must not fabricate signing evidence, a review decision or clinical approval.

### Integration I05 — Registration ↔ Task 1

Verify that newly registered samples correctly enter the existing LAB workflow after satisfying its accepted gates.

Preserve:

- Ready queue
- FIFO sorting
- Urgent and Repeat assignment
- Task List 1–3
- QC/Pooling/Sequencing
- Analytical attempt identity
- Resampling suffixes
- Existing completed/finalized work
- Result matching and release

Do not change any accepted Task 1 behavior to make Registration easier.

### Integration I06 — Registration ↔ Task 2 Storage

Inspect the actual accepted Storage Box implementation and its interfaces.

Verify that registration changes do not break:

- Specimen identity references
- LN/LN Halos mapping
- Specimen round references
- Sample Detail navigation
- Storage association and retrieval
- Existing Storage permissions
- Historical storage records

Do not modify Storage assignment, location, movement, capacity, retrieval or any other Storage business rule unless a proven integration defect requires a minimal compatibility fix.

Do not invent Storage features or infer undocumented Storage rules.

### Integration I07 — Ordering Ward ↔ RBAC

Distinguish:

**PET Ward = Ordering Department**

from:

**Logged-in user's unit / `unitId` = access and permission scope**

Removing the dropdown must not accidentally remove required internal RBAC scope.

Never replace PET Ward with a default user department.

### Integration I08 — HIS Outbound and Clinical Results

Verify no regression in PET → analytical workflow → external PDF → review/certification → RES/PDF/OK.

Do not modify HIS outbound format or release authority.

### Integration I09 — Cross-role ANC / LAB / APP_ADMIN UI

Owner-locked UI behavior:

- **ANC-only**: ANC Top Navigation with original authorized routes and a working Logout. No ANC Left Sidebar.
- **APP_ADMIN**: one global navigation shell, entry to all existing ANC/LAB/Settings areas, real server-side permissions for all APP_ADMIN-authorized APIs, and a single functional Logout. Do not conflate displaying a menu with granting actual access.
- **LAB_STAFF**: preserve the approved LAB Sidebar and its authorization boundaries. Do not inherit APP_ADMIN permissions.
- Preserve UI Remediation **visual corrective changes** to connection status, result import and runtime/services health; grouped compact label/value presentation, clear alerts, Thai wrapping, desktop/tablet/mobile and light/dark.
- Preserve original clinical sign-off actor identity and audit; APP_ADMIN rights must not fabricate a professional signature or bypass clinical gates.
- Inspect the live integrated runtime with real authenticated roles; a synthetically simulated role switch is not adequate proof.

### Integration I10 — One Owner UAT after Task 3

Task 1.5 must end at **TECHNICALLY READY FOR TASK 3**, not at separate Owner UAT. Keep internal synthetic regression evidence, an internal integration URL if useful for Codex, and the exact credentials **without publishing passwords into the source/reports**. Following Task 3 integration, the final combined Owner UAT must use one verified URL and a documented, working test account. The Owner-requested local synthetic `admin/admin` convenience applies only where that isolated synthetic account has been intentionally provisioned; do not seed operational/Production databases by inference.

## 5. IMPLEMENTATION STRATEGY

1. Inventory the accepted source code and database schema.
2. Map the exact requirements to existing implementation.
3. Classify each requirement:
   - Already implemented and verified
   - Partially implemented
   - Missing
   - Conflicting implementation
4. Modify only genuinely missing or conflicting behavior.
5. Reuse existing registration, PET matching, identity, consent and LN Halos infrastructure wherever possible.
6. Add a forward-only migration only when proven necessary.
7. Preserve historical records, signed documents and immutable evidence.
8. Maintain existing project UI components and design conventions.
9. Do not refactor unrelated code.
10. If an integration conflict is encountered, apply the smallest compatible correction within the approved contract.

**Do not rebuild the Registration subsystem from scratch if existing components can be safely adapted.**

## 6. MANDATORY ACCEPTANCE CHECKLIST

The final report must close all 20 requirements:

- [ ] R15-01 — LAB LN-only registration and PET autofill.
- [ ] R15-02 — LAB HN-only registration.
- [ ] R15-03 — Safe explicit selection when HN has multiple LN.
- [ ] R15-04 — Missing/invalid/ambiguous PET and incomplete OK handled safely.
- [ ] R15-05 — Correct PET parser and HIS NIPT filtering.
- [ ] R15-06 — Correct automatic monthly LN Halos allocation.
- [ ] R15-07 — No duplicate cases/numbers under retry or concurrency.
- [ ] R15-08 — Clinical data can be completed later in Sample Detail.
- [ ] R15-09 — LAB Paper Consent marker works without additional paperwork.
- [ ] R15-10 — Electronic Consent and downstream safety guards preserved.
- [ ] R15-11 — No Ordering Department selector in LAB.
- [ ] R15-12 — No Ordering Department selector in ANC; pre-PET ANC workflow still works.
- [ ] R15-13 — Ordering Department pending state and later PET Ward autofill.
- [ ] R15-14 — Correct P[33] Ward/identity split.
- [ ] R15-15 — RBAC, patient identity, HIS and lineage regression passes.
- [ ] R15-16 — Responsive and accessible UX without redundant input.
- [ ] R15-17 — Unit/DB/Contract/Permission/Native PostgreSQL tests pass.
- [ ] R15-18 — Authenticated Browser E2E passes against actual integrated application.
- [ ] R15-19 — Data persistence, backup and source/runtime parity verified.
- [ ] R15-20 — Full implementation/integration report with evidence and known external limitations.

For every item record:

- PASS / FAIL / BLOCKED / NOT VERIFIED
- Relevant source implementation
- Actual test result
- Browser/runtime evidence where applicable

Do not mark an item PASS based on source-code inspection alone when behavior testing is required.

## 7. CROSS-TASK REGRESSION GATE

In addition to R15-01–20, verify the accepted Task 1 and Task 2 workflows remain functional.

Required regression groups:

- ANC → Request → Consent
- LAB → PET → Registration → LN Halos
- LAB → Task List → QC → Pooling → Sequencing
- Re-Library / Re-Extraction / Re-Sampling
- Sample identity → Storage Box → Retrieval
- Paper Consent → clinical review gates
- Result import → review → certification → HIS export
- Existing signed PDFs, audit and historical records
- RBAC and negative identity tests
- Restart/persistence and readback

Use the original **technically verified** Task 1/Task 2 evidence as the baseline, then run relevant integration and affected regression tests against the final Task 1.5 code. Also verify the UI corrective layout and APP_ADMIN role changes from I09 survive the integration.

Do not reopen or redesign Task 1 or Task 2.

## 8. UX/UI REQUIREMENTS

Follow existing application patterns, and use UX UI Pro Max / Impeccable if available.

Requirements:

- Fewest necessary registration inputs
- Clear PET lookup status
- Clear distinction between verified HIS fields and later clinical fields
- Explicit LN selection only for genuinely ambiguous HN results
- No confusing duplicate department selector
- Paper Consent choice is simple and unambiguous
- Helpful errors without exposing unauthorized PHI
- Keyboard accessible
- Responsive at 1440, 1280, 768 and 375 px
- No overlapping text or controls
- User knows what action comes next

No new dashboard, tabs, wizard, approval, scan/upload requirement or navigation redesign outside approved scope.

## 9. EXECUTION AND LOCAL UAT

After code changes:

1. Run focused tests first.
2. Fix any proven Task 1.5 defect.
3. Run affected integration/regression suites.
4. Verify native database behavior.
5. Exercise authenticated browser workflows with authorized synthetic data.
6. Generate and verify any affected PDF/label outputs.
7. Validate Storage compatibility.
8. Confirm data/volume backup integrity.
9. Rebuild affected **internal isolated integrated synthetic test** services from the frozen integration source; do not overwrite separate historical UAT runtimes.
10. Apply any necessary migration only after verifying its scope and safety against the **isolated integration test DB** schema, ledger and a verified backup; do not migrate preserved Owner UAT or Production.
11. Verify Source ↔ Runtime hash parity.
12. Verify login, worker, renderer, database and app health.
13. Confirm existing data preservation after restart.

Do not run destructive test scenarios against preserved Owner data. Use an isolated synthetic database when required.

Do not publish to the hospital server or Production.

## 10. ABSOLUTE PROHIBITIONS

- DO NOT work outside Task 1.5.
- DO NOT invent clinical, regulatory or software requirements.
- DO NOT reinterpret Owner-confirmed PET fields.
- DO NOT change accepted Task 1 business rules.
- DO NOT change accepted Task 2 Storage business rules.
- DO NOT alter historical or immutable clinical evidence.
- DO NOT create a different LN Halos numbering system.
- DO NOT change PET/RES/OK wire formats.
- DO NOT introduce extra registration, signing or approval steps.
- DO NOT add unnecessary database tables or workflows.
- DO NOT bypass identity verification, consent or result-release guards.
- DO NOT modify original Excel/PDF Masters unnecessarily.
- DO NOT reset/revert/discard unrelated Git changes.
- DO NOT overwrite another active worktree.
- DO NOT force a commit to make validation pass.
- DO NOT push, merge or deploy Production.
- DO NOT create a Windows Setup/Update EXE.
- DO NOT modify Genomic-CBH, POCT, Portal, LABCBH Stock or unrelated systems.
- DO NOT fabricate test results or mark unverified requirements PASS.

When requirements are truly ambiguous or conflicting, stop only the affected implementation decision, report the exact conflict with source references and ask the Owner. Continue independent approved work where safe.

**No autonomous product decisions outside Owner Lock.**

## 11. DEFINITION OF DONE

Task 1.5 is **`TECHNICALLY READY FOR TASK 3`** only when the locally testable requirements are proven on the **merged integration candidate**. The Owner will conduct **one** hands-on UAT **after Task 3**; do not claim Owner Accepted now.

1. R15-01 through R15-20 are verified PASS for every locally testable requirement.
2. No unresolved Task 1.5 defect remains.
3. Task 1 and Task 2 accepted workflows still pass affected integration tests.
4. Actual authenticated Browser E2E passes.
5. PET matching, LN Halos uniqueness and consent safety pass negative tests.
6. Storage integration is verified without changes to Storage business rules.
7. Data and audit history remain intact.
8. Latest **isolated integrated internal test runtime** matches the final source.
9. Complete evidence is available for Owner review.

Clinical/Hospital/real-HIS/hardware acceptance must be reported separately and cannot be invented.

## 12. FINAL DELIVERY

Create or update:

`docs/TASK1-5-FINAL-ACCEPTANCE-2026-10-24.md`

Include:

- Final verdict: TECHNICALLY READY FOR TASK 3 or NOT READY (never Owner Accepted before the unified UAT)
- Actual **technically verified** Task 1/Task 2/UI/APP_ADMIN source baseline and merge provenance
- Requirement-to-code traceability
- R15-01–R15-20 checklist
- Exact changed files and reasons
- Database migrations, if any
- Tests with actual PASS/FAIL/SKIP counts
- ANC/LAB browser evidence
- HIS/PET/LN Halos integration evidence
- Task 1 regression evidence
- Task 2 Storage regression evidence
- Runtime source and image hashes
- Data preservation verification
- Working internal integrated synthetic test URL, access instructions, and proof of authentication (**not** a separate Owner UAT handoff)
- APP_ADMIN/ANC/LAB role regression, navigation and UI corrective visual evidence
- Outstanding genuine external acceptance items, including **Owner visual acceptance deferred to Final Integrated UAT after Task 3**

**Execute end-to-end within the authorized scope. Do not stop at an audit, plan or partially completed code.**

Deliver one final closeout report. If a real blocker prevents completion, report it accurately with evidence. Do not invent success.

**The Owner expects a working, verified Task 1.5 Registration workflow integrated with technically verified Task 1, Task 2, UI corrective changes and APP_ADMIN rights — without unapproved changes. After Task 3 is complete, deliver ONE integrated Owner UAT, never scattered individual task previews.**

## 13. OWNER DELIVERY POLICY — SINGLE INTEGRATED UAT

This policy supersedes any older lines in referenced documents requiring **separate** Task 1 or Task 2 Owner Acceptance **before** Task 1.5 implementation.

- Technical gates **still must pass** before downstream implementation and before declaring the integration candidate complete.
- No claim of Owner visual/functional acceptance for Task 1, Task 2, UI or Task 1.5 is authorized solely by automated tests.
- Continue Task 3 under its **separately approved clinical/result specification and original report template**; this prompt DOES NOT authorize implementing Task 3 or inventing ReadyGen clinical rules.
- After Task 3 technical completion, conduct the **Final Integrated Owner UAT** once, covering Task 1, Task 2, UI/APP_ADMIN, Task 1.5 and Task 3 together.
- Final integrated build must present one unified feature-complete application, one URL, complete navigation and an authorized easy-to-use synthetic administrator test account. Do not treat source/build fingerprints alone as proof that every UI feature was included.
- Production installer, real-HIS, real clinical use and release deployment remain explicitly out of scope pending final Owner acceptance and release validation.
