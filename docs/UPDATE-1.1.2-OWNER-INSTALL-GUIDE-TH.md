# คู่มือตรวจรับและติดตั้ง NIPT-CBH Update v1.1.2 (สำหรับผู้ดูแลระบบ)

> **ผ่าน Local Windows Update Rehearsal 13/13 แล้ว และตรวจ SHA-256 ของ EXE จริงแล้ว** แต่การติดตั้งบน Server โรงพยาบาลยังต้องได้รับการอนุมัติจาก Owner ตามขั้นตอน Change Control และทำ NAS/HIS/Clinical Acceptance หน้างานก่อน Go-live. เอกสารนี้ไม่ใช่หลักฐานว่า NAS โรงพยาบาลผ่านแล้ว

## ขอบเขต
- อัปเดตเท่านั้นจาก NIPT-CBH v1.1.1 revision `c237da440dd0e007b2a94bca6438c3dce5fdcc43`
- ไม่ติดตั้งใหม่ ไม่เปลี่ยนผู้ใช้ รหัสผ่าน รหัสทะเบียน LN/HN ข้อมูลผู้ป่วย และเส้นทาง HIS/NAS ที่ใช้อยู่
- NAS Archive เก็บเฉพาะ PDF ผลตรวจฉบับสุดท้ายที่ **รับรองหลังเปิด Archive ผ่านหน้า Admin** โดยไม่ย้อนหลังหรือเติม Historical PDF 89 ไฟล์
- **ไม่รวม Historical Genomic-CBH Migration** หรือเครื่องมือ Import ประวัติ 137 ราย
- ระบบ FileStore, PET/OK, RES/OK และ CFS/HIS ทำงานแยกจาก NAS Archive หาก NAS ใช้งานไม่ได้ต้องไม่หยุดการรับรองหรือส่งผล
- NAS Archive ไม่ใช่ Database/FileStore Backup และไม่ทดแทนนโยบาย Backup/Restore

## ก่อนติดตั้งจริง (ผู้ดูแลตรวจ)
1. ตรวจสอบหน้า System Health ของ v1.1.1, Current Revision และเส้นทาง PET/RES/PDF Backup ที่ใช้อยู่
2. ตรวจสอบ Backups ล่าสุดและมีผล **Restore Drill ในฐานทดสอบที่กักกัน**; เก็บหลักฐานตามนโยบายโรงพยาบาล
3. ตรวจลายเซ็น Manifest และ SHA-256 ของ `NIPT-CBH-Update-1.1.2.exe` เทียบกับไฟล์ SHA256SUMS ที่ส่งมอบ
4. ตรวจว่าไฟล์เป็น **Update Only**, `profile=production`, `requiresInstalledRevision=c237da44...`; ไม่ติดตั้งเมื่อ Revision ไม่ตรง
5. จัดเวลาบำรุงรักษาและแผนคืนค่าฐานข้อมูลก่อน Update; **ห้ามถือว่า rollback app เพียงอย่างเดียวเพียงพอหลัง Migration ใหม่**
6. ติดตั้งด้วยบัญชีผู้ดูแล Windows ที่มีสิทธิ์บนเครื่องเป้าหมายตาม Runbook; ไม่ใช้เครื่อง Dev ทดลองกับข้อมูลผู้ป่วย

## หลัง Update
1. ยืนยัน Health: Web/Worker/Renderer, Migration Match, Release/Result/Outbox/Settings และไม่มีสถานะ Quarantine
2. ให้ APP_ADMIN ไปที่ **Settings → NAS PDF Archive**; ระบบเริ่มต้นเป็น Disabled
3. กรอก **UNC Root** ของ NAS ที่โรงพยาบาลกำหนด; ไม่ใช้ Root ของ FileStore/HIS และไม่ตั้งเป็นโฟลเดอร์ที่ผู้ใช้ทั่วไปแก้ไขไฟล์ได้
4. กด **Test Connection**: ตรวจว่า Worker Windows Account จริงสามารถสร้าง Stage, เขียน/อ่าน, Hash, เผยแพร่แบบไม่เขียนทับ, Rename และลบไฟล์ Probe ได้; หากไม่ผ่านให้ปิด Archive ไว้
5. กด **Save & Enable** หลัง Test ผ่านด้วยบัญชี APP_ADMIN; ไม่ต้องมีผู้อนุมัติคนที่สองหรือเหตุผล Popup
6. รับรอง PDF *รายใหม่* ด้วยกระบวนการ Clinical ปกติ แล้วตรวจใน LAB ว่าสถานะจาก PENDING → ARCHIVED และไฟล์ตรง SHA-256 บน NAS; ไม่ใช้ข้อมูลจริงจนเสร็จ Acceptance ของโรงพยาบาล
7. จำลอง NAS ไม่พร้อมด้วยเงื่อนไขทดสอบที่ควบคุมได้: Archive เป็น FAILED/RETRY ได้ แต่ Clinical Release, RES/OK และ HIS ต้องไม่เปลี่ยน
8. ตรวจ **Settings → งานผิดพลาด / KPI / PDF Audit** ว่าเห็น Archive, PDF Audit และปุ่มขอ Worker ตรวจ NAS ก่อนลองอีกครั้ง
9. ตรวจผลเก่าและ Historical ไม่ถูกนำไป Archive อัตโนมัติ; ตำแหน่ง NAS เป็นข้อมูล Admin-only

## หากอัปเดตไม่ผ่าน
- หยุดดำเนินการ/เปิดใช้ Archive; เก็บ Log ของ Installer, Worker, Health และ Backup Manifest
- ตรวจกรณี Requires Installed Revision Mismatch, Permission, Outbound Paths, Quarantine และ Migration failure
- อย่าฝืน Migration ซ้ำหรือลบฐานข้อมูล/ไฟล์ต้นฉบับ; ให้ Restore ตาม Runbook ที่ทดสอบแล้ว
- เก็บ Source, EXE, Manifest, SHA-256 และหลักฐาน Validation แยกจาก NAS PDF Archive

## หลักฐานรับมอบที่ต้องแนบ
- `NIPT-CBH-Update-1.1.2.exe` (หลัง Build/Test ผ่านเท่านั้น), `SHA256SUMS`, Signed Manifest
- รายงาน Unit/Native PostgreSQL/Chromium E2E, Security/Source Guard, Windows Upgrade Rehearsal
- Backup/Restore Receipt ที่กักกัน, ผล Test NAS Worker Identity/ACL/SMB จริงหลังติดตั้ง
- Version/Revision ต้นทาง-ปลายทาง และการรักษา Migration 157 กับข้อมูลเดิม

## หลักฐานการทดสอบตัวอัปเดต Windows (PASS)
- ชุด EXE ที่ใช้: Setup 1.1.0 → Update 1.1.1 → Update 1.1.2 พร้อมตรวจ SHA-256 ทั้งสามไฟล์
- Evidence: `.local/p8-win/evidence/update-112-real-chain-rehearsal.json` — **13/13 PASS, passed:true**
- SHA-256 v1.1.2: `9533eb2695f50625e5a010f96f7dd9eb298bfcfddadc1d5fa3a521784c842a13`
- Build Record: `.local/p8-win/setup-d914a0a/NIPT-CBH-Update-1.1.2.record.json`
- อัปเดตจริงในเครื่องทดสอบเก็บ User, Password Hashes, Active Settings, PET/RES, HIS Paths, Migration 157–160 ครบ; verified backup/quarantined restore PASS
- ทดสอบอัปเดตซ้ำและแก้ไข Manifest ถูกปฏิเสธตามข้อกำหนด รวมถึงข้าม Revision 1.1.0 → 1.1.2 ถูกปฏิเสธด้วย `UPGRADE_BASE_REVISION_MISMATCH`
- คงข้อจำกัด: EXE ไม่ได้ Authenticode sign; ต้องทดสอบ SMB/Worker Windows account/ACL, Clinical/NAS และ HIS บน Server โรงพยาบาลก่อนรับรองใช้งาน
