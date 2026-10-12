# NIPT CBH — P1 Foundation / P2 Synthetic

ระบบเดียวสำหรับโรงพยาบาล: Next.js Web, PostgreSQL, Node Worker และ PDF Renderer ภายในชุด Docker เดียวกัน ตาม Implementation Plan v6.2.1 และ AL-1 ที่ Owner อนุมัติ

P2 ใช้ขอบเขตจำลองตาม AL-2 Restricted Owner Lock และ Start Order วันที่ 12 ตุลาคม 2026 ครอบคลุม ANC/Lab Direct Registration, Request, Paper/Mixed Consent, Signing Session และ PDF จำลอง การตรวจส่งมอบทางเทคนิคติดตามใน [P2 Delivery](docs/p2-delivery.md)

**รุ่นนี้ใช้ Synthetic เท่านั้น** การออกผลจริง การรับรองผล Historical promotion และ HIS จริงถูกปิดใน Runtime ไม่ใช่แค่ซ่อนปุ่ม ไม่มี Production deployment

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
- [งานต่อและ Integration gates](docs/next-phases.md)

ไม่รวม ZIP, patient data, internal credentials, original hospital documents หรือ legacy runtime ใน Repository
