# P4 Lab Workflow + Repeat/Redraw — Synthetic Delivery (ส่งมอบเพื่อ Owner ตรวจรับ)

**สถานะ:** P4 Synthetic Build ตาม Implementation Plan v6.2.1 §12 + Owner Lock 3 ฉบับ (2026-10-12) — **ไม่ใช่ AL-4 Clinical/Lab Acceptance**
**Branch:** `feat/p4-lab-workflow-synthetic` → Draft PR ไป `main` (ห้าม Merge จนกว่า Owner ตรวจรับ)
**Base:** `main` = `10a646f80b1d65837985e18a916eb95bcff0b456` (Merge PR #1 P2–P3, CI SUCCESS)
**ข้อมูล:** สมมติทั้งหมด · ไม่มีข้อมูลผู้ป่วยจริง · ไม่มี HIS Live · ไม่มีเครื่องพิมพ์จริง · ไม่มี Production Migration/Deploy

> **สิ่งที่ไม่ได้อ้าง:** AL-4 ยังไม่ผ่าน · เกณฑ์ Clinical Gate (OD-08) และ QC1 (OD-31) ยังไม่รับรอง จึงไม่มีการ “ผ่าน” ทางคลินิกใด ๆ · Field Inventory ของ F2/F3 ยังเป็น SEED ไม่ได้ลงนาม (AT-EXPORT-02 = ยังไม่ยืนยัน) · การพิมพ์ฉลากกับเครื่องพิมพ์จริง **Q-I7 ยัง Pending** · ยังไม่มี UAT/การทดลองใช้ใบงานจริงโดยเจ้าหน้าที่ Lab (AT-EXPORT-05/06)

## 1. Workspace

| รายการ | ค่า |
| --- | --- |
| Worktree | `D:\Claude workspace\NIPT-CBH-P4` (แยกจาก `NIPT-CBH` ของ Codex และ `NIPT-CBH-P3`) |
| ฐานข้อมูล | Container `nipt-p3-synthetic-db` (PostgreSQL 17.11, `127.0.0.1:55443`) — DB ใหม่ `nipt_p4_synthetic_test` (native) และ `nipt_synthetic_p2_browser_p4` (browser) |
| Ports | Web `3400`, Renderer `3401` (`.env.local`/`data/` ของ P4 เอง, gitignored) |

## 2. แหล่งอ้างอิงที่อ่านจริง

- Plan v6.2.1: §0.2–0.4 (LD-01–LD-15), §4.1–4.3, §5.6, §5.9.1, §12.1–§12.26 (เน้น §12.9, §12.11, §12.15, §12.20–§12.22, §12.24, §12.26), §15.3 แถว P4, ภาคผนวก F.1–F.5; `_NIPT_v621_assembly_part1.txt` (เทียบแล้ว ต่างจาก Plan เฉพาะ Owner addendum ใน §12.11)
- `NIPT_CBH_P4_Tube_Label_Print_Owner_Lock_2026-10-12.md`, `NIPT_CBH_P4_Receive_Date_Sorting_Owner_Lock_2026-10-12.md`, `NIPT_CBH_Genomic_CBH_Number_Generation_Parity_2026-10-11.md`
- Genomic-CBH `origin/main` **`44ce3f4d413eb73e203247d43bb7d727f1f54d19`**: `lib/nipt/label-print.ts`, `label-print.test.ts`, `rules.ts`, `rules.test.ts`, `task-sheet-template.ts`, `qc-measurements-template.ts`, `supabase/migrations/202606010001_nipt_v1.sql` (`register_nipt_sample`, `create_nipt_batch`, `autofill/urgent`)
- Workbook `New_Task_List_Edit (2).xlsx` (SHA-256 `a1da953f…7b700907`) อ่านจาก **สำเนา** ใน scratchpad: ข้อความ Cell ของ Task List 1–3 และ QC measurements (Barcode index 1–48, ข้อความ Control ราย TL, Checklist, เกณฑ์ D32–D35)
- WI-T-BM16–21: ใช้ผ่าน Crosswalk ในภาคผนวก D/F และ §12.5/§12.14/§12.17 ของ Plan — **ไม่ได้เปิด PDF ต้นฉบับซ้ำใน Session นี้** ข้อความ WI ที่พิมพ์บนใบงานจึงยังต้องให้ผู้แทน Lab ตรวจ (เป็นส่วนหนึ่งของการลงนาม Field Inventory)
- ไม่มีการแก้ Workbook, WI หรือเอกสารต้นฉบับใด ๆ

## 3. สิ่งที่ส่งมอบ

### A. Lab Worklist (`/lab`)
- คิว: พร้อมเข้าตรวจ · ติด Gate (พร้อมเหตุผลภาษาไทย) · อยู่ใน Batch/กำลังทำ · ต้องตัดสินใจ (QC ไม่ผ่าน/หยุด/Batch ยกเลิก) · รอรับเจาะซ้ำ (S2+) · ไม่มี LN Halos (รับก่อนเปิด P4)
- S1 เข้าคิวเองจาก PET ที่จับคู่แล้ว (`ReceivedInHIS`) — **ไม่มีปุ่มรับ S1 ซ้ำ**; S2+ รับใน NIPT ผ่าน Dialog (ตรวจตัวตน/ฉลาก/สภาพ/วันที่เจาะ)
- แสดง LN (HIS), LN Halos (+D ครรภ์แฝด), Printed Sample ID, รอบ, เวลารับ + แหล่ง, Gate, สถานะพิมพ์ฉลาก, Run/ตำแหน่ง; ค้นหา/กรอง/เลือกหลายรายการ
- ไม่มีการจัด Batch อัตโนมัติเมื่อรับสิ่งส่งตรวจหรือเมื่อเปลี่ยนการเรียง
- Urgent ต้องมีเหตุผล (≥ 8 ตัวอักษร) + Audit; การเลือกแซงลำดับ FIFO ของงานที่พร้อมก่อนต้องระบุเหตุผล (`QUEUE_OVERRIDE`) + Audit

### B. LN Halos + ฉลากหลอด (Owner Lock — สำคัญมาก)
- **ออกเลขเมื่อรับสิ่งส่งตรวจจริงเท่านั้น** ผ่าน DB trigger (SECURITY DEFINER) บน `specimen_round.received_at`: S1 = HIS PET receipt (P3 worker หรือการเชื่อมตอนลงทะเบียน), S2+ = NIPT local receipt; การลงทะเบียน ANC/Lab **ไม่ออกเลข**
- รูปแบบ `YYBYYMMDDNNN` วันที่ Asia/Bangkok, ลำดับ 001–999 ต่อเดือนปฏิทินตามเวลาไทย (เริ่ม 001 เมื่อขึ้นเดือนใหม่), เกิน 999 → หยุดและ Rollback ทั้งการรับ (ไม่วนเลข); Unique + Immutable; Web/Worker role เขียนเลขเองไม่ได้
- Duplicate/Retry: รับซ้ำได้เลขเดิม (`duplicate=true`); Reprint ไม่ออกเลขใหม่; HIS LN คงเดิมไม่ถูกแทน
- รอบที่รับก่อนมี Migration 010 ออกเลขได้เฉพาะผ่าน `RECEIPT_RECOVERY` (เหตุผล + Audit) ด้วย Issuer เดียวกัน
- ฉลาก: HTML **byte-identical กับ `buildTubeLabelsHtml` ของ Genomic-CBH** (ทดสอบเทียบกับ Source legacy ที่ Vendor ไว้ใน `tests/fixtures/genomic-cbh/` ด้วย 300 ชุดสุ่ม) — 60 × 20 มม./ดวง, 2 ช่อง 30 × 20 มม., เส้นประคั่น, `@page { size: 60mm 20mm; margin: 0; }`, Courier New 7pt/6pt/5pt; 1 ตัวอย่าง = 4 ดวง/8 ช่อง `(BASE,BASE)(BASE,BASE)(BASE,BASE-1)(BASE-2,BASE-3)`; บรรทัด 1 LN Halos, บรรทัด 2 `LN: <HIS LN>` (คงเลขศูนย์นำหน้า), บรรทัด 3 ชื่อ (เฉพาะเมื่อเลือก, เฉพาะชื่อจำลองที่ผู้ใช้มีสิทธิ์เห็น); **ไม่มี Barcode/QR**
- Preview ก่อนพิมพ์ใน iframe (Route `/api/p4/label-sheet/[id]` ผูก Session, CSP เข้ม: ไม่มี Script), พิมพ์ทีละตัวอย่าง/หลายตัวอย่าง, Reprint ต้องมีเหตุผล; ทุก Job บันทึกผู้พิมพ์/เวลา/จำนวน/ชนิด/เหตุผล/Hash
- Twin `D`: ใช้ Effective LN Halos แบบ Genomic-CBH เมื่อ Request ที่ยืนยันแล้วระบุครรภ์แฝด; ถ้ายังไม่ยืนยันประเภทครรภ์ → **ไม่พิมพ์** (ป้องกันฉลากผิด)
- Suffix ฉลาก `-1/-2/-3` เป็นการประกอบฉลากเท่านั้น ไม่สร้าง Attempt และไม่ใช่ Printed Sample ID (AT-LABEL-06)

### C. Batch / Task List 1–3 (`/lab/batches`)
- Run label `RunNNN/YYYY` ต่อปีปฏิทินไทย, Batch ร่างได้ครั้งละ 1 (เหมือน Genomic-CBH; นโยบายจริง OD-34), 48 ตำแหน่ง: TL1 1–16 / TL2 17–32 / TL3 33–48, PC 1 / NC 25 / Blank 40 ล็อก, Plate A1–H6, Barcode index = เลขตำแหน่ง
- ข้อเสนอ Slot ตาม **ลำดับที่แสดงบนจอของรายการที่เลือก** ข้ามช่อง Control พร้อม Preview; ย้าย/สลับ/ถอดใน Draft (เหตุผลเมื่อยืนยันแผนแล้ว); Batch ไม่เต็มไม่มี Phantom sample
- Assignment Gate และ Finalize Gate (BG-01–BG-10F) ประเมินใหม่ใน Transaction; Finalize ไม่ผ่านตัวใด → ไม่ Finalize ทั้ง Sheet พร้อมรายการเหตุผล
- Concurrency: Partial unique index (1 Slot ที่ Active ต่อ Attempt, 1 Attempt ต่อ Slot), Optimistic version ของ Batch, ล็อก Attempt/Case
- State ของ Sheet ตาม §12.9: `Draft → PlanChecked → PlacementFinalized → PreWorkIssued → InExecution → ExecutionRecorded → ExecutionVerified → CompletedIssued` (+ `Amended`, `Cancelled`) บังคับด้วย DB trigger
- Plan check = ยืนยันแผนบนจอ **ไม่ใช่หลักฐานการดูด**; Finalize สร้าง **Placement Snapshot ที่แก้ไม่ได้** (Hash) และ Milestone “เริ่มตรวจวิเคราะห์”; Attempt คง `Assigned` จนบันทึกเริ่มปฏิบัติ
- **ห้าม ✓ ล่วงหน้า:** DB ปฏิเสธ Observation ของ F2 ก่อน Sheet `InExecution` และเวลาเหตุการณ์ก่อน Execution anchor (เวลาที่ Server บันทึกการเริ่ม — แก้ไม่ได้)
- Controlled amendment ก่อนเริ่มงาน (ผู้รับรอง): Pre-work เดิม Stop-use, ต้องเรียกคืนสำเนาใช้งานก่อนเริ่มงาน, Snapshot/PDF Revision ใหม่ ของเดิมไม่ถูกแก้; ยกเลิก Batch ก่อนเริ่มงาน (ไม่เคย Finalize → กลับคิว; Finalize แล้ว → `BatchCancelled` ต้อง Repeat)

### D. ใบงาน F1–F3 และ QC1
- F1 = หน้าจอ Batch; F2 Pre-work (ช่องว่างเท่านั้น, ข้อมูลวางแผนแยกจาก “ใช้จริง”) / F2 Completed (เฉพาะค่าที่ Verified พร้อมที่มา เวลาเหตุการณ์ เวลากรอก ผู้กรอก/ผู้ตรวจ; ตำแหน่งที่ไม่ได้ทำแสดง Disposition เป็นข้อความ); F3 QC1 Pre-work/Completed (48 แถว, “ไม่มีใน Batch”/“ยังไม่กำหนดตำแหน่ง”, สรุป ผ่าน/ไม่ผ่าน/ไม่ได้วัด)
- PDF A4 ภาษาไทยจาก Renderer แยก (Chromium, ฟอนต์ฝัง, ปิด Network/JS) จาก Snapshot ที่ Immutable; Issued original เก็บไฟล์ + SHA-256; **พิมพ์ซ้ำ Original = byte เดิม**; สำเนาใช้งาน (เลขสำเนา + Hash ย่อ ของ Original) และสำเนาระบุสถานะเป็น Derivative ที่มี Hash ของตัวเอง; Draft ไม่มีปุ่มพิมพ์
- Paper-to-System: ค่าทุกค่ามี Source (`PAPER_TRANSCRIPTION` อ้างสำเนาใช้งาน / `DIRECT_ENTRY`), เวลาเหตุการณ์แยกจากเวลากรอก, ไม่ได้เขียนเวลา = `NULL` “ไม่ได้บันทึกบนเอกสาร”, Insert-only, แก้ไข = Observation ใหม่ + เหตุผล, ทวนสอบโดยคนที่สองเสมอ (ค่าเริ่มต้นที่เข้มที่สุดระหว่างรอ OD-36), Discrepancy มีชนิด + บันทึก
- Slot disposition (§12.26): `MEASURED`/`NOT_APPLICABLE`/`REQUIRED_PENDING` คำนวณจากข้อมูลจริง; `NOT_PERFORMED`/`EXCLUDED`/`STOPPED` ต้องมีรหัสเหตุผล + ผู้ยืนยัน ≠ ผู้เสนอ; DB ห้าม Disposition ที่ขัดกับค่าที่ Verified แล้ว
- **QC1:** เกณฑ์ WI (3–50 ng/µL) และ Workbook (≥ 2 / Blank ≤ 0.6) บันทึกเป็น Criteria version สถานะ `PROPOSED_UNAPPROVED` (DB ไม่ยอมให้เป็น Approved ใน P4) ระบบแสดงการอ่านค่าเทียบทั้งสองเกณฑ์ **แต่ไม่ตัดสินเอง** — ผู้รับรองตัดสิน Stage QC1 พร้อมเหตุผล ประทับ `UNAPPROVED_OD31` เสมอ; Failed → `QcFailed`, Remeasure/Hold → `QcHold(QC1)`

### E. Repeat / Redraw
- Repeat: เฉพาะ Attempt ที่ `QcFailed`/`Stopped`/`BatchCancelled` ของรอบปัจจุบัน → Repeat Work Order + Attempt ลูก (Lineage, ระดับ, เหตุผล, ผู้สั่ง, เวลา) Attempt แม่ `Superseded`; ไม่สร้าง Specimen ใหม่ ไม่แตะ HIS; 1 คำสั่งที่ Active ต่อรอบ (DB)
- Printed Sample ID: Attempt 1 = `BASE-1` (Normal), Re-Library ครั้งแรก = `BASE-2` ตาม Genomic-CBH; ระดับอื่น/Re-Library ครั้งที่ 2 = **ยังไม่มีรูปแบบที่อนุมัติ (OD-03, AT-IDPAR-09)** → Assignment Gate ไม่ผ่าน ไม่ประดิษฐ์เลข
- Redraw (ผู้รับรอง): รอบเดิม `RedrawRequested`, งานค้าง `Stopped` (ใน Sheet ที่ล็อกแล้ว → เสนอ Disposition `STOPPED` ให้คนที่สองยืนยัน), สร้าง S(n+1) `Expected` ใต้ HIS LN เดิม, ANC เห็น Badge “ต้องเก็บตัวอย่างใหม่ — รอบที่ n”; ไม่มีการเขียน HIS
- S2+ Receipt ใน NIPT: ออก LN Halos ใหม่ของรอบนั้น (ตาม Owner Lock: 1 BASE ต่อการรับที่อนุญาต), ไม่สร้าง HIS order ใหม่, คง Provenance ของรอบเดิม
- ยกเลิกคำสั่ง Redraw ก่อนรับ (§5.12): คืนสถานะรอบเดิม รอบใหม่ `Cancelled`, งานที่ถูกหยุด **ไม่กลับมาทำต่อเอง** → `RESUME_DECISION_REQUIRED`

### F. Receive Date Sorting (Owner Lock เพิ่มเติม 2026-10-12)
- ทะเบียนกลาง: คอลัมน์ “วันที่/เวลารับสิ่งส่งตรวจ” (เวลาไทย, ปี พ.ศ.) ค่าเริ่มต้น **ใหม่→เก่า**; Ready Queue/Task List: ค่าเริ่มต้น **เก่า→ใหม่ (FIFO)**; กดหัวคอลัมน์สลับพร้อมลูกศร (`aria-sort` ในตาราง)
- S1 = `.pet` P[21] (`received_at` ซึ่ง DB บังคับให้เท่ากับ `his_order.his_received_at`); S2+ = เวลารับใน NIPT; Repeat ใช้เวลารับของรอบเดิม; ไม่ใช้เวลาลงทะเบียน/นำเข้าไฟล์/P[23]/O[14]
- ไม่มีเวลารับ = “— / ยังไม่รับ” อยู่ท้ายทั้งสองทิศทาง; เวลาเท่ากันเรียงด้วย HIS LN + ID ที่ไม่เปลี่ยน; ทะเบียนเรียงฝั่ง Server (รองรับ Pagination)
- Urgent ไม่เรียงใหม่ในตาราง (แสดงเป็น Badge) — เป็นการแซงคิวที่มีเหตุผลและ Audit ตอนจัดเข้า Batch

## 4. Migration และสิทธิ์

`db/migrations/010_p4_lab_workflow.sql` (Additive) — รายละเอียดและ Checksum ใน [migrations.md](migrations.md) · สิทธิ์เพิ่มใน `packages/db/roles.sql` (app_rw อ่าน/เขียนตาราง P4 ตามจำเป็น, EXECUTE ได้เฉพาะ `p4_ensure_ln_halos`; worker_rw ไม่มีสิทธิ์ตาราง P4 — ออกเลขผ่าน Trigger เท่านั้น; report_ro อ่านบางตาราง) · Setting `laboratory.pendingGovernanceGate` (Optional, ไม่มีค่า = `HOLD`) ต้อง Maker-checker แบบ CLINICAL

**Policy ของ Gate ที่ยังรอการตัดสิน:** Predicate เป็น 3 ค่า (PASS/FAIL/PENDING) — OD-01 (การยอมรับตัวอย่าง), OD-08 (Clinical Gate), OD-16 (Consent/Request กับรอบเจาะซ้ำ) เป็น PENDING เสมอ ค่าเริ่มต้น `HOLD` จึงจัดเข้า Batch ไม่ได้; `PROCEED_SYNTHETIC_LABELLED` (ต้องผู้เสนอ + ผู้อนุมัติคนละคน) ให้ Synthetic workflow เดินต่อได้โดยบันทึกป้ายใน Snapshot/ใบงาน — FAIL จริงไม่ผ่านทุกกรณี และไม่ใช่การรับรองทางคลินิก

**ข้อบกพร่องที่พบและแก้ระหว่าง Session:** (1) Deadlock ระหว่าง Lock ลำดับเลข (เดิมรายวัน; Migration 082 เปลี่ยนเป็นรายเดือน)กับ Lock ของ Audit chain (พบจาก Native P3 smoke) → Issuer ล็อก Audit chain ก่อนเสมอ; (2) Action ที่อ้าง Row ของตัวเอง (ทวนสอบ/ยืนยัน Disposition/ตัดสิน QC) ถูก Schema ปฏิเสธเพราะมี `expectedVersion` → แก้ที่ Route; (3) Dialog พิมพ์ฉลากหลายรายการเสียรายการหลัง Reload → Snapshot รายการตอนเปิด Dialog; (4) Gate BG-01 ปฏิเสธ Attempt ที่ Finalize ไว้แล้วตอน Re-finalize หลัง Amendment → แยก “เคย Finalize ใน Snapshot” จาก Attempt ใหม่ที่ไม่มี Lineage

## 5. Tests

| ชุด | ผล (เครื่อง Dev, 2026-10-13) |
| --- | --- |
| Typecheck / Lint (0 warning) / Source guard / `npm audit --omit=dev` (high) | ผ่าน / ผ่าน / ผ่าน 272 ไฟล์ / 0 vulnerabilities |
| Vitest ทั้งหมด (Unit + PGlite DB + Contracts + Native PostgreSQL 17) | **1001 passed, 1 skipped** (Legacy differential ต้องมี Parser ภายนอก — เหมือนเดิม) |
| Native concurrency (P2, P2–P3, P3, P4, Worker) | ผ่าน 4 รอบติดบน DB ใหม่ |
| Browser (Playwright, Chromium, P1–P4 รวม axe WCAG 2.2 AA, 375/768/1280/1440) | **48 ผ่าน** บน Browser DB ใหม่ |
| Build (`next build`) | ผ่าน |

Traceability (ไฟล์ทดสอบใหม่): `tests/unit/p4-parity.test.ts` (AT-IDPAR-01/03/04/05/06/08/09), `tests/unit/p4-labels.test.ts` (**AT-LABEL-01–06** + byte-for-byte legacy), `tests/unit/p4-pdf.test.ts` (AT-PREWORK-01/02, AT-EXPORT-01/04 ระดับ Template + Chromium PDF), `tests/unit/p4-receive-sort.test.ts` (AT-SORT-01/02/05), `tests/db/p4-lab.test.ts` (AT-LNH-01–03, AT-LABEL-03–06, AT-IDPAR-02/10/11, AT-TASK-01/03/04/09, AT-BG-STAGE-01–03, AT-PREWORK-01–03, AT-PAPER-LAB-01/02, AT-DOC-HASH-01/02, AT-REV-LAB-01/03, AT-QC-EARLY-01/03, AT-F3-DISPOSITION-01/02, AT-RPT-01, AT-RDW-CANCEL, RBAC), `tests/db/p4-sort.test.ts` (**AT-SORT-03–07** ผ่าน Pipeline `.pet` จริงของ P3), `tests/contracts/p4-native.test.ts` (Concurrency/Role จริง), `tests/e2e/p4-lab.spec.ts` (Journey ฉลาก → Batch → Finalize → Pre-work PDF → ปฏิบัติ → ทวนสอบคนที่สอง, AT-SORT-01/02, RBAC ANC/Auditor, axe)

**Test ที่ปรับ (ไม่มีการลบหรือ Skip):** `tests/db/p4-lab.test.ts` (ของ P4 เอง) เปลี่ยนความคาดหวังจาก “Urgent ขึ้นบนสุด” เป็น “เรียงตามเวลารับ + Badge” ตาม Sorting Owner Lock · Visual baseline 8 ไฟล์ (`foundation`/`p2` registry 375–1440, Windows) สร้างใหม่เพราะ Owner สั่งเพิ่มคอลัมน์เวลารับ + เมนู Lab — ตรวจภาพ Diff แล้วต่างเฉพาะส่วนนี้; CI (Linux) ไม่ใช้ Visual baseline เหมือนเดิม · Foundation test “session-bound PDF” ล้ม 1 ครั้งจาก Timing ของปุ่มเข้าสู่ระบบ (หน้า Login ไม่ได้ถูกแก้) รันซ้ำ 5/5 ผ่าน

## 6. ยังไม่อยู่ใน P4 Synthetic นี้ (บอกตามจริง)

- Controlled Downtime Recovery (§12.25, AT-DOWNTIME-START-01..04) และแบบฟอร์มสำรอง — ยังไม่สร้าง (Q-G4/OD-36)
- การแก้หลักฐานหลังออก Completed (`CorrectionPending`, §12.22) — ระบบปฏิเสธพร้อมแจ้งว่ายังไม่อยู่ใน P4
- Stop รอบงานหลังเริ่มปฏิบัติ/ถอดออกหลังเริ่ม (Excluded) ระดับ Sheet — ทำได้ผ่าน Disposition รายตำแหน่ง แต่ยังไม่มีการยกเลิก Sheet ที่เริ่มแล้ว
- การบันทึก Analysis completion/QC4–QC5/Final QC acceptance (State มีแล้ว ใช้งานจริงใน P4b/P5), F4–F6, Pooling, DNB, Sequencing, HALOS (P4b)
- หน้าจอ ANC “บันทึกการเก็บตัวอย่างรอบใหม่” แบบเฉพาะ (ANC ใช้ Workspace ของ P2 สำหรับรอบปัจจุบันได้ แต่ยังไม่ได้ทดสอบเป็นเส้นทาง P4) และ Withdrawal W1b–W2
- รายงานการรับตัวอย่างเจาะซ้ำรายวัน (§12.6.2 ข้อ 7) — ข้อมูลอยู่ใน `case_event`/Audit แต่ยังไม่มีหน้ารายงาน

## 7. Blocking Decisions ที่ต้องใช้เพื่อจบ P4 (ชุดเดียว)

| # | เรื่อง | สิ่งที่ระบบทำระหว่างรอ |
| --- | --- | --- |
| 1 | **OD-08** เกณฑ์ Clinical Gate (และอำนาจรับรอง) | BG-06 = PENDING; HOLD บล็อกการจัด Batch |
| 2 | **OD-01** การยอมรับตัวอย่าง (A/B/C) + เกณฑ์ WC-07 | BG-02 = PENDING; บันทึกสภาพตอนรับ S2+ แต่ไม่ตัดสิน |
| 3 | **OD-16** Consent/Request ใช้กับรอบเจาะซ้ำได้หรือไม่/ต้องยืนยันอะไร | BG-04/05 ของ S2+ = PENDING |
| 4 | **OD-03** ชื่อระดับ Repeat, Printed Sample ID ของ Re-extraction/Re-Library ครั้งที่ 2+, การแสดงรอบ S2+ (เลขใหม่ต่อรอบตาม Owner Lock — ยืนยันว่าไม่ใช้ `R`), กติกา Twin `D` บนฉลาก/ID | สร้าง ID เฉพาะรูปแบบเดิม; อื่น ๆ บล็อกที่ Assignment Gate; ไม่พิมพ์ฉลากถ้าประเภทครรภ์ไม่ยืนยัน |
| 5 | **OD-31 / WC-03** เกณฑ์ QC1 (WI 3–50 vs Workbook ≥ 2/≤ 0.6) และการตัดสิน Control (IQC) | แสดงทั้งสองเกณฑ์ ไม่ตัดสินอัตโนมัติ; คนตัดสิน + ประทับ UNAPPROVED |
| 6 | **OD-34** จำนวน Batch ร่างพร้อมกัน, Control เมื่อ Batch ไม่ครบ 3 Sheet, ผู้มีสิทธิ์ Amendment/ยกเลิก, รหัสเหตุผล Disposition | ใช้แบบ Genomic-CBH (1 ร่าง), Control ตาม Template ต่อ Sheet ที่ใช้, ผู้รับรองเท่านั้น, รหัสจำลอง |
| 7 | **OD-36** วิธีทวนสอบรายชั้นฟิลด์ (Blind double entry / เทียบกระดาษ / สุ่ม) | คนที่สองทวนสอบทุกค่า (เข้มที่สุด) |
| 8 | **OD-33** Lot หมดอายุ/เวลาความคงตัว: เตือนหรือบล็อก | เตือน (`LOT_EXPIRED_BEFORE_WORK_DATE_OD33`) ไม่บล็อก |
| 9 | **Field Inventory F2/F3** + ข้อความ WI บนใบงาน + รหัสเอกสารควบคุม (Q-G4) | SEED_UNVERIFIED พิมพ์บนทุกหน้า |
| 10 | **Q-I7** เครื่องพิมพ์ฉลาก/กระดาษ/DPI/ตำแหน่งตัด + การใช้ฉลากแต่ละช่องกับหลอด/Aliquot | Layout ตาม Genomic-CBH; ยังไม่ทดสอบกับเครื่องจริง |
| 11 | Workbook strip header “S1–S6” vs Genomic-CBH `RunNNN S1-n/3` | ใช้แบบ Genomic-CBH (Parity) |
| 12 | วันที่ที่ใช้ใน LN Halos เมื่อ PET ถูกประมวลผลหลังเที่ยงคืนของวันรับ | ใช้วันที่ไทย ณ เวลาออกเลข (เหมือน Genomic-CBH ที่ใช้เวลาลงทะเบียน) |

## 8. รันในเครื่อง

```powershell
npm ci; npx tsx tools/init-dev.ts
# ตั้ง DATABASE_URL เป็น DB สังเคราะห์ใหม่ แล้ว
npx tsx tools/prepare-db.ts; npx tsx tools/seed.ts
node --env-file=.env.local --import tsx apps/renderer/main.ts   # Renderer (ใบงาน PDF)
npm run build; npx next start -H 127.0.0.1 -p 3400
```
ผู้ใช้จำลอง: `synthetic.lab` (คิว/Batch/ฉลาก/บันทึก), `synthetic.certifier` (ทวนสอบ/ตัดสิน QC1/Redraw/Amendment), `synthetic.approver` (อนุมัติ Setting), `synthetic.anc`, `synthetic.auditor` — ต้องเปิด Policy `PROCEED_SYNTHETIC_LABELLED` ผ่านหน้า Settings (ผู้รับรองเสนอ, Clinical approver อนุมัติ) ก่อนจึงจะจัด Batch แบบจำลองได้

## 9. Owner Lock เพิ่มเติม 2026-10-14: Monthly LN Halos

- กติกาของ LN Halos `YYBYYMMDDNNN`: วันในรหัสเป็นวันที่ออกเลขตามเวลาไทย (ไม่เปลี่ยน); `NNN` เป็นลำดับต่อเนื่องภายในเดือนปฏิทิน (ไม่รีเซ็ตเมื่อเปลี่ยนวัน), และเริ่ม 001 ทุกวันที่ 1 ของเดือนใหม่
- ตัวอย่างสังเคราะห์: `26B261012010` → `26B261014011` → `26B261031042` → `26B261101001`; หากถึง 999 ในเดือนเดียวกันให้ปฏิเสธการรับที่กำลังออกเลขและ Rollback ไม่วนเลข
- Source authority: Owner 2026-10-14 และ Genomic-CBH monthly numbering migration. Genomic production correction is separate from NIPT-CBH synthetic database; do not import historical patient identifiers into this repository
- Forward migration `082_p4_monthly_ln_halos.sql` replaces the issuer function only, keeps `010` immutable, seeds a new monthly counter from every prior daily allocation including retired numbers, and does not alter existing immutable LN Halos / Printed Sample ID / Snapshot / Issued PDF
- Receipt-only S1/S2+ issuance, concurrency, transaction lock order, duplicate-idempotency, HIS LN retention, label composition and HALOS Sample ID bindings remain unchanged
- Tests include month boundary, 999-per-month rollback, native concurrency and formatted-ID regression; hardware print verification remains an independent task
