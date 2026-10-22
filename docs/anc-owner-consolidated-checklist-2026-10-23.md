# ANC Owner consolidated changes — 2026-10-23

Authority: Owner's latest conversation authorizes implementation of all previously locked changes, plus removal of the three overview footnotes. These decisions supersede older conflicting ANC copy, schema requirements and paper-preparation steps. Existing patient identity, signed-document immutability, role authorization, specimen receipt, analytical QC, certification and HIS delivery guards remain.

Worktree: `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`; starting source `44f398b98ee0e0ff7be2dbdce1e2975d0c259d7f`; initial Git tree clean. Persistent local UAT and existing records must be retained. No push, merge, deployment, hospital server or EXE work. OWNER-UAT remains **PENDING** until Owner personally accepts.

Each item stays unchecked until implementation and appropriate tests/browser/artifact evidence pass. OPEN means work is in progress, never PASS. FAIL and BLOCKED must carry a specific reason. Historical LAB tests are separate evidence; affected behavior tests run first, followed by one final full regression because validation/document/gate logic changes in this batch invalidate a UI-only reuse claim.

| ID | Owner-locked delivery item | Status | Evidence |
|---|---|---|---|
| ANC01 | Remove overview heading “เคสอยู่ขั้นตอนไหน” and its all-years/Attention Flags subtitle; preserve stages/counts. | OPEN | Previously implemented; reverify final runtime. |
| ANC02 | Align workflow and Paper Consent badges; preserve their distinct meanings. | OPEN | Previously implemented; reverify final runtime. |
| ANC03 | Preserve LN links, row highlights and top horizontal scrollbar in overview/registry, plus Thai date entry and save Toast. | OPEN | Final source-completeness browser required. |
| ANC04 | Remove “ข้อมูลเดิมจากเคสเดียวกัน” from Request form. | OPEN | Previously implemented; reverify final runtime. |
| ANC05 | Registration helper: “หาก LN และ HN ตรงกับเคสที่มีอยู่ ระบบจะเปิดเคสนั้นให้”. Remove previous long helper. | OPEN | UI copy only; do not change case matching. |
| ANC06 | Registration introduction: “กรอก LN และ HN ตามหลอดเลือดหรือเอกสารให้ครบทุกหลัก โดยพิมพ์ คัดลอกมาวาง หรือสแกนบาร์โค้ดได้”. | OPEN | Preserve scanner/paste/identity behavior. |
| ANC07 | Replace “GA ณ วันเจาะ:” with “อายุครรภ์ (GA) ณ วันเจาะเลือด:”. | OPEN | Calculation unchanged. |
| ANC08 | Request form across all five sections: coherent label/control/help spacing, 20–24px rows, responsive layout; remove oversized label spacer. | OPEN | Desktop/tablet/mobile, keyboard and both themes. |
| ANC09 | Medical history: compact sequential questions, consistent Yes/No controls and warning spacing; preserve all clinical text/answers. | OPEN | Browser and accessibility evidence. |
| ANC10 | Sections 4/5: group sex preference and acknowledgments; align checkbox with first text line; consistent footer actions. | OPEN | Original clinical conditions preserved. |
| ANC11 | Autosave success text “บันทึกข้อมูลสำเร็จ (Auto)” with last successful server date/time, Thai BE and 24-hour clock; no success on failed save. | OPEN | ACK/failure/reload tests; manual save must not be falsely described as Auto. |
| ANC12 | Overview label “ผลตรวจพร้อมให้ ANC ตรวจสอบ” becomes “มีผลตรวจแล้ว”. | OPEN | Count/release predicate unchanged. |
| ANC13 | After completed Consent and authorized return to staff, open that case's details, not the registry; retain session/auth safeguards and terminal recovery. | OPEN | Real signing/return browser and API tests. |
| ANC14 | “ผู้ป่วยไม่ยินยอม” button readable in enabled/disabled/light/dark states; preserve refusal gate/meaning. | OPEN | Contrast and browser checks. |
| ANC15 | Remove paper Request preparation dialog, reference/location/reason entry; paper channel is recorded directly because document accompanies blood. No fictitious Verified review or automatic clinical approval. | OPEN | UI/API/gate/migration tests, existing paper history retained. |
| ANC16 | Remove document-channel-change reason field and mandatory validation; preserve recorded actor/time/change audit and historical reasons. | OPEN | API/UI tests, no migration rewrite. |
| ANC17 | Age calculated automatically from DOB; no manual re-entry; update when relevant dates change. | OPEN | Owner confirmed age at collection date; never substitute current date. |
| ANC18 | Remove SCA preference input, heading and required validation because absent from Owner Request template. Preserve previous stored/signed snapshots and Consent's original SCA explanation. | OPEN | Schema/domain/PDF tests. |
| ANC19 | Consent rendering: remove signature-area placeholder lines on the rendered derivative, align actual signatures, names and dates; preserve original Master/content and immutable signed evidence. | OPEN | Rendered PDF visual/hash/coordinate tests. |
| ANC20 | Combined two-page document after signing includes original signed Consent, matching case/round Request; no unsigned substitution, no re-signing and no fabrication. | OPEN | Real Browser download and PDF page/provenance tests. |
| ANC21 | Replace confusing clinical label with actionable readiness states: missing data, awaiting authorized review, reviewed. Explain exact pending work, retain existing one authorized review and all guards. | OPEN | UI + API readiness reason tests. |
| ANC22 | Redesign readiness panel: status/action together, separate ANC versus receipt facts, compact label/value pairs and collapsible provenance. | OPEN | Both themes/viewports/keyboard. |
| ANC23 | Remove all three overview footnotes shown by Owner. Preserve their underlying counting, release and scope rules. | OPEN | Actual overview browser. |
| ANC24 | Preserve all existing UAT records/artifacts; restart/hash verification; clean complete source snapshot, Web/Worker/Renderer and migration provenance parity. | OPEN | Pre/post data inventory, restart and delivery gate. |
| ANC25 | Run affected tests, actual browser journeys and one final full regression on final behavior source; reconcile PASS/FAIL/SKIP truthfully. Deliver URL, login/start/stop instructions, review cases and limitations. | OPEN | Final source-bound report; OWNER-UAT=PENDING. |

## Impact map

- UI/copy: ANC dashboard, P2 registry/Request/Case workspace/signing and scoped CSS/shared status presentation.
- Logic: P2 request issues (remove only SCA preference requirement), optional channel-change reason, paper marker/document readiness, server-derived readiness display reasons and DOB-derived age.
- PDF: P2 forms/documents, DCC snapshot renderer and ANC overlay; original template files remain unchanged.
- Database: forward-only migration only if existing paper/gate constraints require it; never edit applied migrations or reset records.
- Validation: focused unit/DB/contracts, native PostgreSQL where required, final Browser/axe/PDF evidence, final full suite and runtime provenance.

## Completion evidence

Pending implementation and validation. No item is accepted merely because a label, unit test or build exists. Evidence artifacts will be recorded under `.local/anc-owner-closeout-20261023/` and summarized here before handoff.

## Additional suggestion (not yet approved for implementation)
ANC three-item sidebar may move to a top navigation; Owner requested recommendation only. Keep it outside the approved implementation checklist until decided.
