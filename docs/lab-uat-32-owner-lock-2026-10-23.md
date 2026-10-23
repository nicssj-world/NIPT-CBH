# NIPT-CBH — LAB OWNER UAT REMEDIATION
## IMPLEMENT ALL 32 LOCKED REQUIREMENTS + UX/UI REVIEW

**Project:** NIPT-CBH  
**Workspace:** `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`  
**Target:** Existing Local UAT Runtime  
**Scope:** LAB-UAT-001 through LAB-UAT-032  
**Priority:** Correctness → Workflow → Data Safety → UX/UI → Visual Consistency

---

# 1. YOUR MISSION

คุณได้รับมอบหมายให้ดำเนินการปรับปรุงระบบ NIPT-CBH ตามรายการ **LAB Owner UAT Fix Checklist จำนวน 32 รายการที่ Owner อนุมัติและล็อกแล้ว**

ต้องดำเนินการครบทุกข้อ ตั้งแต่ตรวจสอบ Source Code, ออกแบบแนวทางแก้ไข, Implementation, Regression Testing, Browser Testing และยืนยันผลใน Local UAT Runtime

**งานนี้ไม่ใช่แค่ Code Review และไม่ใช่แค่การสร้างแผนงาน ต้อง Implement และทดสอบให้ครบจริง**

ใช้ Skills:
- `ux-ui-pro-max`
- `impeccable`

ให้ค้นหาและอ่านคำแนะนำของทั้งสอง Skill ที่มีอยู่จริงในสภาพแวดล้อม Agent ก่อนเริ่มงาน ใช้ในการประเมิน Information Architecture, Visual Hierarchy, Spacing, Forms, Tables, Modals, Responsive Behavior, Accessibility และ User Workflow

หากไม่พบ Skill ใด ต้องรายงานตรง ๆ ว่าไม่พบ ห้ามอ้างว่าใช้ Skill แล้วโดยไม่มีหลักฐาน และห้ามติดตั้งเครื่องมือใหม่โดยพลการ

---

# 2. ABSOLUTE OWNER RULES — NON-NEGOTIABLE

## 2.1 ห้ามคิดเอง ห้ามทำนอก Scope

**DO NOT INVENT. DO NOT EXPAND SCOPE. DO NOT CHANGE UNAPPROVED WORKFLOWS.**

ข้อห้ามเด็ดขาด:

1. ห้ามเพิ่ม Feature ที่ Owner ไม่ได้สั่ง
2. ห้ามเปลี่ยน Business Logic โดยอาศัยความคิดเห็นของ Agent เอง
3. ห้ามเปลี่ยนเกณฑ์ QC, สูตรคำนวณ, Clinical Decision หรือค่าของ Master Template เอง
4. ห้ามเพิ่มขั้นตอน Approval, Signature, Evidence หรือ Reason ที่ Owner ไม่ได้กำหนด
5. ห้ามเปลี่ยน LN Halos, HIS LN, Sample ID, Suffix, Sample Lineage หรือกฎการเรียงคิว
6. ห้ามเปลี่ยน HIS/LIS, PET/RES/OK, Outbound และ Result Release นอกขอบเขตที่ได้รับอนุมัติ
7. ห้ามแก้ไขไฟล์ Master Workbook, สูตร Excel หรือ PDF ต้นฉบับโดยไม่จำเป็น
8. ห้ามลบหรือ Reset ข้อมูล UAT ที่มีอยู่
9. ห้ามเปลี่ยน Environment, Docker Project, Volume หรือ Database Target โดยเดาเอง
10. ห้ามสร้างข้อมูลทดลองทับข้อมูลเดิมหรือใช้ข้อมูลตัวอย่างเป็นข้อมูลจริง
11. ห้าม Refactor ส่วนที่ไม่เกี่ยวข้องเพียงเพราะเห็นว่าสามารถเขียนให้ดีขึ้น
12. ห้ามถือว่าการซ่อนปุ่มเท่ากับการแก้ Permission ที่ Backend
13. ห้ามแก้ปัญหาด้วยการปิด Validation หรือ Security Check โดยไม่ตรวจผลกระทบ
14. ห้ามติดตั้งบน Hospital Production Server หรือสร้าง Upgrade EXE โดยไม่ได้รับคำสั่งเพิ่มเติม
15. ห้าม Push, Merge หรือ Deploy ไปยัง Production โดยพลการ

**Scope Enforcement:** ทุก Code Change ต้องเชื่อมโยงกับ LAB-UAT ID อย่างน้อยหนึ่งข้อได้อย่างชัดเจน

ถ้าพบปัญหาใหม่ที่อยู่นอก Checklist ให้บันทึกเป็น `OUT_OF_SCOPE_FINDING` พร้อมข้อเสนอแนะ แต่ห้าม Implement โดยไม่ได้รับอนุมัติ

หากข้อกำหนดขัดแย้งหรือไม่สามารถยืนยันได้ ให้หยุดเฉพาะส่วนที่ได้รับผลกระทบ ระบุ Blocker และดำเนินการข้ออื่นที่ปลอดภัยต่อไป ห้ามเลือกคำตอบหรือสร้าง Clinical Rule เอง

## 2.2 Preserve Existing Data

ข้อมูล UAT, Database, PDF, Signature, Excel, Audit History และไฟล์เดิมทั้งหมดต้องคงอยู่

ก่อนเริ่มแก้ไข:
- ตรวจ Git status, HEAD, Branch และ Uncommitted Changes
- ตรวจ Local Runtime ที่กำลังทำงานจริง
- ตรวจ Source-to-Runtime Parity
- ตรวจ Database/Volume ที่ Runtime อ้างอิง
- บันทึก Baseline และตรวจสอบ Backup/Restore Capability ที่มีอยู่
- ตรวจ Inventories และ Hash ของข้อมูลสำคัญ

ห้ามใช้คำสั่ง Reset, Prune, Drop, Truncate หรือ Recreate Database กับข้อมูล UAT เดิม

## 2.3 No False Completion

ห้ามใช้คำว่า `DONE`, `PASS`, `READY` หรือ `COMPLETE` กับรายการใดจนกว่าจะมีหลักฐานว่าทำงานจริง

การผ่าน TypeScript, Lint หรือ Unit Tests ไม่เพียงพอสำหรับงาน UI/Workflow

**ต้องทดสอบผ่าน Browser และ Local UAT Runtime จริงด้วย**

---

# 3. LOCKED OWNER CHECKLIST — ALL 32 ITEMS

ให้ดำเนินการตามรายการต่อไปนี้ครบทุกข้อ

## LAB HOME / ROLE / INITIAL SETUP

**LAB-UAT-001 — LAB Home Cleanup**
- ลบ Section “เตรียมเอกสารและติดตามรอบปัจจุบัน” ทั้งกล่อง
- ลบข้อความและ Link ภายในกล่อง
- ปรับ Layout ไม่ให้เหลือช่องว่างผิดปกติ

**LAB-UAT-002 — Settings Permission**
- `LAB_STAFF` และพยาบาลไม่เห็นเมนูตั้งค่าระบบ
- Admin เท่านั้นที่จัดการตั้งค่าระบบได้
- ตรวจ Permission ทั้ง UI, Direct URL และ API

**LAB-UAT-003 — Sample Storage**
- เพิ่ม Sample Storage Module โดยใช้ Genomic-CBH เป็น Reference
- ค้นหาตัวอย่างแบบ Real-time
- ค้นหา LN/HN/LN Halos ตามสิทธิ์ที่เหมาะสม
- แสดง Box Number และ Slot Position ที่แน่นอน
- รองรับจำนวนตัวอย่างที่เพิ่มขึ้นในระยะยาว
- มี Print Box Label และ Reprint
- Box ID ที่พิมพ์ต้องตรงกับข้อมูลค้นหา
- ห้ามเปลี่ยน Sample Tube Label เดิมของ NIPT-CBH
- ห้ามนำ Retention/Destruction Policy จาก Genomic-CBH มาใช้โดยอัตโนมัติ

**LAB-UAT-004 — Historical Import Text Cleanup**
- ลบ “ชุดละประมาณ 47 เคส”
- ลบกล่องข้อความ Manual PDF / P5H Promotion ตามภาพ UAT
- ปรับ Spacing หลังลบ
- ไม่เปลี่ยน File Limit หรือ Import Logic โดยอาศัยการลบข้อความ

**LAB-UAT-005 — Historical Import Excel Template**
- เปลี่ยน Download Template หลักเป็น `.xlsx`
- Sheet 1: ข้อมูลสำหรับ Import
- Sheet 2: คำอธิบาย Column, Required, Format, Example และ Remark
- ใช้ Column และ Validation Rules ที่มีอยู่จริง
- Sheet คำอธิบายห้ามถูก Import เป็นข้อมูลผู้ป่วย
- คงความสามารถอัปโหลด Excel/CSV ตามเดิม

**LAB-UAT-006 — Historical Import Button Spacing**
- เว้นระยะปุ่ม Upload และ Download ประมาณ 12px
- เว้นระยะจากข้อความอธิบาย 12–16px
- รองรับ Responsive

**LAB-UAT-007 — Hide P5H Status Box**
- ซ่อนกล่อง P5H Promotion / Anchor / Go-live Cutoff จากหน้าปฏิบัติงาน Historical Import
- ไม่ทำให้ Manual Import ถูก Block ด้วยข้อความทางเทคนิคที่ไม่เกี่ยวข้อง
- คง Backend Protection ของ P5H Promotion
- ห้ามเปิด Promotion อัตโนมัติ

**LAB-UAT-008 — Single-Operator Historical Manual Import**
- `LAB_STAFF` นำเข้าข้อมูลย้อนหลัง ตรวจสอบ และบันทึกให้เสร็จคนเดียวได้
- ไม่ต้องใช้ผู้รับรองคนที่สอง
- ไม่ต้องมี `HISTORICAL_ENTRY` แยกรายบุคคล
- ใช้สถานะบันทึกเสร็จสิ้น แยกจาก Clinical Certification
- เก็บผู้ดำเนินการและวันเวลาตามจริง
- ไม่สร้าง PET, QC, HIS ACK หรือการรับรองทางคลินิกย้อนหลัง
- Manual Completed ต้องแยกจาก P5H Promotion

**LAB-UAT-009 — Simplified User Roles**
- Role หลักที่ใช้จัดการผ่าน UI มี 3 กลุ่ม:
  - `ANC_NURSE`
  - `LAB_STAFF`
  - `APP_ADMIN`
- ลดความซับซ้อนในการจัดการสิทธิ์
- ตรวจผลกระทบของ Role ภายในเดิมก่อนเปลี่ยน
- ห้ามลบ Safety/Clinical Authorization Gate โดยพลการ
- ห้ามทำให้ LAB_STAFF ได้สิทธิ์อนุมัติผลทางคลินิกเพราะการรวม Role

**LAB-UAT-010 — Initial Production Admin**
- ออกแบบและ Implement กลไก Provision Admin คนแรกสำหรับการติดตั้งใหม่อย่างปลอดภัย
- ห้ามใช้ Synthetic Admin หรือ Default Password ใน Production
- ไม่สร้าง Admin ซ้ำเมื่อ Restart/Upgrade
- ต้องทดสอบ First Install, Login, Role Management และการกู้คืนการเข้าถึงบน Environment ทดสอบ
- ห้ามติดตั้งหรือสร้างบัญชีบน Hospital Server จริงในงานรอบนี้

## HISTORICAL IMPORT — CORRECTNESS / UX

**LAB-UAT-011 — PDF Identity Safety**
- ตรวจ LN/HN/Identity ของ PDF กับตารางนำเข้า
- หากมีข้อมูลสำคัญขัดแย้ง ต้อง Block เฉพาะแถวนั้นและให้แก้ไขก่อนบันทึก
- ห้ามจับคู่ผลผิดผู้ป่วย
- ตรวจพฤติกรรมเมื่อ Parser อ่าน PDF ไม่ครบ โดยไม่เดาข้อมูลที่อ่านไม่ได้

**LAB-UAT-012 — PDF Replacement**
- เพิ่มหรือเปลี่ยน Final PDF ใน Batch เดิมได้
- ไม่ต้องนำเข้า Excel ทั้งหมดใหม่
- ตรวจ Matching และ Duplicate หลังเปลี่ยน
- เก็บหลักฐานไฟล์ต้นฉบับตามความจำเป็น

**LAB-UAT-013 — Historical Correction**
- รองรับการแก้ไขข้อมูลหลัง Manual Completed
- เก็บ Revision History และผู้แก้ไข
- ไม่ลบหรือเขียนทับหลักฐานเดิมอย่างไร้ร่องรอย
- ไม่สร้าง Clinical Re-certification อัตโนมัติ

**LAB-UAT-014 — Historical Search**
- ค้นหาข้อมูลย้อนหลังจาก LN/HN
- เปิด Final PDF จากรายการที่เชื่อมโยงได้
- ตรวจ Permission การเข้าถึงข้อมูลผู้ป่วย
- ต้องใช้งานได้หลัง Restart Runtime

**LAB-UAT-015 — Excel Parser / Template Validation**
- ตรวจ Template 2 Sheets
- ตรวจ Sheet Selection และ Column Mapping
- ตรวจ Date Format และ Error Message
- ตรวจเลขแถวที่แจ้ง Error ให้ตรงกับแถวจริงใน Excel แม้มี Blank Rows
- ห้ามเปลี่ยนค่าหรือแปลงปี พ.ศ./ค.ศ. ด้วยการคาดเดา

**LAB-UAT-016 — Import Summary / Batch Discovery**
- แสดงจำนวนสำเร็จ, มีปัญหา, รอดำเนินการ อย่างชัดเจน
- ค้นหา Batch เก่าได้
- ตรวจ Pagination
- ไม่ทำให้จำนวน Summary ผิดจากข้อมูลจริง

## BATCH / TASK LIST / WORKSHEETS

**LAB-UAT-017 — Main Button Layout**
- แยก Main Navigation, Task List Selector และ Workflow Action
- ปรับ Active State
- ระยะปุ่มประมาณ 12px
- ระยะระหว่าง Section ประมาณ 24px
- Responsive โดยไม่ซ้อนหรือเบียดกัน

**LAB-UAT-018 — Sample ID Detail**
- บรรทัดบนแสดง Sample ID เต็มพร้อม Suffix
- บรรทัดล่างแสดง `LN · HN · รอบที่`
- เอา LN Halos ที่ซ้ำออก
- HN ต้องมาจากข้อมูลผู้ป่วยจริงที่เชื่อมโยง
- ไม่พบ HN ให้แสดง `HN —`
- ใช้เหมือนกันทุก Task List/Strip ที่เกี่ยวข้อง

**LAB-UAT-019 — Numeric Input Safety**
- ลบ Spinner เพิ่ม/ลดของช่องกรอกตัวเลข
- Mouse Wheel/Touchpad Scroll ห้ามเปลี่ยนค่า
- รองรับ Decimal และ Negative ตาม Validation เดิม
- ห้ามเปลี่ยนค่าจากการ Scroll โดยไม่ตั้งใจ
- ใช้แนวทางเดียวกันใน Numeric Inputs ที่เกี่ยวข้องทั่วระบบ
- ไม่เปลี่ยน QC Rules

**LAB-UAT-020 — QC Column Alignment**
- หัวข้อ Concentration (ng/µL) ต้องตรงกับ Input Column
- จัด Header และ Cell ตามโครงสร้างตาราง
- ไม่ใช้ CSS Offset แบบ Hard-coded
- ตรวจ Responsive

**LAB-UAT-021 — Remove Old QC Help**
- ลบย่อหน้าคำอธิบาย QC Master และย่อหน้า Task List/Standard เดิมตามภาพที่ Owner ระบุ
- ไม่ต้องมีข้อความแทนจาก Agent
- ห้ามเปลี่ยน QC Calculation

**LAB-UAT-022 — Red QC Guidelines**
เพิ่มข้อความสีแดงตาม Owner Lock:

“ตัวอย่างและ Positive และ Negative control ควรมีความเข้มข้น ≥ 2 ng/ul หากไม่เป็นไปตามเกณฑ์ให้เริ่มสกัดใหม่อีกครั้งในตัวอย่างที่ผ่านเกณฑ์”

“Blank control ควรมีความเข้มข้น ≤ 0.6 ng/ul”

- แสดงแยกเป็น 2 ย่อหน้าเหนือข้อมูล QC
- คงถ้อยคำของ Owner
- ห้ามตีความข้อความเป็นคำสั่งเปลี่ยน Validation Logic

**LAB-UAT-023 — Sticky Save Bar**
- ย้ายปุ่มบันทึกใบงานจากด้านบนลงด้านล่าง
- ใช้ Sticky Save Bar ในฟอร์มยาว
- สถานะบันทึกด้านซ้าย ปุ่มด้านขวา
- ไม่แสดงปุ่มบันทึกซ้ำ
- ห้ามบัง Input
- ใช้แนวทางเดียวกันใน QC, Pooling, DNB/Sequencing

**LAB-UAT-024 — Enter to Next Input**
- Enter ไป Input ถัดไป
- Shift+Enter ย้อนกลับ
- ข้าม Disabled/Read-only
- Select ค่าที่มีอยู่เมื่อ Focus ช่องใหม่
- Enter ห้าม Submit หรือ Save อัตโนมัติ
- ช่องสุดท้าย Focus ปุ่ม Save แต่ไม่กด Save
- ห้ามรบกวน Dropdown และ Textarea
- รองรับ Keyboard Accessibility

**LAB-UAT-025 — PDF Preview Modal**
- แก้ปัญหา PDF Preview เปิดไม่ได้
- ตรวจ Renderer, API Response, Authorization, Session, MIME/Headers และ Browser
- เปลี่ยน Inline Preview เป็น Popup Modal ทั่วระบบที่เกี่ยวข้อง
- รองรับหลายหน้า, Scroll, Close, Expand, Retry
- ปิด Modal แล้วค่าฟอร์มต้องไม่หาย
- ทดสอบ PDF จริง รวมภาษาไทย
- ห้ามแก้เนื้อหา Master PDF หรือ Signature โดยไม่จำเป็น

## POOLING

**LAB-UAT-026 — Simplify Pooling Rows**
- เอาคำว่า `PATIENT` ออก
- คง PC / NC / BLANK
- เอาช่องเหตุผล/หลักฐานออก
- ยกเลิก Validation ที่บังคับกรอกเหตุผลสำหรับ Workflow นี้
- คงการเลือกตัวอย่างและ Transfer Data ที่จำเป็น

**LAB-UAT-027 — Single Pooling Calculation Table**
- ยึดตารางคำนวณ Pooling เดิมเป็นตารางเดียว
- ไม่สร้างตาราง Actual Pooling แยกอีกชุด
- มี Checkbox ระบุรายการ Pooling
- ใช้ค่าคำนวณเป็นค่าเริ่มต้นตาม Workflow เดิม
- แก้ไขเฉพาะแถวที่ต้องการผ่าน Small Modal
- ไม่ต้องกรอกค่าทุกตัวอย่างซ้ำ
- ค่าที่ผู้ใช้แก้ไขแสดงสีแตกต่างจากค่าคำนวณ พร้อมตัวบ่งชี้
- เก็บค่าคำนวณเดิมไว้
- แยก Calculation, User Override และ Saved Actual Evidence อย่างถูกต้อง
- ห้ามบันทึกค่าคำนวณเป็นค่าที่วัดจริงโดยอัตโนมัติก่อนเกิดการยืนยันตาม Workflow
- เชื่อมข้อมูลไป Seq Task-G50 และ Export ตามกฎเดิม
- ไม่เพิ่ม Reason/Evidence Field

**LAB-UAT-028 — Volume Display**
- แสดงเฉพาะตัวเลข เช่น `1.78`
- ตัดข้อความ “ต่ำกว่า 2.00” ออก
- คงสีแดงแจ้งค่าผิดเกณฑ์
- ค่าที่ผู้ใช้แก้ไขต้องยังแยกที่มาได้ โดยสีแจ้งเตือนด้านความผิดปกติต้องไม่ถูกกลบ
- ไม่เปลี่ยน QC Threshold

**LAB-UAT-029 — Pool Concentration Text**
แสดงข้อความสีแดงนี้:

“เกณฑ์ของความเข้มข้น Pooling DNA Library คือ 3.00-3.60 ng/ul”

- วางใต้ Input `Pool Library concentration (ng/µL)` ทันที
- เว้นประมาณ 8px
- แสดงตลอดเวลา
- ไม่เปลี่ยน Validation หรือ Formula

## SEQUENCING / RESULT / COMMON UPLOAD

**LAB-UAT-030 — Seq Task-G50 Cleanup**
- ลบกล่องข้อความสีแดง/พื้นชมพูที่ขึ้นต้น “Task List 48 ตำแหน่ง | Pooling ...”
- ลบเฉพาะกล่องข้อความ ห้ามเปลี่ยน HALOS Exclusion หรือ Rerun Logic
- ปรับปุ่ม “นำเข้า PDF Result” ให้เป็นปุ่มจริงพร้อม Upload Icon
- ขนาด/ระยะให้สอดคล้องกับปุ่ม Preview และ XLSX
- ปุ่ม Preview ใช้ Modal ตาม LAB-UAT-025

**LAB-UAT-031 — Drag & Drop Upload**
- ช่อง Upload ที่เกี่ยวข้องทั่วระบบต้องรองรับ Drag & Drop
- ยังคงเลือกไฟล์จากเครื่องได้
- รองรับ Multiple Files ในช่องที่อนุญาต
- มี Drag Active State
- แสดงชื่อไฟล์/จำนวนไฟล์/ล้างรายการ
- แจ้ง Error ประเภทหรือขนาดไฟล์
- ไม่ Upload อัตโนมัติหาก Workflow เดิมต้องกดยืนยัน
- ไม่เปลี่ยน File Limits, Validation หรือ Permission เดิม
- รองรับ Mobile

**LAB-UAT-032 — Result Filter Toolbar**
- จัด Status Filter Buttons เป็นกลุ่ม
- Active State ชัดเจน
- เว้นระยะปุ่มให้เหมาะสม
- แยก CSV Export ออกจาก Filter
- ปรับคำอธิบาย Export ให้กระชับและไม่เบียดตาราง
- จัด Pagination ด้านล่างตารางเป็นกลุ่ม
- รองรับ Responsive
- ไม่เปลี่ยน Filter/Export/Pagination Logic

---

# 4. UX/UI DESIGN REVIEW USING BOTH SKILLS

ให้ใช้ UX UI Pro Max และ Impeccable รีวิวระบบ NIPT-CBH โดยเน้น:

- Visual Hierarchy
- Layout Consistency
- Spacing System
- Typography
- Thai Line Breaking
- Button Alignment
- Data Table Readability
- Forms and Input Ergonomics
- Modals and Dialogs
- Sticky Actions
- Feedback/Toast/Error States
- Keyboard Navigation
- Accessibility
- Responsive at 375 / 768 / 1280 / 1440 px
- Long Tables and Overflow Handling

**สำคัญ:**

การรีวิวครอบคลุมทั้งระบบเพื่อค้นหาปัญหาความสม่ำเสมอได้ แต่การ Implement ต้องอยู่ภายในขอบเขต 32 รายการเท่านั้น รวมถึง Shared Components ที่จำเป็นต่อรายการเหล่านี้

ห้าม Redesign หน้าที่ไม่เกี่ยวข้อง ห้ามเปลี่ยน Navigation Structure หรือเพิ่ม Feature ใหม่โดยอาศัยคำแนะนำของ Skill อย่างเดียว

Skill เป็นเครื่องมือช่วยออกแบบ ไม่ใช่ผู้มีอำนาจเปลี่ยน Owner Requirements

ให้เน้นความง่ายในการใช้งานสำหรับเจ้าหน้าที่โรงพยาบาล:
- รู้ว่าต้องทำอะไรต่อ
- ไม่ต้องคลิกหรือ Scroll มากเกินความจำเป็น
- ไม่กรอกข้อมูลซ้ำ
- ไม่แสดงข้อความทางเทคนิคที่ไม่ช่วยในการทำงาน
- ลดโอกาสกรอกค่าผิด
- ไม่ตกแต่งจนรก

---

# 5. REQUIRED EXECUTION PROCESS

## Phase A — Baseline Audit

1. ตรวจ Git HEAD, Branch และ Working Tree
2. ตรวจ Handoff และ Owner Lock
3. ตรวจ Local Runtime/Source Parity
4. ตรวจระบบและข้อมูลเดิม
5. ตรวจ Dependency ของทั้ง 32 รายการ
6. ตรวจ Skills ทั้งสองตัว
7. จัดทำ Requirement Traceability Matrix

ทุกแถวต้องมี:
- LAB-UAT ID
- Current Behavior
- Expected Behavior
- Source Files
- Database/API Impact
- Test Cases
- Status
- Evidence

## Phase B — Implement

จัดกลุ่มงานเพื่อลดการแก้ไฟล์ซ้ำ แต่ต้องไม่ขยาย Scope

ลำดับความสำคัญ:
1. Data Safety และ Historical Import Workflow
2. Permission และ User Role
3. Pooling/Worksheet Behavior
4. PDF Preview และ File Upload
5. Shared Input Components
6. Visual Layout และ Responsive
7. Production Admin Bootstrap สำหรับการทดสอบติดตั้งใหม่

ให้ใช้ Reusable Components เฉพาะเมื่อมีประโยชน์จริงต่อข้อกำหนดหลายรายการ

ห้ามสร้าง Abstraction ใหม่ที่ไม่จำเป็น

ดำเนินงานต่อเนื่องจนแก้ครบ หรือจนพบ Blocker ที่พิสูจน์ได้จริง

## Phase C — Verification

ต้องตรวจอย่างน้อย:

**Static Validation**
- Typecheck
- Lint
- Build
- Source Guard

**Automated Tests**
- Unit Tests
- Contract Tests
- DB Integration Tests
- Permission Tests
- Regression Tests
- Relevant Browser/E2E Tests

**Browser Tests**
- ทุกหน้าและปุ่มที่อยู่ใน Scope
- Desktop/Tablet/Mobile
- Keyboard Enter Navigation
- Mouse Wheel ไม่เปลี่ยน Numeric Values
- PDF Preview Modal เปิดเอกสารจริงได้
- Drag & Drop Upload ใช้ได้
- Pooling Override/Checkbox/Save ถูกต้อง
- Historical Manual Import ทำได้คนเดียว
- Corrected/Blocked Rows ไม่ทำให้ผลผิดผู้ป่วย
- Admin/Staff/Nurse Permission ถูกต้อง

**Persistence Tests**
- Save
- Refresh
- Navigate Away and Back
- Restart Local Runtime
- Reopen Saved Work
- ตรวจไฟล์ต้นฉบับและข้อมูลเดิมไม่เสียหาย

## Phase D — Runtime Parity

ก่อนประกาศว่าเสร็จ:
- ตรวจว่า Source ที่แก้ถูก Build เข้า Runtime จริง
- ตรวจ Source Revision และ Runtime Revision
- ตรวจ Database Migration ถ้าจำเป็น
- ทดสอบผ่าน URL Local UAT ที่ใช้งานจริง
- ไม่ใช้ผลทดสอบจาก Runtime เก่ามาอ้างว่าเป็นผลของ Code ใหม่
- ตรวจ Smoke Test หลัง Restart

ห้ามอ้างว่า Browser PASS หากทดสอบเฉพาะ Source หรือ Mockup

---

# 6. DEFINITION OF DONE — STRICT ACCEPTANCE GATE

**งานจะถือว่าเสร็จก็ต่อเมื่อ LAB-UAT-001 ถึง LAB-UAT-032 ผ่านครบทั้ง 32 ข้อเท่านั้น**

เงื่อนไขบังคับ:

- [ ] 32/32 Requirements implemented
- [ ] 32/32 Requirements tested
- [ ] 32/32 Browser/Runtime acceptance verified where applicable
- [ ] No regression
- [ ] No unauthorized scope changes
- [ ] No missing functionality
- [ ] No blocked requirements
- [ ] Data integrity preserved
- [ ] Source-to-Runtime parity verified
- [ ] No unexplained test failures
- [ ] No silently skipped applicable tests
- [ ] No unapproved Production deployment

**Completion Rule**

`COMPLETE = (IMPLEMENTED 32/32) AND (VERIFIED 32/32) AND (BLOCKED 0) AND (MISSING 0) AND (REGRESSION FAIL 0) AND (RUNTIME PARITY PASS)`

หากมีเพียงข้อเดียวที่ยังไม่เสร็จหรือไม่มีหลักฐานตรวจรับ ห้ามใช้คำว่า COMPLETE

ต้องรายงาน `NOT COMPLETE` พร้อมรายละเอียดและหลักฐานที่ขาด

---

# 7. REPORTING FORMAT

รายงานผลในรูปแบบ:

## NIPT-CBH LAB OWNER UAT — FINAL REPORT

**Source HEAD:**  
**Local Runtime Revision:**  
**Branch:**  
**Working Tree:**  
**Database Target:**  
**UX UI Pro Max:** Used / Not Available  
**Impeccable:** Used / Not Available  

### Requirement Summary

| Metric | Result |
|---|---|
| Total Requirements | 32 |
| Implemented | x/32 |
| Verified | x/32 |
| Pending | x |
| Blocked | x |
| Regression Failures | x |
| Source/Runtime Parity | PASS/FAIL |

### Detailed Checklist

รายงานแยก LAB-UAT-001 ถึง LAB-UAT-032 ทุกข้อ พร้อม:
- Files Changed
- Behavior Implemented
- Tests Executed
- Browser Evidence
- Result
- Outstanding Issues

### Out-of-Scope Findings

รายงานปัญหาที่พบเพิ่มเติม แต่ต้องยืนยันว่าไม่ได้แก้เอง

### Final Verdict

เลือกเพียง:

`COMPLETE — ALL 32 REQUIREMENTS VERIFIED`

หรือ

`NOT COMPLETE — REQUIREMENTS/EVIDENCE OUTSTANDING`

---

# 8. FINAL OWNER INSTRUCTION

**ห้ามหยุดงานหลังทำเพียงบางรายการแล้วรายงานเหมือนเสร็จ**

**ห้ามทำเฉพาะ UX/UI แล้วละเลย Workflow, Backend, Database และ Permission ที่อยู่ใน Checklist**

**ห้ามทำเฉพาะ Backend แล้วละเลย Browser UX/UI Acceptance**

**ห้าม Spam Preview หรือส่งภาพร่างซ้ำ ๆ แทนการ Implement**

ให้ดำเนินการตรวจสอบ แก้ไข ทดสอบ และยืนยันผลอย่างเป็นระบบ พร้อมรายงานผลรวมเมื่อมีหลักฐานเพียงพอ

หากพบ Blocker ที่แท้จริง ต้องระบุสาเหตุ ข้อที่ได้รับผลกระทบ และสิ่งที่ต้องได้รับการอนุมัติเพิ่มเติม ห้ามแก้ข้ามข้อจำกัดเอง

**The Owner Checklist is the Single Source of Truth.**

**Do not invent requirements.**

**Do not work outside the approved scope.**

**Do not claim completion until all 32 items are implemented and verified.**

**Target: 32/32 VERIFIED — ZERO MISSING — ZERO BLOCKED — ZERO REGRESSION.**
