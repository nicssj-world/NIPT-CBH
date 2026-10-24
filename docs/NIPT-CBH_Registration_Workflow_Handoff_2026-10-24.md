# NIPT-CBH — Registration Workflow Handoff
**วันที่:** 24 ตุลาคม 2569 (2026-10-24)  
**หัวข้อ:** ANC / LAB Registration, HIS `.pet`, LN Halos, Paper Consent, Ordering Ward  
**สถานะ:** Owner-confirmed requirements / Design lock เท่านั้น — **ยังไม่อนุญาตให้ implement, migrate, deploy หรือแก้ runtime**

## 1. เป้าหมาย
ลดการกรอกซ้ำทั้ง ANC และ LAB ใช้ข้อมูล HIS `.pet` เป็นแหล่งข้อมูลพื้นฐานและหน่วยงานที่ส่งตรวจ; LAB รับตัวอย่างและสร้าง LN Halos ได้โดยไม่รอ GA/EDD/ข้อมูลคลินิกอื่น และมีตัวเลือก Consent กระดาษแบบเรียบง่าย

## 2. OWNER-LOCK — Workflow ลงทะเบียนโดย LAB (ยืนยันแล้ว)
1. ผู้ใช้ LAB **ระบุ LN หรือ HN อย่างใดอย่างหนึ่ง** ไม่บังคับทั้งสองช่อง
2. ระบบค้นหา/จับคู่ไฟล์ HIS `.pet` และอ่านข้อมูลพื้นฐานอัตโนมัติ เช่น LN, HN, ชื่อ, วันเกิด, เพศ, เวลารับตัวอย่าง และ Ward
3. เมื่อจับคู่ PET และหลักฐานการรับสิ่งส่งตรวจจาก HIS สำเร็จ ระบบ **ออก LN Halos อัตโนมัติ** โดยไม่ต้องกรอก GA/EDD/ข้อมูลทางคลินิกก่อน
4. ข้อมูลอื่นที่ยังไม่มี เช่น **GA, EDD/EDC, Singleton/Twins** และข้อมูลที่จำเป็นเพิ่มเติม สามารถกรอก/แก้ภายหลังจากหน้า **Sample Detail**
5. ในการลงทะเบียน LAB มีตัวเลือก **Paper Consent** (หรือ Electronic Consent ตาม workflow ที่เกี่ยวข้อง) โดย Paper Consent เป็นเพียง **marker ว่าใช้ใบยินยอมแบบกระดาษ**; ต้นฉบับมากับตัวอย่าง ไม่ต้องสแกน อัปโหลด หรือพิมพ์เอกสารซ้ำเพื่อสร้าง marker
6. ไม่สร้าง LN Halos ซ้ำเมื่อเปิดเคสเดิม / พยายามลงทะเบียนซ้ำ

**กรณีใช้งานที่ต้องออกแบบและทดสอบ:** ค้นด้วย HN ที่มี LN หลายรายการต้องให้เลือก LN/รายการตรวจที่ถูกต้อง; ไม่พบ `.pet`, `.ok` ยังไม่พร้อม, PET ไม่ตรงกัน หรือพบหลายรายการกำกวม ต้องแสดงสถานะที่ตรงจริงและไม่สร้างเลขจากข้อมูลที่ยังไม่ผ่านการยืนยัน แยกให้ชัดระหว่าง “เปิด/สร้างเคส” กับ “ออก LN Halos จากการรับ HIS สำเร็จ”

## 3. OWNER-LOCK — Workflow ลงทะเบียนโดย ANC (ยืนยันแล้ว)
- **ตัด Dropdown “หน่วยงานที่ส่งตรวจ” ออกจากหน้า ANC Registration**; ไม่ให้ ANC กรอกหรือเลือกข้อมูลนี้เอง
- ANC ยังลงทะเบียนและทำ Request/Consent **ก่อนมี `.pet`** ได้ตามปกติ; ในระหว่างนั้นหน่วยงานที่ส่งตรวจอาจแสดงเป็น **“รอข้อมูลจาก HIS”**
- เมื่อไฟล์ `.pet` เข้ามาและจับคู่สำเร็จ ระบบนำค่า Ward มาเติม **หน่วยงานที่ส่งตรวจ** อัตโนมัติ และแสดงใน Sample Detail
- **ไม่แทนที่ Ordering Department ด้วยหน่วยงานของผู้ใช้ที่ Login** เพราะคนละความหมาย หน่วยงานของผู้ใช้ยังใช้สำหรับ access scope/RBAC ตามกฎเดิม
- **LAB Registration ก็ไม่ต้องมี Dropdown หน่วยงานที่ส่งตรวจ** เพราะระบบอ่านจาก PET เช่นกัน

## 4. OWNER-LOCK — ความหมายของ Ward ใน PET
Owner ยืนยันอย่างชัดเจนว่า **`ward` จาก `.pet` = หน่วยงานที่ส่งตรวจ (Ordering Department)** ไม่ต้องกลับไปตั้งคำถามเรื่องความหมายซ้ำ

ตาม Parser ใน GitHub `main` ที่ตรวจได้:
- บรรทัดข้อมูลประเภท `P` ตำแหน่ง **`P[33]`** มีรูปแบบ `WARD^PATIENT_IDENTITY`
- Parser แยกส่วนหน้าของ `^` เป็น `ward`; ส่วนหลังเป็น patient identity (ไม่ใช่ Ward)
- ฟิลด์อื่นที่ Parser ดึง: `P[2]` LN, `P[3]` HN, `P[5]` ชื่อ, `P[7]` วันเกิด, `P[8]` เพศ, `P[21]` เวลารับจาก HIS, `P[23]` เวลาเจาะ/สิ่งส่งตรวจ, `O[14]` เวลาสั่ง
- HIS ingestion มีเงื่อนไขไฟล์ `.ok` คู่กับ `.pet` และคัดเลือก NIPT Section 7 / Test Code 70096
- `ward` ถูกอ่านและอยู่ใน `ORDER_FIELDS` เพื่อใช้ตรวจความต่างของข้อมูล Order; ยังไม่ยืนยันว่าถูกผูกกับฟิลด์ Ordering Department ใน UI ของ Runtime ล่าสุดแล้ว

**Source:**
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/integrations/pet.ts
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/inbound/wire.ts
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/inbound/discovery.ts

## 5. ผลตรวจ Source Code ที่เข้าถึงได้ (ไม่ใช่การยืนยัน Local UAT ล่าสุด)
อ้างอิง `nicssj-world/NIPT-CBH` บน `main` ซึ่งมี commit ล่าสุดที่ตรวจได้ ณ **15 ต.ค. 2569**; Workspace ทดสอบในเครื่อง Owner มีการพัฒนาต่อ แต่ Dev MCP ไม่เชื่อมต่อ (tunnel-client unavailable) จึง **ยังยืนยันพฤติกรรม Local UAT วันที่ 23–24 ต.ค. ไม่ได้**

| รายการ | โค้ด `main` ที่ตรวจพบ | ต่างจาก Owner Lock อย่างไร |
|---|---|---|
| LAB Registration | บังคับ `ln`, `hn`, `identifierSource`, `unitId` | ต้องเหลือ LN **หรือ** HN และไม่ให้เลือก Ordering Department |
| HIS/PET presence | Precheck ด้วย LN และแสดงเพียงมี/ไม่มี PET รอ; ไม่แสดง HN/ชื่อจาก PET | ต้องค้นหา PET ด้วยตัวระบุเดียวและนำข้อมูลพื้นฐานที่จำเป็นมาใช้ |
| PET matching | `registerP2` ใช้ LN + HN และเชื่อม PET หลังสร้าง/เปิดเคส | ต้องปรับ matching โดยรักษา identity correctness และ duplicate protections |
| LN Halos | ออกเมื่อได้รับ/ยืนยัน S1 จาก PET (`received_at` trigger) ไม่ใช่เพียงกด Register | Owner ต้องการให้เกิดอัตโนมัติทันทีที่การลงทะเบียนที่มี PET/receipt ผ่าน; ไม่มี PET ที่ผ่านจึงยังไม่ออก |
| LAB Paper Consent | `LAB_DIRECT` ตั้ง Request และ Consent เป็น `Paper` เริ่มต้น; เปลี่ยน channel ใน Case Detail | ต้องมีตัวเลือก Paper Consent ตั้งแต่ LAB Registration แบบ marker ที่ไม่สร้างภาระเพิ่ม |
| ANC/LAB unit | มี `unitId` ใน Registration Service | แยก unit สำหรับสิทธิ์/ขอบเขตการเข้าถึงจาก ordering ward แล้วลบเฉพาะการให้ user เลือกหน่วยงานที่ส่งตรวจ |
| GA/EDD/etc. | มี Request Form ใน Case Workspace | ทำภายหลังใน Sample Detail ได้ ไม่เป็น gate ก่อนออก LN Halos |

**จุดสำคัญด้านเทคนิค:** การตัด Dropdown ไม่ได้หมายถึงลบ RBAC/`unitId` ทุกที่โดยไม่วิเคราะห์ mapping; ต้องไม่ทำให้ permission หรือ case scope เสียหาย และอย่าตั้งหน่วยงานจากผู้ Login เป็นข้อมูลหน่วยงานที่ส่งตรวจ

**หมายเหตุเรื่อง running sequence:** ใน migration รุ่นเก่าที่ตรวจ (`010_p4_lab_workflow.sql`) ยังมีชื่อ `ln_halos_daily_sequence` แต่ Owner เคยกำหนดลำดับ LN Halos ให้รันต่อเนื่อง **ตลอดเดือนและ reset รายเดือน** ในรุ่นพัฒนาภายหลัง ต้องตรวจโค้ด Local ล่าสุดก่อนสรุปหรือลงมือแก้ ห้ามย้อนกติกาเป็นรายวัน

**Source ที่ตรวจ:**
- https://github.com/nicssj-world/NIPT-CBH/blob/main/src/components/p2/registry.tsx
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/p2/service.ts
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/inbound/registration-link.ts
- https://github.com/nicssj-world/NIPT-CBH/blob/main/packages/inbound/process.ts
- https://github.com/nicssj-world/NIPT-CBH/blob/main/src/components/p2/case-workspace.tsx
- https://github.com/nicssj-world/NIPT-CBH/blob/main/db/migrations/010_p4_lab_workflow.sql

## 6. ผลลัพธ์ UX/UI ที่ต้องการ
**ANC:** ลงทะเบียนได้โดยไม่เลือกหน่วยงาน → ทำ Request/Consent → รอ PET เมื่อยังไม่มี → ข้อมูล Ward เติมอัตโนมัติเมื่อ HIS receipt match  
**LAB:** ป้อน LN หรือ HN → ค้นหา PET และเลือก LN เฉพาะกรณี HN มีหลายรายการ → ดึงข้อมูล HIS → เลือก/ยืนยันชนิด Consent (รวม Paper) → ลงทะเบียนและรับ LN Halos ตามหลักฐาน receipt → พิมพ์ Label → เติม GA/EDD/ประเภทครรภ์ที่ Sample Detail ภายหลัง

UI ควรกระชับ ให้เห็นสิ่งที่ต้องทำต่อ ชัดเจนว่าข้อมูลใดมาจาก HIS และข้อมูลใดผู้ใช้เติมภายหลัง ไม่บังคับกรอกข้อมูลที่ยังไม่มี ไม่สร้างแบบฟอร์มซ้ำซ้อน

## 7. ข้อควรระวัง / สิ่งที่ไม่ได้อนุญาต
- **ยังไม่มีการแก้โค้ด, Migration, Deploy หรือ Runtime ในการสนทนานี้**
- การใช้ Paper Consent เป็น marker ในขั้นลงทะเบียน **ไม่เท่ากับการยืนยันว่ามี informed consent ที่ผ่านการตรวจจริง**; การเปลี่ยน downstream clinical/consent gates ต้องตรวจแยก ไม่ให้ข้ามกฎที่ยังใช้อยู่โดยไม่ได้อนุมัติ
- ห้ามเปลี่ยน LN Halos format/sequence, specimen lineage, PET/OK read-only, HIS integration, RBAC หรือ NIPT workflow อื่นนอก scope โดยพลการ
- ต้องตรวจสภาพ/โค้ด **Local UAT ล่าสุด** และเปรียบเทียบกับ Owner Lock ก่อนเสนอ Implementation Plan; **รอคำสั่ง Owner ก่อน implement**

## 8. Prompt ใช้ต่อ Session ใหม่
> โปรดรับ Handoff NIPT-CBH — ANC/LAB Registration, PET, LN Halos, Paper Consent และ Ward (24 ต.ค. 2569) เป็น Owner-Confirmed Requirements. ให้ตรวจ **Local UAT source/runtime ล่าสุดก่อน** (ไม่ใช้ GitHub main 15 ต.ค. แทนของปัจจุบัน) แล้วรายงาน Actual Workflow, Gap Analysis และแผนแก้ไขแบบ Scope-Locked ตาม 4 เรื่องหลัก: (1) LAB รับ LN หรือ HN อย่างใดอย่างหนึ่ง, PET autofill, สร้าง LN Halos หลัง match HIS receipt; clinical fields ค่อยเติมใน Sample Detail (2) LAB เลือก Paper Consent marker ขณะลงทะเบียนโดยไม่ต้อง scan/upload/print (3) ANC และ LAB ไม่เลือก Ordering Department; รับ Ward จาก `.pet` `P[33]` เท่านั้นเมื่อไฟล์มาถึง (4) รักษา identity matching, duplicate prevention, monthly LN Halos sequence, RBAC, HIS/PET/OK, existing consent safety gates, and case lineage. ตรวจการค้นด้วย HN ที่ได้หลาย LN และกรณี PET ยังไม่มาอย่างชัดเจน **ห้าม implement, apply migration, deploy หรือเปลี่ยน runtime จนกว่า Owner จะอนุญาต**; ห้ามทำงานนอก Scope และห้ามคิด Requirement เพิ่มเอง
