# NIPT-CBH — Task 1 + Task 2 + UI Integration & Task 1.5 FINAL PRE-DELIVERY CHECKLIST

**Document:** `docs/TASK1-5-PRE-DELIVERY-CHECKLIST-2026-10-24.md`  
**Date:** 2026-10-24  
**Governing spec:** `NIPT-CBH-Task1_5-FULL-INTEGRATION-MASTER-2026-10-24.md` (470-line Owner-approved implementation prompt; do not replace or abbreviate its requirements)  
**Version:** 1.0 / Owner Gate Draft  
**Use:** Codex MUST run this checklist before delivering its **one technical closeout** for Integrated Baseline + Task 1.5. This is not an instruction to run final Owner UAT.  

## Owner delivery decision (locked)

- Complete Task 1, Task 2, UI corrective/APP_ADMIN and Task 1.5 in **one isolated integration source/runtime** before closing Task 1.5.
- Task 1 and Task 2 technical gates are accepted as preconditions; separate **Owner** acceptance is **deferred**, not waived. Do not block Task 1.5 just because the Owner requested one combined hands-on UAT.
- Task 1.5 verdict may be **`TECHNICALLY READY FOR TASK 3`** or **`NOT READY`**. **Do not use `OWNER ACCEPTED`, `READY FOR OWNER TEST` or `PRODUCTION READY`** at this milestone.
- Task 3 ReadyGen has a different Owner-approved report/template specification; **do not implement Task 3 from this checklist**.
- After Task 3 is finished and technically integrated, deliver **one unified Owner UAT** with one URL and verified working test credentials; no separate Task UAT requests now.
- No Production, hospital real-HIS, installer EXE, push or merge into main under this task.

## How Codex must use the checklist (mandatory)

1. Read the Full Master Prompt and Owner Lock source documents first. Do not rely on this checklist as a substitute for the complete specification.
2. For each ID below, record **`PASS | FAIL | BLOCKED | NOT VERIFIED | N/A`**, exact changed/source file(s), test name/result, source/runtime revision and evidence path. Default = `NOT VERIFIED`.
3. **Do not tick a checkbox until evidence has been captured and read back.** `PASS` needs runtime or DB evidence for behavior claims, not only Typecheck/lint or source inspection.
4. `BLOCKED` must have root cause, dependency and safe next step. `N/A` must explain why the clause is genuinely inapplicable. Neither counts as PASS.
5. Check **Gate A (preflight)** and **Gate B (integrated baseline)** *before* making Task 1.5 code edits. If those gates fail, fix only proven integration defects safely; do not leapfrog preconditions.
6. After Task 1.5 code changes, run **affected and cross-task regression**, not only focused tests. Preserve original task evidence while verifying the new merged runtime.
7. If any locally-testable release-blocking requirement is FAIL/BLOCKED/NOT VERIFIED, use `NOT READY` and explain precisely; do not invent success. Externally-dependent clinical/hospital/real-HIS Owner acceptance stays deferred and is not falsely scored PASS.
8. Record this checklist as an actual Markdown file **inside the isolated Integration Worktree**, then update it based on tests; preserve original worktrees and uncommitted changes. No blanket reset/commit.
9. Attach a single final report, not repeated previews. The Owner requested **no separate Owner UAT** until after Task 3.

## Gate order

| Gate | Must be finished before | Acceptance condition |
|---|---|---|
| A — source preflight | Integration composition | Verified source provenance, backups and worktree separation |
| B — baseline integration | Any Task 1.5 product code edits | Combined Task1+Task2+UI+APP_ADMIN runtime/DB passes preflight |
| C–I — functional & UX | Final regression | Owner-locked Task 1.5 behavior and cross-task compatibility verified |
| J — executable verification | Technical closeout | Authenticated browser, native DB, real artifact readback, restart/parity |
| K + R15 | Technical delivery | All locally testable items evidenced; R15-01..20 closed |

---

## A. Preflight และการป้องกันงานเดิม — ก่อนแก้โค้ด
- [ ] **A01** — ระบุ Project root / actual integration worktree / branch / HEAD / dirty files ของทุก Source ที่จะนำมารวมจาก filesystem จริง
- [ ] **A02** — ยืนยัน Task 1 Technical Acceptance 56/56 และหลักฐาน fingerprint ของ Candidate cf70065d… โดยไม่กล่าวอ้างว่า Owner Accepted
- [ ] **A03** — ยืนยัน Task 2 Storage Technical Acceptance: interaction, label readback, movement history, restart/persistence พร้อม evidence จริง
- [ ] **A04** — ยืนยัน UI Corrective Action ล่าสุด: Before/After แท้จริงของ 3 หน้าที่ Owner เคยปฏิเสธและ APP_ADMIN cross-role tests
- [ ] **A05** — พบ Owner Lock / Registration Handoff และเอกสารอ้างอิงทั้งหมดตาม Master Prompt; บันทึกไฟล์ที่หาไม่เจอหรือข้อขัดแย้ง
- [ ] **A06** — ตรวจ Source SHA, diff, git status และ file ownership ของ Task 1/2/UI/shared checkout เป็นรายชุด
- [ ] **A07** — แยก new Integration Worktree และฐานข้อมูล Synthetic จาก Candidate เดิม; ไม่ Reset/Discard/Overwrite ไฟล์ใด
- [ ] **A08** — ตรวจ Source/DB Migration Ledger, hash, schema และ backup ที่ restore ตรวจได้ก่อนการรวม
- [ ] **A09** — Trace ระบบ ANC/LAB/PET/Consent/LN Halos/Storage จาก Source จริง; ไม่เดาจากสรุปเก่า
- [ ] **A10** — จด conflict map, data migrations และ integration compatibility risks แยกตาม file/owner
- [ ] **A11** — ไม่ใช้ Current Production, preserved Owner UAT DB หรือข้อมูลผู้ป่วยจริงเป็นฐานทดลองทำ destructive tests
- [ ] **A12** — Gate A PASS ก่อนแก้ implementation Task 1.5; ถ้าไม่ผ่านให้คง blocker พร้อมหลักฐาน ห้ามถือว่าอนุญาตแก้แล้ว


## B. Integration Baseline — รวม Task 1 + Task 2 + UI/APP_ADMIN
- [ ] **B01** — รวม Task 1 Source จาก verified Candidate; ไม่เอาแค่ commit ที่ไม่มี untracked requirements
- [ ] **B02** — รวม Task 2 Storage ทั้ง Code, tests, migration 126 และ label/parser ที่เกี่ยวข้องครบ
- [ ] **B03** — รวม UI Corrective Source ล่าสุดทั้ง 3 ส่วน (Connection / Result Import / Runtime Services) ไม่เลือก UI HEAD รุ่นเก่า
- [ ] **B04** — รวม ANC Top Navigation (ANC-only), APP_ADMIN Global Navigation และ LAB Sidebar โดยไม่เกิด Sidebar/Logout ซ้ำ
- [ ] **B05** — ตรวจ manifest ปลายทางว่าฟังก์ชัน Task 1, Task 2, UI, APP_ADMIN อยู่ร่วมกันจริง — ไม่ใช่เพียง Route เปล่า
- [ ] **B06** — Resolve overlapping components, RBAC, SQL, CSS, packages, test changes แบบ semantic ไม่ใช้ ours/theirs ทับทั้งหมด
- [ ] **B07** — แยก source กับ ignored .local secrets, node_modules, .next, uploads; ไม่ bulk-copy build/cache
- [ ] **B08** — migration 123–125 (Task1) และ 126 (Task2) มีความถูกต้อง ตรวจ ledger/backup แล้ว apply ครั้งเดียวเฉพาะ isolated test DB
- [ ] **B09** — เช็กหน้า /lab/batches, QC, Pooling, Sequencing, /sample-storage, /results, ANC, Settings และ deep links ใน merged build
- [ ] **B10** — Sample Storage เห็น Backup/Buffy Coat, grid 9×9, search, autofill, move/replace, labels จริงใน Desktop และ Mobile
- [ ] **B11** — APP_ADMIN เข้าถึง ANC/LAB/Settings ได้จริงทั้ง Page Guards และ Server API; ANC/LAB_STAFF ไม่ได้สิทธิ์เพิ่ม
- [ ] **B12** — เช็ก visual layout 3 หน้าที่แก้แล้วบน integrated runtime เทียบหลักฐาน corrective; ต้องไม่กลับไปใช้ key-value สองฝั่งเดิม
- [ ] **B13** — เช็ก WEB/Worker/Renderer source/build/runtime fingerprints; error/feature flags แสดงจากสถานะจริงไม่ปลอม Health
- [ ] **B14** — ตรวจ Integration Baseline Browser smoke, relevant permissions, restart/data hash, Source/Runtime Parity ผ่านก่อนเริ่ม Task 1.5
- [ ] **B15** — บันทึก integration baseline hash, migration ledger, files/conflicts/decisions และผล preflight โดยไม่ส่ง Owner UAT แยก


## C. PET Schema, provenance และ lookup security
- [ ] **C01** — P[2] = HIS LN; P[3] = HN; ตรวจ parser จริงกับ .pet fixture ที่อนุญาต
- [ ] **C02** — P[5] ชื่อผู้ป่วย, P[7] DOB, P[8] Sex; ไม่มี mapping สลับคอลัมน์
- [ ] **C03** — P[21] order timestamp ไม่ถูกใช้สลับกับเวลาเก็บตัวอย่าง/รับตัวอย่าง
- [ ] **C04** — P[23] ก่อน ^ = collection datetime; หลัง ^ = actual HIS specimen received datetime
- [ ] **C05** — P[33] ก่อน ^ = Ward / Ordering Department; หลัง ^ = patient identity ไม่ถูกใช้แทน Ward
- [ ] **C06** — NIPT Section 7 / Test Code 70096 filter คงเดิมทั้ง positive/negative cases
- [ ] **C07** — ค้น PET และ applicable .ok ตามสัญญา HIS จริง พร้อม file provenance / stored hash checks
- [ ] **C08** — กรณี PET ไม่มี / malformed / mismatch / ambiguous / .ok ยังไม่พร้อม แสดง state/error ที่ชัดเจนและ fail closed
- [ ] **C09** — ค้นด้วย LN อย่างเดียวได้ ข้อมูลคืนต้องตรงตัวอย่างและสิทธิ์
- [ ] **C10** — ค้นด้วย HN อย่างเดียวได้ และเมื่อมีหลาย eligible LN ให้เลือก LN ที่ถูกต้องโดยผู้ใช้
- [ ] **C11** — HN-only lookup ไม่รั่วข้อมูลผู้ป่วย/หน่วยงานที่ไม่มีสิทธิ์ (negative RBAC + data minimization tests)
- [ ] **C12** — พิสูจน์ว่าเวลาอ่านไฟล์/เวลา ingest ไม่ถูกใช้แทน HIS received time; เวลาจริงไม่สร้างขึ้นเอง


## D. LAB Registration — Workflow ที่ Owner ล็อก
- [ ] **D01** — เริ่มลงทะเบียนโดยกรอก LN หรือ HN อย่างใดอย่างหนึ่ง ไม่บังคับกรอกทั้งคู่
- [ ] **D02** — Auto-fill LN/HN/ชื่อ/DOB/Sex/collection/receipt/Ward จาก PET ที่ตรวจแล้วและแสดงความแตกต่างข้อมูลยืนยัน/ข้อมูลภายหลัง
- [ ] **D03** — HN หลาย order ต้องเลือก LN ก่อนลงทะเบียน ไม่มี auto-select แบบเดา
- [ ] **D04** — ก่อน allocate LN Halos ต้องมี valid PET/OK, matching identity และ receipt event ตามข้อกำหนด
- [ ] **D05** — มี LN Halos อยู่แล้วต้อง reuse; retry ไม่มีเลขใหม่หรือสร้าง case/round ซ้ำ
- [ ] **D06** — LN Halos ใหม่เกิดผ่าน receipt-trigger/DB locking เดิม ไม่มี second allocator
- [ ] **D07** — GA, EDD/EDC, Singleton/Twins และ clinical fields ที่ยังไม่มีเลื่อนไปกรอก Sample Detail ได้
- [ ] **D08** — Paper Consent เป็น marker-only เลือกแล้วดำเนินขั้นตอนต่อได้ ไม่บังคับสแกน/Upload/Print/Photo/ลงชื่อใหม่
- [ ] **D09** — Digital Consent เดิมยังใช้ได้ และไม่ถือว่า Paper marker เป็น evidence การเซ็น/การรับรอง
- [ ] **D10** — ไม่มี dropdown หน่วยงานส่งตรวจใน LAB registration; แสดง Ward จาก PET เท่านั้น
- [ ] **D11** — ไม่เพิ่ม LAB receive confirmation, approval, manual LN Halos action, wizard หรือขั้นตอนใหม่
- [ ] **D12** — หลัง receive/เลขครบใช้ Print Label เดิมได้ พร้อม LN และ LN Halos/round suffix ที่ได้รับอนุมัติ
- [ ] **D13** — LAB_OPERATIONAL กับ LAB_MANUAL_COMPLETE / historical manual path ไม่ถูกทำให้ใช้กฎ PET เหมือนกันโดยผิดเจตนา
- [ ] **D14** — Save, cancel, retry, refresh และ open Sample Detail คงข้อมูลที่ถูกต้อง ไม่สร้างรายการซ้ำ
- [ ] **D15** — ผู้ใช้ LAB_STAFF และ APP_ADMIN ทำงานภายใต้สิทธิ์จริงและมี actor audit ที่ถูกต้อง


## E. ANC Registration และ Consent
- [ ] **E01** — ลบ Ordering Department dropdown จาก ANC Form/Registration ที่ได้รับอนุมัติ
- [ ] **E02** — ANC ดำเนิน Request/Consent ได้แม้ยังไม่มี PET ตาม Workflow เดิม
- [ ] **E03** — เมื่อ PET ยังไม่มา แสดงสถานะหน่วยงานส่งตรวจ 'รอข้อมูลจาก HIS' (หรือข้อความที่ตรง Owner Lock) ไม่เดาหน่วยงาน
- [ ] **E04** — เมื่อ PET matched/received แล้ว Ward เปลี่ยนอัตโนมัติและแสดงใน Sample Detail
- [ ] **E05** — ไม่ใช้ unitId/department ของผู้ล็อกอินแทน PET Ward; ยังรักษา unitId เฉพาะสำหรับ RBAC scope
- [ ] **E06** — แพทย์/ทะเบียนแพทย์, consent template, ลายเซ็นผู้ป่วย/แพทย์ และเอกสาร Request เดิมไม่ถูกแก้โดยไม่อนุมัติ
- [ ] **E07** — Paper Consent marker ไม่กระทบความสมบูรณ์ของ physical evidence และไม่ทำให้ approval/clinical status สำเร็จปลอม
- [ ] **E08** — Consent refusal/revocation, review, certification/release guards ยังบังคับใช้ตามต้นฉบับ
- [ ] **E09** — Flow ANC pre-PET → PET arrival → Detail จัดการข้อมูล/สถานะและการ refresh อย่างถูกต้อง
- [ ] **E10** — ANC Role ไม่เห็น LAB/Settings ที่ไม่มีสิทธิ์; APP_ADMIN เปิด ANC ได้ใน Navigation ที่อนุมัติ


## F. LN Halos / specimen round / concurrency
- [ ] **F01** — LN Halos ใช้รูปแบบ Owner-approved เดิม ห้ามแก้เลขฐานหรือ renumber ของเก่า
- [ ] **F02** — เลข 3 หลักท้ายวิ่งต่อข้ามวันในเดือนเดียวกัน และ reset เฉพาะขึ้นเดือนใหม่
- [ ] **F03** — แข่งลงทะเบียนพร้อมกันไม่เกิด duplicate LN Halos; ใช้ DB locking / unique constraint ของเดิม
- [ ] **F04** — Concurrent retry/same PET ไม่เพิ่ม case/round/เลขใหม่ และ audit ยังคง idempotent
- [ ] **F05** — การสร้าง LN Halos มี valid HIS receipt จริง ไม่ใช่เวลาที่ Application อ่าน PET
- [ ] **F06** — LN/HN, LN Halos, round identity และ linkage กับ Task 1/2 คงถูกต้องก่อน/หลัง resampling
- [ ] **F07** — ทดสอบ Re-Library / Re-Extraction / Re-Sampling suffix และ lineage ตาม Owner Lock เดิม รวม early redraw
- [ ] **F08** — การพิมพ์ฉลากและ Export ที่เกี่ยวข้องยังแสดง suffix เดิม ไม่ตัด R เมื่อเกิด R lineage
- [ ] **F09** — ห้ามเปลี่ยน Repeat / No Call และ >4 attempt policy ที่ผ่าน Task 1 แล้ว
- [ ] **F10** — ไม่สร้าง allocation trigger/service ใหม่แข่งกับ approved LN Halos trigger


## G. Cross-Task Functional Regression
- [ ] **G01** — ANC → Request → Consent → PET → LAB ใช้ case identity กลางเดียว ไม่เกิด case ซ้ำ
- [ ] **G02** — LAB receive/registration → ready queue/FIFO/Urgent → Task List 1–3 ได้ตาม gates เดิม
- [ ] **G03** — QC measurement/threshold/UI → Pooling → Sequencing ยังผ่าน Task 1 affected regression
- [ ] **G04** — Task List assignment/urgent/manual add/remove/position move, planned metadata isolation และ T1-31 exports ไม่ regression
- [ ] **G05** — Repeat/Re-Extraction/Re-Library/Re-Sampling รอบและสถานะ รวม No Call ที่เคยผ่านยังไม่เปลี่ยน
- [ ] **G06** — ผล External PDF → Result Review/Certification/Release/RES/OK คง authority และ wire formats
- [ ] **G07** — Sample Storage Backup/Buffy Coat 9×9 และสืบค้น LN/HN/LN Halos/Box ID ใน integrated runtime ได้จริง
- [ ] **G08** — Storage physical sample display/label: Buffy Coat ใช้เลขฐาน, Backup ต่อท้าย -3; ไม่สร้าง Storage -1/-2
- [ ] **G09** — Storage location/move/replace/autofill, capacity/concurrent move, movement audit append-only ไม่เปลี่ยน
- [ ] **G10** — Sample Storage retention 3 calendar years จาก actual HIS P[23] after ^ แยกแต่ละ specimen round; ไม่มี auto-destruction ใหม่
- [ ] **G11** — Legacy storage boxes/positions/audit และ historical/re-sampled storage lookup ยังคงครบและเข้าถึงตามสิทธิ์
- [ ] **G12** — Existing signed PDFs, source documents, audit and release artifacts readback/sha ไม่เปลี่ยนโดยไม่จำเป็น
- [ ] **G13** — UI Remediation 3 corrected areas ไม่ revert: grouped compact label-value, readable alerts, guided import status
- [ ] **G14** — ANC-only top nav, APP_ADMIN global nav, LAB_STAFF sidebar และ logout single control ทำงานครบ
- [ ] **G15** — HIS/PET → analysis → report/HIS outbound negative gates ยังไม่ถูก bypass จาก Integration


## H. Role/Auth/Privacy and clinical safeguards
- [ ] **H01** — APP_ADMIN มี access ANC/LAB/Settings จริงทั้ง UI, authenticated deep links และ server APIs
- [ ] **H02** — LAB_STAFF เข้า LAB ได้และไม่เข้าถึง Settings ที่ห้าม; ANC ไม่ได้สิทธิ์ LAB โดยพลการ
- [ ] **H03** — Permission negative tests ยืนยัน API 403/401 ตามความจริง รวม HN-only search ข้ามสิทธิ์
- [ ] **H04** — Patient PHI ใน errors/logs/browser evidence masked/limited ไม่เปิดเผยโดยไม่จำเป็น
- [ ] **H05** — Clinical reviewer/sign-off identity เป็นตัวตนผู้รับรองจริง; APP_ADMIN ไม่ forge ลายเซ็นหรือข้าม gate
- [ ] **H06** — Login → refresh → deep link → logout → /api/me unauthenticated ผ่านทุก role ที่กระทบ
- [ ] **H07** — Synthetic admin/admin ใช้เฉพาะ isolated synthetic runtime ที่ seed ไว้; ห้าม seed Operational/Production โดยอัตโนมัติ
- [ ] **H08** — ไม่มี hardcoded secrets, PII หรือ plaintext password เพิ่มเข้า Git, report หรือ screenshots


## I. UX/UI Visual Acceptance ใน integrated candidate
- [ ] **I01** — LAB LN/HN input ขั้นต่ำและ PET lookup statuses ชัดเจน; ผู้ใช้ทราบว่าต้องทำอะไรต่อ
- [ ] **I02** — ANC Registration ไม่เพิ่ม input/selector ที่ Owner ตัดออก; Paper marker เข้าใจง่าย
- [ ] **I03** — Ambiguous HN แสดงทางเลือกเฉพาะเคสที่ match หลาย LN; ไม่มี auto-choice เงียบ ๆ
- [ ] **I04** — Sample Detail แยก source-verified HIS data กับข้อมูล clinical ที่กรอกภายหลัง
- [ ] **I05** — Desktop 1440/1280, Tablet 768, Mobile 375: ไม่มี overlap/overflow, Thai wrapping และ touch targets เหมาะสม
- [ ] **I06** — Light/Dark และ Keyboard/Focus/Accessibility ผ่านใน affected pages
- [ ] **I07** — Before/After จาก UI Corrective 3 หน้าอยู่ใน runtime ที่ build จาก integrated source จริง
- [ ] **I08** — Sample Storage ใน Desktop และ Mobile ตรงกับ feature-complete Task 2 ไม่ใช่ตาราง legacy จาก checkout เก่า
- [ ] **I09** — ANC/APP_ADMIN/LAB Navigation และปุ่ม Logout วางตาม Owner Lock ไม่ทำให้ route/menu หาย
- [ ] **I10** — ไม่มี new wizard/dashboard/tab/approval/scan/upload requirement หรือ UI overhaul ที่ไม่อนุมัติ


## J. Verification: Browser, Native DB, Artifact, Health
- [ ] **J01** — Typecheck, lint, build ของ final integrated Task 1.5 source ผ่านจริง
- [ ] **J02** — Unit/contract/native PostgreSQL/permission tests ผ่านพร้อม PASS/FAIL/SKIP ตัวเลขจริง
- [ ] **J03** — Authenticated Browser LAB LN-only, HN-only, HN ambiguous selection, missing PET และ duplicate retry ครบ
- [ ] **J04** — Authenticated Browser ANC pre-PET Request/Consent และหลัง PET Ward Autofill ครบ
- [ ] **J05** — Negative E2E: identity mismatch, ambiguous PET, no OK, wrong access, concurrent registration; fail-closed
- [ ] **J06** — Browser flows LAB Registration → Task 1 & Storage association/deep link ผ่านบน runtime เดียว
- [ ] **J07** — Affected labels/PDF/XLSX สร้างจริง ตรวจ readback, identifiers, suffix และ hash ตามที่เกี่ยวข้อง
- [ ] **J08** — Source ↔ build ↔ Web/Worker/Renderer/runtime fingerprints ตรงกัน ไม่มี feature missing; บันทึก manifest/hash
- [ ] **J09** — ตรวจ migration ledger/schema, application health, worker, renderer, storage services โดยรายงาน external limitation ตามจริง
- [ ] **J10** — Data preservation: case counts/row sets, hash, storage movement, audit, backup before/after/restart ตรง
- [ ] **J11** — ไม่มี destructive test กับ Owner/Production data; Synthetic test data identifiable and isolated
- [ ] **J12** — Browser screenshots/video/trace อ้างอิง final source revision และ build เวอร์ชันเดียวกัน
- [ ] **J13** — ทดสอบ page navigation/responsive/auth บน integrated runtime ไม่ใช้แต่ภาพจาก Task1/Task2/UI แยก
- [ ] **J14** — Checklist R15-01 ถึง R15-20 มี actual tests + evidence refs ไม่ใช้ source-only PASS


## K. Closeout, report, nonfunctional release control
- [ ] **K01** — ทำ Requirement-to-Code-to-Test-to-Evidence matrix ครบ R15-01..R15-20
- [ ] **K02** — ไม่มี Critical/High functional FAIL หรือข้อ Task1.5 ที่ตรวจ locally ได้แต่ยัง NOT VERIFIED
- [ ] **K03** — ทุก BLOCKED แสดง exact blocker, tests tried, mitigation, owners/dependency; ห้ามนับเป็น PASS
- [ ] **K04** — N/A ใช้ได้เฉพาะพิสูจน์ว่าไม่เกี่ยวข้องและมีเหตุผล ไม่ใช่แทนการไม่ทดสอบ
- [ ] **K05** — Git changes/diff ของ Integration+Task1.5 ถูก review; ไม่ปน Task3/Production/Genomic-CBH/other projects
- [ ] **K06** — Preserve Task1/Task2/UI original worktrees; ห้าม reset, discard, bulk overwrite, commit shared dirty checkout, push/merge main
- [ ] **K07** — ไม่ Deploy Production, ไม่สร้าง Setup/Update EXE, ไม่แก้ HIS production หรือ bypass release gates
- [ ] **K08** — รายงาน Source/Runtime hash, branch/commit, migrations, API contracts และ Test evidence ปัจจุบัน
- [ ] **K09** — สร้าง/อัปเดต docs/TASK1-5-FINAL-ACCEPTANCE-2026-10-24.md พร้อมรายงานและ links path ที่มีจริง
- [ ] **K10** — จบ Task1.5 เฉพาะ 'TECHNICALLY READY FOR TASK 3' เมื่อทุก locally testable gate PASS; ไม่ใช้ READY FOR OWNER TEST
- [ ] **K11** — Owner Visual/Clinical/Hospital/Real-HIS Acceptance ยังคง DEFERRED และห้ามอ้างว่าเสร็จ
- [ ] **K12** — ส่ง Final Closeout ฉบับเดียว; ไม่ส่ง Owner ทดสอบหลายพอร์ตก่อน Task3; One Final Integrated Owner UAT หลัง Task3 เท่านั้น


## L. R15-01 ถึง R15-20 — MANDATORY OWNER REQUIREMENT MATRIX

The R15 requirements are independently mandatory. For each, document **source**, **tested scenario (positive/negative)**, **actual result**, **evidence path**. Cross-reference the detailed gate IDs below; a gate link is not a PASS by itself.

| ID | Original Owner requirement | Cross-check gate IDs | Status | Evidence ID/path |
|---|---|---|---|---|
| **R15-01** | LAB LN-only registration/PET autofill | `C01,C07,C09,D01,D02,J03` | NOT VERIFIED | — |
| **R15-02** | LAB HN-only registration | `C10,D01,J03` | NOT VERIFIED | — |
| **R15-03** | Safe HN multiple-LN selection | `C10,D03,I03,J03` | NOT VERIFIED | — |
| **R15-04** | Missing/invalid/ambiguous PET and incomplete OK | `C07,C08,J05` | NOT VERIFIED | — |
| **R15-05** | PET mapping and HIS NIPT filtering | `C01–C07` | NOT VERIFIED | — |
| **R15-06** | Approved monthly LN Halos allocation | `D04,D06,F01–F05` | NOT VERIFIED | — |
| **R15-07** | No duplicates under retry/concurrency | `D05,D14,F03,F04,J05` | NOT VERIFIED | — |
| **R15-08** | Clinical details completed later | `D07,I04` | NOT VERIFIED | — |
| **R15-09** | LAB Paper Consent marker-only | `D08,E07` | NOT VERIFIED | — |
| **R15-10** | Electronic Consent/clinical guards preserved | `D09,E06,E08,H05` | NOT VERIFIED | — |
| **R15-11** | LAB no Ordering Department selector | `D10` | NOT VERIFIED | — |
| **R15-12** | ANC no Ordering Department selector; pre-PET preserved | `E01,E02,E09` | NOT VERIFIED | — |
| **R15-13** | ANC pending Ward state and PET autofill | `E03,E04,J04` | NOT VERIFIED | — |
| **R15-14** | P[33] Ward vs patient identity correct | `C05,E05` | NOT VERIFIED | — |
| **R15-15** | RBAC, HIS, identity, lineage regression | `G01–G15,H01–H08` | NOT VERIFIED | — |
| **R15-16** | Accessible responsive UX | `I01–I10` | NOT VERIFIED | — |
| **R15-17** | Unit/DB/Contract/Permissions/Native PostgreSQL | `J01,J02` | NOT VERIFIED | — |
| **R15-18** | Authenticated Browser E2E integrated runtime | `J03–J06,J13` | NOT VERIFIED | — |
| **R15-19** | Persistence, backup, source/runtime parity | `J08–J12` | NOT VERIFIED | — |
| **R15-20** | Complete implementation/integration evidence and report | `K01–K12` | NOT VERIFIED | — |


## M. EVIDENCE LEDGER (fill before sign-off)

**Evidence folder:** `.local/task1-5-integration/evidence/` (suggested — use actual verified directory). Store non-sensitive screenshots/JSON reports/fixture hashes/log excerpts, not passwords or patient PHI.

Each `133` gate IDs A–K requires its own ledger row. Codex must fill **Status**, **Source/line or migration**, **Test or method**, **Result / quantitative evidence**, and **Reference**. A single stable report may be referenced by several gates if it proves each one specifically.

| Gate ID | Status | Source/file/migration | Test/observed result | Evidence path + hash/ref | Blocker/N/A rationale |
|---|---|---|---|---|---|
| A01 | NOT VERIFIED | — | — | — | — |
| A02 | NOT VERIFIED | — | — | — | — |
| A03 | NOT VERIFIED | — | — | — | — |
| A04 | NOT VERIFIED | — | — | — | — |
| A05 | NOT VERIFIED | — | — | — | — |
| A06 | NOT VERIFIED | — | — | — | — |
| A07 | NOT VERIFIED | — | — | — | — |
| A08 | NOT VERIFIED | — | — | — | — |
| A09 | NOT VERIFIED | — | — | — | — |
| A10 | NOT VERIFIED | — | — | — | — |
| A11 | NOT VERIFIED | — | — | — | — |
| A12 | NOT VERIFIED | — | — | — | — |
| B01 | NOT VERIFIED | — | — | — | — |
| B02 | NOT VERIFIED | — | — | — | — |
| B03 | NOT VERIFIED | — | — | — | — |
| B04 | NOT VERIFIED | — | — | — | — |
| B05 | NOT VERIFIED | — | — | — | — |
| B06 | NOT VERIFIED | — | — | — | — |
| B07 | NOT VERIFIED | — | — | — | — |
| B08 | NOT VERIFIED | — | — | — | — |
| B09 | NOT VERIFIED | — | — | — | — |
| B10 | NOT VERIFIED | — | — | — | — |
| B11 | NOT VERIFIED | — | — | — | — |
| B12 | NOT VERIFIED | — | — | — | — |
| B13 | NOT VERIFIED | — | — | — | — |
| B14 | NOT VERIFIED | — | — | — | — |
| B15 | NOT VERIFIED | — | — | — | — |
| C01 | NOT VERIFIED | — | — | — | — |
| C02 | NOT VERIFIED | — | — | — | — |
| C03 | NOT VERIFIED | — | — | — | — |
| C04 | NOT VERIFIED | — | — | — | — |
| C05 | NOT VERIFIED | — | — | — | — |
| C06 | NOT VERIFIED | — | — | — | — |
| C07 | NOT VERIFIED | — | — | — | — |
| C08 | NOT VERIFIED | — | — | — | — |
| C09 | NOT VERIFIED | — | — | — | — |
| C10 | NOT VERIFIED | — | — | — | — |
| C11 | NOT VERIFIED | — | — | — | — |
| C12 | NOT VERIFIED | — | — | — | — |
| D01 | NOT VERIFIED | — | — | — | — |
| D02 | NOT VERIFIED | — | — | — | — |
| D03 | NOT VERIFIED | — | — | — | — |
| D04 | NOT VERIFIED | — | — | — | — |
| D05 | NOT VERIFIED | — | — | — | — |
| D06 | NOT VERIFIED | — | — | — | — |
| D07 | NOT VERIFIED | — | — | — | — |
| D08 | NOT VERIFIED | — | — | — | — |
| D09 | NOT VERIFIED | — | — | — | — |
| D10 | NOT VERIFIED | — | — | — | — |
| D11 | NOT VERIFIED | — | — | — | — |
| D12 | NOT VERIFIED | — | — | — | — |
| D13 | NOT VERIFIED | — | — | — | — |
| D14 | NOT VERIFIED | — | — | — | — |
| D15 | NOT VERIFIED | — | — | — | — |
| E01 | NOT VERIFIED | — | — | — | — |
| E02 | NOT VERIFIED | — | — | — | — |
| E03 | NOT VERIFIED | — | — | — | — |
| E04 | NOT VERIFIED | — | — | — | — |
| E05 | NOT VERIFIED | — | — | — | — |
| E06 | NOT VERIFIED | — | — | — | — |
| E07 | NOT VERIFIED | — | — | — | — |
| E08 | NOT VERIFIED | — | — | — | — |
| E09 | NOT VERIFIED | — | — | — | — |
| E10 | NOT VERIFIED | — | — | — | — |
| F01 | NOT VERIFIED | — | — | — | — |
| F02 | NOT VERIFIED | — | — | — | — |
| F03 | NOT VERIFIED | — | — | — | — |
| F04 | NOT VERIFIED | — | — | — | — |
| F05 | NOT VERIFIED | — | — | — | — |
| F06 | NOT VERIFIED | — | — | — | — |
| F07 | NOT VERIFIED | — | — | — | — |
| F08 | NOT VERIFIED | — | — | — | — |
| F09 | NOT VERIFIED | — | — | — | — |
| F10 | NOT VERIFIED | — | — | — | — |
| G01 | NOT VERIFIED | — | — | — | — |
| G02 | NOT VERIFIED | — | — | — | — |
| G03 | NOT VERIFIED | — | — | — | — |
| G04 | NOT VERIFIED | — | — | — | — |
| G05 | NOT VERIFIED | — | — | — | — |
| G06 | NOT VERIFIED | — | — | — | — |
| G07 | NOT VERIFIED | — | — | — | — |
| G08 | NOT VERIFIED | — | — | — | — |
| G09 | NOT VERIFIED | — | — | — | — |
| G10 | NOT VERIFIED | — | — | — | — |
| G11 | NOT VERIFIED | — | — | — | — |
| G12 | NOT VERIFIED | — | — | — | — |
| G13 | NOT VERIFIED | — | — | — | — |
| G14 | NOT VERIFIED | — | — | — | — |
| G15 | NOT VERIFIED | — | — | — | — |
| H01 | NOT VERIFIED | — | — | — | — |
| H02 | NOT VERIFIED | — | — | — | — |
| H03 | NOT VERIFIED | — | — | — | — |
| H04 | NOT VERIFIED | — | — | — | — |
| H05 | NOT VERIFIED | — | — | — | — |
| H06 | NOT VERIFIED | — | — | — | — |
| H07 | NOT VERIFIED | — | — | — | — |
| H08 | NOT VERIFIED | — | — | — | — |
| I01 | NOT VERIFIED | — | — | — | — |
| I02 | NOT VERIFIED | — | — | — | — |
| I03 | NOT VERIFIED | — | — | — | — |
| I04 | NOT VERIFIED | — | — | — | — |
| I05 | NOT VERIFIED | — | — | — | — |
| I06 | NOT VERIFIED | — | — | — | — |
| I07 | NOT VERIFIED | — | — | — | — |
| I08 | NOT VERIFIED | — | — | — | — |
| I09 | NOT VERIFIED | — | — | — | — |
| I10 | NOT VERIFIED | — | — | — | — |
| J01 | NOT VERIFIED | — | — | — | — |
| J02 | NOT VERIFIED | — | — | — | — |
| J03 | NOT VERIFIED | — | — | — | — |
| J04 | NOT VERIFIED | — | — | — | — |
| J05 | NOT VERIFIED | — | — | — | — |
| J06 | NOT VERIFIED | — | — | — | — |
| J07 | NOT VERIFIED | — | — | — | — |
| J08 | NOT VERIFIED | — | — | — | — |
| J09 | NOT VERIFIED | — | — | — | — |
| J10 | NOT VERIFIED | — | — | — | — |
| J11 | NOT VERIFIED | — | — | — | — |
| J12 | NOT VERIFIED | — | — | — | — |
| J13 | NOT VERIFIED | — | — | — | — |
| J14 | NOT VERIFIED | — | — | — | — |
| K01 | NOT VERIFIED | — | — | — | — |
| K02 | NOT VERIFIED | — | — | — | — |
| K03 | NOT VERIFIED | — | — | — | — |
| K04 | NOT VERIFIED | — | — | — | — |
| K05 | NOT VERIFIED | — | — | — | — |
| K06 | NOT VERIFIED | — | — | — | — |
| K07 | NOT VERIFIED | — | — | — | — |
| K08 | NOT VERIFIED | — | — | — | — |
| K09 | NOT VERIFIED | — | — | — | — |
| K10 | NOT VERIFIED | — | — | — | — |
| K11 | NOT VERIFIED | — | — | — | — |
| K12 | NOT VERIFIED | — | — | — | — |


## N. FINAL CLOSEOUT SELF-AUDIT — Fill these values from evidence

| Required report field | Verified value |
|---|---|
| Integration worktree / branch | — |
| Task 1 source commit + fingerprint | — |
| Task 2 source path/hash + migration 126 | — |
| UI corrective + APP_ADMIN source path/hash | — |
| Task 1.5 changed files/diff scope | — |
| Integrated source/build/runtime fingerprint(s) | — |
| Migration ledger 123, 124, 125, 126, + any new approved migrations | — |
| Baseline integrity before/after; backups, counts, SHA | — |
| Native Postgres tests PASS/FAIL/SKIP | — |
| Contracts/unit/permission PASS/FAIL/SKIP | — |
| Authenticated browser E2E PASS/FAIL/SKIP | — |
| Cross-task regressions PASS/FAIL/SKIP | — |
| PDF/XLSX/label readback hash outcomes | — |
| Responsive/light/dark/accessibility evidence | — |
| Integrated internal synthetic URL, status and authenticated role access | — |
| A–K checkpoints PASS / FAIL / BLOCKED / NOT VERIFIED / N/A | — |
| R15-01–20 PASS / FAIL / BLOCKED / NOT VERIFIED / N/A | — |
| External limitations held for final Owner UAT | — |
| Source-level or live operational side effects | Must be **NONE**, with proof |
| Verdict | `NOT READY` until all applicable local gates PASS |

### Final decision algorithm

**`TECHNICALLY READY FOR TASK 3`** only if all conditions hold:

- [ ] Integration Gate A and B PASS using **one frozen integrated source/runtime**.
- [ ] Every locally testable A–K and R15-01..20 acceptance item is **PASS** with traceable evidence, or is explicitly and legitimately deferred as *external* final Owner/real-HIS/clinical acceptance that is not testable locally and does not conceal a product defect.
- [ ] All product and security FAIL = **0**; required locally testable BLOCKED/NOT VERIFIED = **0**.
- [ ] Native PostgreSQL, authenticated Browser E2E, key negative tests, migration, data retention/persistence, source/runtime parity and affected cross-task tests PASS.
- [ ] Integrated UI visibly contains actual **Task 1 + Task 2 + UI corrective + APP_ADMIN + Task 1.5** (not only individual candidate screenshots).
- [ ] Source, result files, hashes, runtime images and evidence correspond to the **same final build**.
- [ ] No unapproved change to Task 1/2 rules, clinical guards, master files, HIS wire formats or operational/Production systems.
- [ ] `docs/TASK1-5-FINAL-ACCEPTANCE-2026-10-24.md` is generated and complete, with this finalized checklist linked.
- [ ] Final owner-facing message reports **technical** readiness for Task 3 and that **one Owner UAT follows only after Task 3**.

If any locally executable gate is missing or broken, verdict **`NOT READY`**. Never silently waive it, even if an older individual Candidate previously passed.

### Instructions to carry forward into Task 3 handoff

Task 3 may consume only this technically verified, integrated baseline and its frozen hashes. ReadyGen clinical interpretation, result PDF template, review/approval/release, and HIS outbound rules remain subject to their separately approved Task 3 Specification. Do not introduce Task 3 implementation into Task 1.5 work.
