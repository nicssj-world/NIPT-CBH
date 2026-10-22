# ANC Owner consolidated changes — 2026-10-23

Authority: Owner's latest conversation authorizes implementation of all previously locked changes, plus removal of the three overview footnotes. These decisions supersede older conflicting ANC copy, schema requirements and paper-preparation steps. Existing patient identity, signed-document immutability, role authorization, specimen receipt, analytical QC, certification and HIS delivery guards remain.

Worktree: `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`; starting source `44f398b98ee0e0ff7be2dbdce1e2975d0c259d7f`; initial Git tree clean. Persistent local UAT and existing records must be retained. No push, merge, deployment, hospital server or EXE work. OWNER-UAT remains **PENDING** until Owner personally accepts.

Each item stays unchecked until implementation and appropriate tests/browser/artifact evidence pass. OPEN means work is in progress, never PASS. FAIL and BLOCKED must carry a specific reason. Historical LAB tests are separate evidence; affected behavior tests run first, followed by one final full regression because validation/document/gate logic changes in this batch invalidate a UI-only reuse claim.

| ID | Owner-locked delivery item | Status | Evidence |
|---|---|---|---|
| ANC01 | Remove overview heading “เคสอยู่ขั้นตอนไหน” and its all-years/Attention Flags subtitle; preserve stages/counts. | PASS | Actual overview Browser; stage/count behavior retained (browser-write-journey-ea12.json). |
| ANC02 | Align workflow and Paper Consent badges; preserve their distinct meanings. | PASS | Six case captures at1440/768/375 light+dark; badge layout, axe0. |
| ANC03 | Preserve LN links, row highlights and top horizontal scrollbar in overview/registry, plus Thai date entry and save Toast. | PASS | All11 source-completeness features INCLUDED; LN keyboard links/highlights/top rail/Thai dates/Toast Browser PASS. |
| ANC04 | Remove “ข้อมูลเดิมจากเคสเดียวกัน” from Request form. | PASS | Actual Request dialog assertion across six viewport/theme combinations. |
| ANC05 | Registration helper: “หาก LN และ HN ตรงกับเคสที่มีอยู่ ระบบจะเปิดเคสนั้นให้”. Remove previous long helper. | PASS | Real registration/reopen dialog exact copy; same-case identity matching retained. |
| ANC06 | Registration introduction: “กรอก LN และ HN ตามหลอดเลือดหรือเอกสารให้ครบทุกหลัก โดยพิมพ์ คัดลอกมาวาง หรือสแกนบาร์โค้ดได้”. | PASS | Real dialog exact copy and LN Enter scanner navigation to HN. |
| ANC07 | Replace “GA ณ วันเจาะ:” with “อายุครรภ์ (GA) ณ วันเจาะเลือด:”. | PASS | Section2 exact heading asserted in six viewport/theme combinations; formula unchanged. |
| ANC08 | Request form across all five sections: coherent label/control/help spacing, 20–24px rows, responsive layout; remove oversized label spacer. | PASS | All5sections at1440/768/375 light+dark; label/control gap5–16px, no overflow, axe0, keyboard focus return. |
| ANC09 | Medical history: compact sequential questions, consistent Yes/No controls and warning spacing; preserve all clinical text/answers. | PASS | Section3 screenshots in six combinations; original questions preserved, axe0. |
| ANC10 | Sections 4/5: group sex preference and acknowledgments; align checkbox with first text line; consistent footer actions. | PASS | Sections4/5 screenshots in six combinations; first-line checkboxes/footer and keyboard preserved. |
| ANC11 | Autosave success text “บันทึกข้อมูลสำเร็จ (Auto)” with last successful server date/time, Thai BE and 24-hour clock; no success on failed save. | PASS | Real server ACK datetime + Auto label, simulated503 displays failure without timestamp, retry/confirm PASS; DB test preserves Request-save provenance after channel changes. |
| ANC12 | Overview label “ผลตรวจพร้อมให้ ANC ตรวจสอบ” becomes “มีผลตรวจแล้ว”. | PASS | Actual overview exact label assertion; release/count predicate unchanged. |
| ANC13 | After completed Consent and authorized return to staff, open that case's details, not the registry; retain session/auth safeguards and terminal recovery. | PASS | Actual12-clause Browser signing, same-session staff return and exact case URL PASS; bound-return API tests PASS. |
| ANC14 | “ผู้ป่วยไม่ยินยอม” button readable in enabled/disabled/light/dark states; preserve refusal gate/meaning. | PASS | Actual refusal hover contrast/axe0 in both themes and three widths; busy/disabled styling and existing gate retained. |
| ANC15 | Remove paper Request preparation dialog, reference/location/reason entry; paper channel is recorded directly because document accompanies blood. No fictitious Verified review or automatic clinical approval. | PASS | Actual paper channel has no preparation dialog/button; reason-free API and UI PASS; no fake Verified state. |
| ANC16 | Remove document-channel-change reason field and mandatory validation; preserve recorded actor/time/change audit and historical reasons. | PASS | Actual dialog has no reason field; persisted channel changes/reload and event actor/time tests PASS. |
| ANC17 | Age calculated automatically from DOB; no manual re-entry; update when relevant dates change. | PASS | Owner collection-date age37 shown readonly; birthday/missing/future/stale-manual unit tests PASS. |
| ANC18 | Remove SCA preference input, heading and required validation because absent from Owner Request template. Preserve previous stored/signed snapshots and Consent's original SCA explanation. | PASS | No SCA field/heading across six Browser combinations; omitted legacy property/schema and domain tests PASS; original Consent clause retained. |
| ANC19 | Consent rendering: remove signature-area placeholder lines on the rendered derivative, align actual signatures, names and dates; preserve original Master/content and immutable signed evidence. | PASS | Actual Browser downloaded PDF visually inspected; shared signature bounds/mask tests PASS; original template SHA unchanged. |
| ANC20 | Combined two-page document after signing includes original signed Consent, matching case/round Request; no unsigned substitution, no re-signing and no fabrication. | PASS | Actual Browser endpoint:2pages, frozen patient+doctor image operators on Consent; immutable hash/current-scope/negative tests PASS. |
| ANC21 | Replace confusing clinical label with actionable readiness states: missing data, awaiting authorized review, reviewed. Explain exact pending work, retain existing one authorized review and all guards. | PASS | Actual complete-evidence→await-review→authorized review→reviewed Browser; role/negative service tests PASS. |
| ANC22 | Redesign readiness panel: status/action together, separate ANC versus receipt facts, compact label/value pairs and collapsible provenance. | PASS | Six case captures; grouped ANC/receipt facts and collapsible source; keyboard and axe0. |
| ANC23 | Remove all three overview footnotes shown by Owner. Preserve their underlying counting, release and scope rules. | PASS | Actual overview Browser verifies no .anc-footnote; underlying predicates untouched. |
| ANC24 | Preserve all existing UAT records/artifacts; restart/hash verification; clean complete source snapshot, Web/Worker/Renderer and migration provenance parity. | OPEN | Pre/post data inventory, restart and delivery gate. |
| ANC25 | Run affected tests, actual browser journeys and one final full regression on final behavior source; reconcile PASS/FAIL/SKIP truthfully. Deliver URL, login/start/stop instructions, review cases and limitations. | OPEN | Final source-bound report; OWNER-UAT=PENDING. |

## Impact map

- UI/copy: ANC dashboard, P2 registry/Request/Case workspace/signing and scoped CSS/shared status presentation.
- Logic: P2 request issues (remove only SCA preference requirement), optional channel-change reason, paper marker/document readiness, server-derived readiness display reasons and DOB-derived age.
- PDF: P2 forms/documents, DCC snapshot renderer and ANC overlay; original template files remain unchanged.
- Database: forward-only migration only if existing paper/gate constraints require it; never edit applied migrations or reset records.
- Validation: focused unit/DB/contracts, native PostgreSQL where required, final Browser/axe/PDF evidence, final full suite and runtime provenance.

## Completion evidence

ANC01–ANC23 are supported by the actual write/sign/review Browser journey at application revision `ea12d61e633617192e6b92a797abb0b09f64f002`,73 focused tests and all11 runtime feature checks. Evidence root: `.local/anc-owner-closeout-20261023/`. ANC24/25 remain OPEN until final restart, full regression and exact final delivery gate pass. OWNER-UAT remains PENDING.

## Additional suggestion (not yet approved for implementation)
ANC three-item sidebar may move to a top navigation; Owner requested recommendation only. Keep it outside the approved implementation checklist until decided.
