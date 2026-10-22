# NIPT-CBH — Lab Workflow Owner Lock (2026-10-21)
Status: **OWNER-LOCKED REQUIREMENTS; Codex implementation and Development PC Local UAT authorized 2026-10-21. No hospital upgrade EXE or production deployment yet.**
Scope: Development worktree `NIPT-CBH-PARITY-REMEDIATION`; P0 already completed. This document records Owner decisions, **not an implementation-complete statement**. Do not ask the Owner to reconfirm the locked decisions, reinterpret them, or introduce approval steps.

## Latest Owner amendment — Consent signature spacing and date (2026-10-23)
Owner requested more space between the Consent table border and the two signature labels, with balanced columns. Explicit subsequent decision: doctor side shows **“วันที่จัดทำเอกสาร”**, using actual creation time of that prepared Consent revision, not the render/current date, patient signing date or doctor's registry authorization date. Patient side retains actual signing date. This is a rendered derivative only; preserve original Masters, immutable signatures/final payloads and workflow. [Patch evidence](anc-consent-signature-layout-evidence-2026-10-23.md).

Separately locked copy **“ระยะเวลาตั้งแต่รับตัวอย่างเลือดครั้งแรก”** remains wording-only/lock-only; do not apply it as part of this PDF patch. Sidebar/top-navigation remains recommendation-only.

## Latest Owner amendment — consolidated ANC changes (2026-10-23)
Owner explicitly authorized implementing all locked ANC corrections recorded in [the 25-item checklist](anc-owner-consolidated-checklist-2026-10-23.md), including SCA preference removal, direct paper Request channel without a preparation form, optional channel-change reason, DOB-derived age **at collection date** (explicit reply), actionable readiness presentation, same-case signing return, rendered Consent signature-block cleanup and actual signed Consent in the combined document. These override conflicting older UI/requirements only for the listed items. Preserve existing original templates/signed snapshots, patient identity, consent refusal/revocation, one authorized clinical review and all LAB/QC/result/HIS guards. No sidebar-to-top navigation replacement was approved; Owner requested advice only. Owner acceptance stays PENDING.

## Latest Owner decision — Manual Batch 001 / no real go-live cutoff (2026-10-22)
Owner confirms no actual `go_live_cutoff` exists during Local UAT. Never substitute the current day or a test date. `LAB_MANUAL_COMPLETE` must support recording verified paper work, importing actual Final PDFs, identity checks and authorised review without PET, invented QC or a new analytical execution. This is separate from **P5H Historical Case Promotion**, whose real go-live-dependent step alone may remain BLOCKED. Keep independent reviewer authority, original PDF provenance and patient identity safeguards. A P5H promotion test cutoff is allowed only in a fully separate synthetic test database, never Persistent Owner UAT or Production. Continue Urgent/S2, restart, dual export and regression; do not ask again.

## 1. Two distinct LAB registration workflows
1. **LAB_MANUAL_COMPLETE**: Work performed outside this system and actual final NIPT PDF exists. Enter a historical/manual batch and import/link existing PDFs; mark only verified paper-performed tasks as `ดำเนินการแล้ว — Manual`. No fictional QC, no requirement to scan/upload all paper Task Lists, no forced PET or ANC process.
2. **LAB_OPERATIONAL**: Physical sample, request and consent are already at Lab; bypass ANC. Request and consent are **paper markers** only (no scan/upload or re-sign required). Lab registration includes LN, HN, gestational age, EDC input displayed as MM/DD/YYYY, singleton/twins; other demographic data reconciled from HIS PET. Continue all system analytical steps.

## 2. HIS specimen intake (strict, DO NOT ASK AGAIN)
- HIS actual physical specimen receipt generates `.PET` and `.OK`. The application watches the HIS inbound source; on valid NIPT PET + matching existing case **LN and HN** it **automatically** marks round/sample `รับสิ่งส่งตรวจแล้ว`. No second Lab receive/confirmation button or approver. On mismatch show actionable issue and do not falsely mark as received.
- Receipt is an **actual HIS event**, never the time the application scanned/read the file. Never invent a receipt.
- Owner-approved chronological semantics of submitted real `.PET`:
  - Order = `P[21]`.
  - Collection = `P[23]` first component (before `^`).
  - Received = `P[23]` second component (after `^`).
  - Order → Collection → Received, as confirmed by Owner. Do not infer semantic fields merely by sorting timestamps.
  - `O[14]` must be checked independently; it is not an automatic replacement for Owner-approved Order field.
- Preserve full per-round S1/S2 PET provenance including collection/received timestamp with timezone. Resampling requires new PET, same HIS LN, own receipt timestamp, and locked LN Halos suffix/lineage semantics.
- On matched true receipt issue LN Halos using existing automatic database receipt trigger and **monthly continuous suffix**; label printing accessible; eligible attempt enters Lab queue. No manual status shortcut. Preserve existing number allocation; do not renumber historical labels.
- PET field mapping: `P[2]` HIS LN; `P[3]` HN; `P[5]` patient name in LIS convention (surname^^prefix firstname); `P[7]` DOB; `P[8]` sex; `P[33]` ward and identity (may be citizen ID, passport/other, or blank). Do not fabricate missing ID. Store full source securely for authorized export; parsed fields may remain privacy-reduced.
- Check existing `packages/integrations/pet.ts`, `packages/inbound/process.ts`, `packages/inbound/wire.ts`, database guards, worklist sort, redraw logic, tests, and previously received records before implementing timestamp fix.

## 3. Actual Lab steps after Task List
1. Arrange patients and controls into Task List 1–3 with existing 48-position placement rules; PC slot 1, NC slot 25 and BLANK slot 40 by default. Slot 40 may **optionally** be assigned an urgent patient instead of BLANK; do not impose an extra BLANK requirement.
2. Print Task List 1–3 and do Extraction/Library work on paper, annotating measurements. New Owner-supplied `Final New_Task_List_1-3.xlsx` changes **only the template layout/additional input cells**. Preserve fill coordinates/mapping and existing logic; print each Task List Sheet in **exactly two pages**. Keep other three worksheets of combined master/formulae intact; verify runtime master SHA and native print rendering.
3. Transcribe QC measurements: auto-fill physical Sample ID slots 1–48 from the Task List. Provide efficient data entry for 48 Concentrations (ng/µL), plus Standard 1, Standard 2, and Standard 2 Concentration **for each** 1/3, 2/3, 3/3. No QC Measurements paper printing required; do provide native Template Preview.
4. Pooling Table: auto-fill corresponding sample identities and calculate Volume (µL) **from QC measurements using verified Excel Master formulae**, highlight sample+volume **<2 µL**. Print Pooling Table for physical work; user returns to enter QC2 Standard1/2/2Conc and Pool Library concentration (ng/µL). Color Pool Library concentration red if **<3.00 or >3.60**, not at either boundary. Show Pooling DNA Library dilution table for an out-of-range value; operator performs dilution physically and enters measured C1; calculate EB volume and V1 with existing approved formulas.
5. Export `Pooling Sheet Template_R001.csv`: maintain 48 slot row order and original CSV structure. **Only Column A** (Sample ID) and **Column F** (Volume µL) may be modified. For calculated volume **<2 µL**, F=0. **Columns B/C/D/E are immutable**, including their values and positions.
6. Seq Task-G50: operator enters work date/operator, prints worksheet for physical work, then returns to enter recorded values in an accessible UI.
7. Export vendor-style XLSX based on `NIFTY_Test_Request_FormHNZ_filled.xlsx`: **all patient records first; PC then NC last**, matching example, **not** Task List physical slot order. Keep internal one-to-one mapping to original physical position. No invented patient for BLANK.
8. Result import/review/authorization then HIS delivery follows `NIPTY.zip` legacy Workflow after source review; no unsolicited automatic RES/OK release.

## 4. Seq Task-G50 export schema (Owner requirements)
A = base LN Halos without `-1` suffix.
B `HNZ0011`, C `Peripheral Blood`, D `6~35°C`, I `K Tube`, P `Chonburi hospital`: fixed and untouched.
E = PET Collection timestamp; F = PET Received timestamp; both `MM/DD/YYYY HH:MM`.
G = calculated GA as `Weeks,Days` at blood collection date, based on EDC (e.g. `17,6`).
H singleton `Singleton`, twins `Twins`.
J HIS LN; K patient name from validated PET/request, or literal `Positive control` / `Negative Control` for controls.
L = validated patient identity number as available, without substituting hashes or last four digits.
M = DOB `MM/DD/YYYY` Gregorian; N = integer maternal age calculated from DOB (M) at collection; O = HN; R = referring doctor's name; Z = numbered positions 1–48 as Owner stated, subject to comparison with example's control-row formatting (do not invent); AA = EDC `MM/DD/YYYY` from request.
Preserve non-specified columns/format in provided original template, rather than producing an unrelated workbook.

## 5. UI and implementation constraints
- Apply `ux-ui-promax` and `impeccable` to operator-facing Lab pages; make data-entry clear, dense, keyboard-friendly, preview/print readily accessible.
- **No synthetic/demo/simulation language or mock calculations in operational UI**. Do not merely erase warnings while leaving test-only formulas.
- Lab-01..LAB-13 recorded; avoid duplicate task IDs. ANC owner decisions 1–32 were handled separately and must not be silently conflated.
- This is a Development PC worktree. The real server `D:\NIPT-CBH` is on a different machine and is not relevant to developing the changes. **Codex may implement source code and run local tests/build on the Development PC only under LAB-01..13. No deployment, installer/upgrade EXE, real-server changes, or push/merge without a new explicit Owner instruction.**
- Owner specifically instructed not to ask again about already decided requirements. Investigate code and templates first; ask only a genuinely new unresolved factual question if necessary.


## 6. OWNER UPDATE — New QC rules supersede legacy WI/QC holds (2026-10-22)
**Owner explicitly decided: "ผมไม่สนใจกฎเดิม ผมจะเอากฎใหม่เป็นหลัก".** This supersedes legacy WI thresholds and old unresolved-reference flags *where those conflict with the current Owner-approved forms/Master and newest Owner decisions*. Do not insist on legacy WI reapproval as a prerequisite to LAB workflow and Local UAT.
- **QC1:** use the latest Owner Master `QC measurements` note for the QC1 reference comparison: patient, PC and NC library concentration **≥ 2.00 ng/µL**; default BLANK **≤ 0.60 ng/µL**. The **legacy WI-T-BM17/18 3–50 ng/µL rule is NOT the operational QC1 decision threshold**. Do not apply its 3/50 bounds or display old competing criteria as if Owner must choose.
- **QC2/Pooling:** preserve explicitly locked new values: Pool Library concentration **<3.00 or >3.60 ng/µL** highlighted red; exactly 3.00/3.60 not red; sample volume **<2 µL** highlighted and instrument CSV F=0 for those rows; dilution uses the actual Owner Master formula. These are separate from QC1 and must not be conflated.
- **QC3/QC4:** ignore old WI-based thresholds and administrative `UNAPPROVED-OD31` holds **solely due to legacy rules**. Collect actual operator observations and reviewer evidence as specified by the latest `Seq Task-G50` Master and existing valid operational workflow. **No numeric QC3/QC4 PASS/FAIL thresholds were established by this Owner statement**; do not invent them, automatically assert clinical PASS, or remove necessary identity/provenance safeguards. If a specific later result-release decision genuinely requires an absent new rule, document precisely that narrow remaining decision; continue Preview, PDF, browser, local UAT and other independent steps.
- **Gate migration:** inspect and revise any references to obsolete 3–50 threshold, old competing QC1 criteria, `UNAPPROVED-OD31`, and stale UI warning text *only within the relevant LAB workflow*. Distinguish deprecated policy holds from genuine missing measured/reviewed evidence. Do not bypass patient identity, clinical reviewer authority, result release authorization or outbound guard.
- The priority is **newest explicit Owner decision → latest Owner-approved Master/forms + actual formulas → existing code/legacy WI only where not contradictory**. Do not re-open resolved Owner choices. Scope remains LAB-01..LAB-13 and Development Local UAT only; **no EXE upgrade yet**.

## 7. OWNER META-DECISION — Newer instructions override older conflicts automatically (2026-10-22)
- **Owner explicit order:** "ถ้ามีอะไรแบบนี้อีก ให้ยึดอันใหม่ที่สั่งให้ทำ ไม่ต้องหยุดถามอีก". Codex MUST use the **latest explicit Owner-approved rule** when it conflicts with an older WI, Master version, plan, earlier instruction, previous UI/code or administrative HOLD. Do not stop or ask the Owner to re-confirm which rule governs: the newer explicit instruction takes precedence.
- Reconcile the narrow dependent source code, UI, tests and documentation to the new rule, retaining unrelated previously locked rules and preserving patient-identity/clinical evidence/security controls.
- When a value/rule is **not specified by any newer decision or source**, do not invent the missing rule. Flag only its affected clinical decision as blocked while continuing all other feasible checklist items and local UAT.
- This is an enduring **conflict-resolution instruction** for the LAB-01..LAB-13 scope, not authorization for unrelated features, unapproved clinical result release, Production changes or EXE work.


## 8. OWNER UPDATE — Seq Task-G50: ONE export button, TWO XLSX files (2026-10-22)
This latest Owner instruction is fully specified in `docs/lab-seq-dual-export-owner-amendment-2026-10-22.md` (see last **Latest Owner clarification**). **LATEST RULE supersedes the earlier fixed-48-row HALOS output requirement.** File1 NIFTY original except exclude BLANK and rerun/previously sequenced patients, PC/NC last, Column Q Department=`ANC` for all rows. File2 HALOS includes **only samples/controls actually sent to Pooling**; Task List has slots 1–48, but generated data row count equals actual pooled count. D retains the physical slot numbers and gaps (BLANK40 not pooled => ...39,41...; urgent pooled40 => include40), no renumbering. The original source accidentally omitted D13: restore it **if position13 actually pooled**; otherwise omit like any unpooled member. A true LN Halos/control ID, B=`L01`, C=`DNBYYYYMMDD` based on Bangkok click date for all included, E blank. Use current frozen Pooling evidence, no false physical participation, distinct two downloads, no live clinical accept. Follow F07–F09/U09.

## Owner update — NIFTY Column Q Department (2026-10-22)
**File #1 (NIFTY Test Request XLSX) only:** Set Column **Q (Department)** to the exact string **`ANC` on every exported data row**, including patient rows and the trailing Positive Control and Negative Control rows. This overrides whatever Column Q contained in the reference sample; preserve all other agreed fixed fields, row eligibility/exclusions, formatting and untouched columns. **File #2 HALOS Task Import is unchanged.** Update the exporter, backend contract, XLSX readback/byte-cell tests and real browser download assertions. Do not source Column Q from PET, site or UI; it is a fixed Owner value. No questions or new policy.
