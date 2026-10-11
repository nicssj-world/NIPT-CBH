# NIPT CBH — P1 Foundation

ระบบเดียวสำหรับโรงพยาบาล: Next.js Web, PostgreSQL, Node Worker และ PDF Renderer ภายในชุด Docker เดียวกัน ตาม Implementation Plan v6.2.1 และ AL-1 ที่ Owner อนุมัติ

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

## เริ่มในเครื่องพัฒนา

ต้องมี Node 24, npm, Docker Compose และพื้นที่สำหรับ Chromium/images ใช้เฉพาะ workspace จำลอง

```powershell
npm ci
npx tsx tools/init-dev.ts
docker compose up -d --build
```

เปิด `https://localhost:8443` โดยรับรอง CA ภายในของชุดทดสอบตามนโยบายเครื่องพัฒนา บัญชีจำลอง `synthetic.admin`, `synthetic.approver`, `synthetic.lab`, `synthetic.anc`, `synthetic.auditor` ใช้รหัสผ่านสุ่มใน `data/secrets/seed-password` ไม่ได้เก็บรหัสผ่านใน Git

สำหรับ native development ให้สร้าง PostgreSQL จำลอง local และปรับ `.env.local` ตาม `.env.example` แล้วรัน `prepare-db.ts`, `seed.ts`, `simulator`, `renderer`, `worker` และ `dev` อย่านำ connection ของโรงพยาบาลมาใช้

## เอกสารส่งมอบ

- [Implementation และผลตรวจ](docs/p1-delivery.md)
- [Legacy → NIPT CBH mapping](docs/legacy-mapping.md)
- [Source authority และ ADR](docs/architecture.md)
- [ติดตั้ง Offline, Backup, Restore](docs/operations.md)
- [Design system](DESIGN.md), [UX/ACR evidence](docs/accessibility.md)
- [งาน P2 และ Integration gates](docs/next-phases.md)

ไม่รวม ZIP, patient data, internal credentials, original hospital documents หรือ legacy runtime ใน Repository
