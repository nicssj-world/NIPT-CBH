# NIPT CBH — P1 Foundation / P2 Synthetic

## OWNER LOCK — Hospital installed baseline (confirmed 27 October 2026)

**Current hospital server: NIPT-CBH v1.1.0, installed by NEW FULL INSTALL on the morning of 2026-10-27.** This is the sole installed baseline for the next Windows Update; older installations have been replaced. The Owner explicitly reconfirmed v1.1.0 after earlier contradictory version assumptions.

- **Update base = v1.1.0 ONLY** (verify the actual installed `install-state.json` `current.version` AND `current.revision` read-only before packaging or installing; the exact server revision/hash has not yet been independently verified). Do not infer a base from EXE filenames, a developer worktree, or a later-numbered build.
- **1.2.0 / 1.2.1 / 1.2.2 are NOT the installed hospital baseline.** Do not substitute, deploy, or run upgrade rehearsals for those versions unless the Owner later confirms a new full installation.
- Build/test one targeted **Update.exe on top of the verified 1.1.0 Full Install**, not a new full install. Preserve hospital database, patient/case records, HIS PET/OK and RES/OK, NAS paths, credentials, audit history and file store; backup and pass isolated E2E update/restore rehearsal before any hospital installation.
- **Admin Settings Owner requirement:** APP_ADMIN saves system settings including HIS Auto Scan directly; no second approver, no mandatory reason and no user-facing settings-test queue. Keep audit logs and clinical certification safeguards. Do not auto-enable live HIS scanning as a side effect of update.
- The existing 1.1.1 Update package is only a **candidate**, not an installed or hospital-verified update; its E2E rehearsal must pass before use.

See [Owner lock: hospital full-install baseline](docs/OWNER-LOCK-HOSPITAL-BASELINE-2026-10-27.md). Historical Synthetic/phase descriptions below are development documentation and do **not** override this installed-version decision.

P4b continuation: [Pooling / QC2 / F4 synthetic delivery](docs/p4b-pooling-delivery.md) — immutable HOLD snapshots, no clinical acceptance or HALOS export.

ระบบเดียวสำหรับโรงพยาบาล: Next.js Web, PostgreSQL, Node Worker และ PDF Renderer ภายในชุด Docker เดียวกัน ตาม Implementation Plan v6.2.1 และ AL-1 ที่ Owner อนุมัติ

P2 ใช้ขอบเขตจำลองตาม AL-2 Restricted Owner Lock และ Start Order วันที่ 12 ตุลาคม 2026 ครอบคลุม ANC/Lab Direct Registration, Request, Paper/Mixed Consent, Signing Session และ PDF จำลอง การตรวจส่งมอบทางเทคนิคติดตามใน [P2 Delivery](docs/p2-delivery.md)

**รุ่นนี้ใช้ Synthetic เท่านั้น** การออกผลจริง การรับรองผล Historical promotion และ HIS จริงถูกปิดใน Runtime ไม่ใช่แค่ซ่อนปุ่ม ไม่มี Production deployment

## Owner Lock — HIS reception และการส่งผล

**NIPT-CBH PET Reception and Result Delivery Workflow MUST reference `NIPTY.zip` and `NIPTY_handover.zip`.** รายละเอียด แหล่งอ้างอิง และผลตรวจกับโค้ดอยู่ที่ [docs/his-workflow-owner-lock.md](docs/his-workflow-owner-lock.md) ห้ามเปลี่ยน Workflow นี้โดยไม่ได้รับ Owner Approval

- PET เกิดเมื่อเจ้าหน้าที่กดรับสิ่งส่งตรวจใน HIS ไม่ใช่เมื่อแพทย์สั่งตรวจ HIS วาง `.pet` + `.ok`
- NIPT-CBH อ่านโฟลเดอร์ PET แบบ Read-only และไม่มีขั้นตอนรับสิ่งส่งตรวจซ้ำ ข้อมูลจาก PET (เวลารับ P[21]) เป็น Source of Truth ของการรับ การตรวจสภาพหลอด/ปฏิเสธ/พิมพ์ฉลากเป็นงาน Lab ไม่ใช่การรับรอบสอง
- เจาะซ้ำ (S2) มาจาก PET ใหม่ของ HIS ด้วย HIS LN เดิม เป็น Specimen Round ใหม่ LN Halos ฐานเดิมต่อท้าย `R` (แฝด `DR`) — S3+ รอ Owner (OD-R2)
- ผล PDF ฉบับสุดท้ายมาจากโปรแกรมวิเคราะห์ภายนอก NIPT-CBH ไม่วิเคราะห์หรือรับรองผลทางคลินิกซ้ำ ทำหน้าที่รับ จับคู่ ตรวจตัวตนและ Report Version ที่ถูกต้อง แล้วส่ง HIS
- RES/PDF/OK ใช้ File Contract ที่ตรวจจาก ZIP ([docs/p6/contract-review.md](docs/p6/contract-review.md)) การ Copy ไฟล์สำเร็จไม่ใช่หลักฐานว่า HIS รับผลแล้ว
- P5-A (Owner 2026-10-18, Migration 100): ระบบเชื่อมโยง PDF ที่ตรงกับรอบตัวอย่างเดียวชัดเจนได้โดยไม่ต้องมีคนที่สอง เมื่อเปิด `result_management.linkageMode = UNIQUE_AUTO_LINK` ผ่าน Settings (ค่าเริ่มต้นยังเป็นแบบ 2 คน) ไม่ส่ง HIS อัตโนมัติ และยังต้อง "ตรวจรับ PDF และยืนยันส่งผล"
- ผล PDF รับได้ 2 ช่องทาง: โฟลเดอร์ (หลัก — สแกนเมื่อกดปุ่ม "สแกนไฟล์ PDF" เท่านั้น ไม่สแกนตามเวลา) และ "อัปโหลด PDF ผลตรวจ" ในหน้าผู้ป่วย (สำรอง ใช้ได้แม้ Worker หยุด) ใช้ขั้นตอนเดียวกันทั้งหมด: [docs/p5-two-pdf-channels.md](docs/p5-two-pdf-channels.md)
- ใบขอส่งตรวจ (Fm-WI-T-BM17/01) และใบยินยอม (/02): ANC กรอกครั้งเดียว ระบบแสดง Preview บนแบบฟอร์ม DCC ต้นฉบับ (ฉบับร่าง ไม่ใช่เอกสารควบคุม) แพทย์ผู้สั่งตรวจมาจาก Doctor Registry ที่เลือกในใบขอส่งตรวจเท่านั้น: [docs/anc-forms-autofill.md](docs/anc-forms-autofill.md)
- การพิสูจน์ Settings ทุกหมวดจนถึง Consumer จริง และการจำลองด้วยไฟล์ตัวอย่างจาก ZIP: [docs/settings-operational-acceptance.md](docs/settings-operational-acceptance.md)

## สิ่งที่ทำได้

- Local authentication ด้วย Argon2id, server-side session, lockout, CSRF และ RBAC 9 บทบาท
- Registration service, LN lock, Case/Specimen Round/Attempt, Gate/Status foundation และ PostgreSQL invariants
- Audit hash-chain, settings 10 หมวดแบบ version/maker-checker และ secret envelope แบบ write-only
- Immutable file storage, durable jobs/retry/cancellation, Worker heartbeat และ reconciliation evidence
- Adapter PET/OK และ RES/OK จาก logic ที่ตรวจใน ZIP จริง พร้อมตัวจำลอง 100 คู่
- Renderer แยก process, ฟอนต์ไทยใน image และ PDF preview cache ที่ผูกกับ session
- หน้าจอไทยสำหรับทะเบียน/รอบตัวอย่าง/สุขภาพระบบ/การตั้งค่า รองรับ 375/768/1280/1440 px
- OCI images, signed offline release bundle, encrypted backup/restore และ CI
- P2: ลงทะเบียน ANC/LAB_DIRECT ร่วมกัน, Request 5 หมวด/Auto-save/Revision, Paper Pending แยกจาก Verified และโหมด Request/Consent อิสระ
- P2: ลงนามผู้รับบริการจำลอง 12 ข้อ, แยก Capability จากเจ้าหน้าที่, คืน Session ด้วยรหัสผ่าน/คำรับรอง, ทะเบียนแพทย์จำลองแบบ Version/Maker-checker
- P2: PDF Request/Consent ภาษาไทย A4 จาก Snapshot, Cache ชั่วคราวและ Audit ทุกการอ่าน, ถอน Consent แบบเก็บหลักฐาน/ปิด Gate

P4 Synthetic (Lab Workflow + Repeat/Redraw) อยู่บน Branch `feat/p4-lab-workflow-synthetic` รอ Owner ตรวจรับ — ดู [P4 Synthetic Delivery](docs/p4-synthetic-delivery.md)

- P4: คิวงาน Lab (S1 จาก HIS ไม่มีการรับซ้ำ, เจาะซ้ำ S2 รับจาก PET ใหม่ของ HIS ด้วย LN เดิม — รับใน NIPT ได้เฉพาะชุดจำลอง), LN Halos `YYBYYMMDDNNN` ออกเมื่อรับสิ่งส่งตรวจจริงเท่านั้น, ฉลากหลอด 4 ดวง/8 ช่องแบบเดียวกับ Genomic-CBH (ไม่มีบาร์โค้ด), เรียงตามวันที่/เวลารับ
- P4: Batch/Task List 1–3 (48 ตำแหน่ง, PC 1/NC 25/Blank 40), Assignment/Finalize Gate, Placement Snapshot, ใบงาน F2/F3 Pre-work/Completed PDF, บันทึกจากกระดาษพร้อมทวนสอบคนที่สอง, QC1 ที่ไม่ตัดสินด้วยเกณฑ์ที่ยังไม่รับรอง, Repeat/Redraw พร้อม Lineage

Clinical Assessment ของ P2 ยังไม่สามารถให้ผลผ่านเกณฑ์จริงได้ เอกสารและลายเซ็นใช้ Synthetic เท่านั้น Clinical/DPO/DCC, UAT และหลักฐาน Accessibility ของผู้ใช้จริงยังต้องรับรองตาม [รายการค้าง](docs/p2-governance.md)

## เริ่มในเครื่องพัฒนา

ต้องมี Node 24, npm, Docker Compose และพื้นที่สำหรับ Chromium/images ใช้เฉพาะ workspace จำลอง

```powershell
npm ci
npx tsx tools/init-dev.ts
docker compose up -d --build
```

เปิด `https://localhost:8443` โดยรับรอง CA ภายในของชุดทดสอบตามนโยบายเครื่องพัฒนา บัญชีจำลอง `synthetic.admin`, `synthetic.approver`, `synthetic.lab`, `synthetic.certifier`, `synthetic.anc`, `synthetic.auditor` ใช้รหัสผ่านสุ่มใน `data/secrets/seed-password` ไม่ได้เก็บรหัสผ่านใน Git

สำหรับ native development ให้สร้าง PostgreSQL จำลอง local และปรับ `.env.local` ตาม `.env.example` แล้วรัน `prepare-db.ts`, `seed.ts`, `simulator`, `renderer`, `worker` และ `dev` อย่านำ connection ของโรงพยาบาลมาใช้

## เอกสารส่งมอบ

- [P1 Implementation และผลตรวจเดิม](docs/p1-delivery.md)
- [P2 Implementation และผลตรวจ](docs/p2-delivery.md), [Clinical/Governance ที่ยังรอรับรอง](docs/p2-governance.md)
- [Legacy → NIPT CBH mapping](docs/legacy-mapping.md)
- [Source authority และ ADR](docs/architecture.md)
- [ติดตั้ง Offline, Backup, Restore](docs/operations.md)
- [Design system](DESIGN.md), [UX/ACR evidence](docs/accessibility.md)
- [P4 Lab workflow synthetic delivery](docs/p4-synthetic-delivery.md)
- [งานต่อและ Integration gates](docs/next-phases.md)
- [HIS reception / result delivery Owner Lock](docs/his-workflow-owner-lock.md), [P0 Owner Decision Register](docs/p0-owner-decision-register.md)

ไม่รวม ZIP, patient data, internal credentials, original hospital documents หรือ legacy runtime ใน Repository
