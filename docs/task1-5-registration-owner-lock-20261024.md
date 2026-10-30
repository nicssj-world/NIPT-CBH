# NIPT-CBH — Task 1.5: Simplified ANC/LAB Registration & HIS PET Autofill
**Owner task schedule (corrected 2026-10-24):** **Task 1 and Task 2 Storage are already in progress in parallel** (Owner-confirmed). **Task 1.5 waits for Task 1 completion/Owner acceptance**, then may begin while the existing Task 2 work continues. Task 1.5 does not delay, restart, or suspend Task 2.
**Registered:** 2026-10-24.
**Status:** PLANNED / OWNER REQUIREMENTS LOCKED / NOT IMPLEMENTED.
**Authorization:** Register and specify the task only. The source handoff expressly prohibits implementation, migrations and runtime changes until a separate Owner start order. Creating this document is not such a start order.

## Authority and precedence
- Owner-supplied `NIPT-CBH_Registration_Workflow_Handoff_2026-10-24.md` (2026-10-24); its Owner-locked requirements are reproduced below.
- Latest explicit Owner instructions supersede older conflicting code or requirements, without inventing new clinical policies.
- Inspect current Development Local UAT source/schema before any eventual implementation. The handoff's historical GitHub `main` review from 2026-10-15 is **not proof of current Local UAT behavior**.
- **Task 2 Storage is already underway in parallel with Task 1**, as explicitly corrected by the Owner. Never stop, reset, restart, or reschedule Task 2 because of Task 1.5. Preserve its existing scope and independent worktree/runtime/test environment.
- **Task 1 is separate and currently underway alongside Task 2:** do not re-open, silently broaden or mark Task 1 accepted; complete its mandatory 56-item Local UAT checklist and Owner review independently. Task 1.5 remains parked until Task 1 has passed its acceptance gate and the Owner authorizes the implementation start.

## Goal
Reduce unnecessary registration inputs for ANC/LAB. Retrieve basic patient/specimen data and ordering department from real HIS PET; create/reuse the existing monthly LN Halos only once when the required HIS receipt evidence has been matched. Allow missing clinical details to be completed in Sample Detail rather than blocking number allocation.

## OWNER LOCK A — LAB registration
1. Operator enters **LN OR HN**. Do not require both identifiers at entry.
2. Search/match real HIS `.pet`; populate confirmed basic fields (LN, HN, patient name, DOB, sex, receipt/collection evidence, Ward), not made-up defaults.
3. When HN resolves to multiple LN or multiple NIPT candidate orders, present a deliberate choice of the correct LN/order; never select ambiguously.
4. Matching `.pet` and the applicable HIS `.ok`/receipt evidence must be valid before allocating the LN Halos. Distinguish **create/open case** from **verified HIS specimen receipt**.
5. Allocate/reuse LN Halos automatically **only once** after verified receipt, following the existing **monthly continuous suffix and monthly reset**. Never reallocate when the same case is reopened or registration retried.
6. GA, EDD/EDC, Singleton/Twins and other missing clinical/request details can be entered or edited later in **Sample Detail**. Do not make them prerequisites for the verified LN Halos receipt trigger.
7. Registration includes a **Paper Consent** choice (and existing Electronic Consent choice/workflow, where appropriate). Paper is only a marker for a physical document arriving with the specimen; **no additional scan, upload, print or new signature step** to set that marker.
8. LAB registration must not ask the operator to choose an **Ordering Department**; it is populated from HIS PET Ward.

## OWNER LOCK B — ANC registration
1. Remove the **Ordering Department** dropdown from ANC Registration. Do not substitute the logged-in user's unit for this field.
2. ANC may register, prepare Request and Consent **before PET exists**; show **รอข้อมูลจาก HIS** until matched PET provides the value.
3. Once PET is securely matched, populate Ordering Department from PET Ward and show it in **Sample Detail**.
4. Retain ANC clinical/request/consent workflow, patient identity requirements and separate user department permission scope.

## OWNER LOCK C — PET Ward identity mapping
- In the existing PET `P[33]` payload formatted `WARD^PATIENT_IDENTITY`, **the part before `^` = `ward` = Ordering Department**; the part after `^` is patient identity, **not** the Ordering Department.
- Preserve approved PET section/test identification, read-only parsing, `.pet/.ok` evidence and patient identity matching.
- `unitId`/the logged-in user's department is an **RBAC/access-scope concept**, not automatically the Ordering Department. Do not remove necessary unit authorization when removing the UI dropdown.
- Timestamp semantics should follow the latest approved PET contract in the working source; cross-check historical handoff notes against the newer `docs/lab-workflow-owner-lock-2026-10-21.md` before changing any timestamp mapping. **Do not silently reinterpret PET fields.**
- Never change PET/RES/OK wire format, historical identities, specimen-round lineage or existing monthly LN Halos allocation.

## User-visible workflow
- **ANC:** register without Ordering Department selector → complete Request/Consent → while PET absent show pending HIS data → matched PET later fills Ordering Department in Sample Detail.
- **LAB:** enter LN OR HN → real PET lookup → choose correct LN only when multiple → display verified HIS data → select Paper/Electronic Consent channel → register/reuse case → allocate existing LN Halos after verified HIS receipt → enable labels → supply GA/EDD/Twins later in Sample Detail.
- Be explicit about what came from HIS and what must still be completed. Do not add a second registration form or approval ceremony.

## Task 1.5 mandatory acceptance checklist
Each item must be marked **PASS / FAIL / BLOCKED / NOT VERIFIED**, with source evidence, executable test evidence, and actual Local UAT UI evidence where relevant. **Do not turn a source-code presence check into a runtime PASS.**

- [ ] **R15-01** LAB accepts LN alone and auto-populates verified HIS data.
- [ ] **R15-02** LAB accepts HN alone and resolves unique eligible LN/order safely.
- [ ] **R15-03** Multiple LN/orders for one HN require explicit correct selection; no silent choice.
- [ ] **R15-04** Nonexistent PET, incomplete OK, identity mismatch and ambiguous PET show accurate, actionable states; do not fabricate receipt or allocate LN Halos.
- [ ] **R15-05** PET parsing and `.ok` pairing use the actual HIS evidence and existing NIPT test/section filters.
- [ ] **R15-06** After valid PET/OK receipt, LN Halos is automatically allocated once, remains monthly-continuous and resets by month only; existing numbers and retries are preserved.
- [ ] **R15-07** Reopening/re-registering a case never creates duplicate case/LN Halos; concurrent attempts and ambiguous identity fail safely.
- [ ] **R15-08** GA, EDD/EDC, Singleton/Twins and additional data are editable later in Sample Detail, without forcing them before receipt/number allocation.
- [ ] **R15-09** LAB Paper Consent is selectable at registration as a marker, with no scan, upload, print or repeat physician/patient signing.
- [ ] **R15-10** Existing Electronic Consent and downstream consent review/gates remain intact; Paper marker does not falsely assert legally/clinically reviewed consent.
- [ ] **R15-11** LAB registration does not show Ordering Department dropdown.
- [ ] **R15-12** ANC registration does not show Ordering Department dropdown; ANC Request/Consent works before PET.
- [ ] **R15-13** ANC pre-PET Ordering Department correctly shows pending HIS data; after valid PET match, Sample Detail displays PET Ward.
- [ ] **R15-14** Ward is from `P[33]` before `^`, identity after it stays separate; missing/malformed Ward isn't replaced with the login unit.
- [ ] **R15-15** RBAC/unit scope, record visibility, HIS identity match, Consent gates, PET/RES/OK wire and specimen lineage remain unchanged where not explicitly updated.
- [ ] **R15-16** UI stays concise and works with keyboard/mobile; no redundant form or unnecessary required fields.
- [ ] **R15-17** Relevant unit, database, native PostgreSQL, integration and permission negative tests pass; report exact counts/skips.
- [ ] **R15-18** Browser E2E against the current authenticated Local UAT verifies ANC/LAB happy and blocked paths with the actual running application.
- [ ] **R15-19** Preserve original data, source Masters, migrations and records; prove restart/persistence and source↔running-image parity after an explicitly approved Local UAT update.
- [ ] **R15-20** Report actual gaps vs latest source, modified files, migration safety, testing evidence, unresolved external acceptance items and Owner UAT result.

## Verification and release gates
1. **PRE-IMPLEMENTATION (current):** identify current Source and Runtime; produce a scoped gap/dependency map only. Do not apply migration, implement or deploy until separately authorized.
2. **IMPLEMENTATION (requires explicit Owner start order):** complete R15-01–20 in Task 1.5 scope; run focused and regression tests. Avoid modifying Task 1 and Task 2 outside proven, necessary dependencies.
3. **READY FOR OWNER TEST:** all locally testable checklist entries PASS, zero unresolved local Task 1.5 defects, rebuilt/verified Local UAT and genuine runtime UI assertions. Synthetic passing tests do not establish hospital acceptance.
4. **TASK 1.5 ACCEPTED:** Owner personally accepts. Any real HIS or clinical safety acceptance still required for deployment remains a separate gate.
5. **TASK 2 STORAGE (already in progress):** proceed independently, without waiting for Task 1 or Task 1.5; do not touch its current worktree/DB/runtime. When Task 1.5 is separately authorized after Task 1 acceptance, Task 1.5 may run in parallel with still-in-progress Task 2 using isolated worktrees, test databases and explicit integration/regression testing before sharing the main Local UAT.

## Strict exclusions
No Storage Box implementation in Task 1.5; no Task 1 backfill/refactor, Genomic-CBH, POCT, Portal, Stock, unrelated ANC changes, novel QC/clinical thresholds, PET wire changes, HIS sends, production migration, real patient exports, Windows installer/Update EXE, commit/push/merge/deploy unless the Owner separately authorizes them.

## Current disposition (2026-10-24)
**TASK 1.5 REGISTERED — NOT STARTED; WAITS FOR TASK 1 ACCEPTANCE.** Owner confirms Task 1 and Task 2 Storage are already being developed in parallel. Task 2 is not blocked by Task 1.5. Once Task 1 is accepted and the Owner issues an explicit start order, Task 1.5 can be implemented alongside the already-running Task 2, in isolated worktrees/DBs. No functional implementation, database change, runtime deployment or release is authorized by this planning document.
