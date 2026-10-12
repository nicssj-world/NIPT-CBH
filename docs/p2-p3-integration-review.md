# P2–P3 Synthetic Integration — Implementation และ Technical Review

**สถานะ:** Integration ของ P2 (ลงทะเบียน/Request/Consent) กับ P3 (HIS Inbound) บนข้อมูลจำลอง **ทำเสร็จแล้วบน Branch `feat/p3-inbound-synthetic`** และพร้อมให้ Owner ตรวจรับก่อน Merge **ยังไม่ Merge เข้า `main`**
**ขอบเขต:** Synthetic เท่านั้น ไม่มีข้อมูลผู้ป่วยจริง ไม่เชื่อม HIS Share จริง ไม่ใช้ Credentials จริง ไม่ Deploy Production และไม่แก้ WI/FM ต้นฉบับ
**ไม่ได้อ้าง:** AL-3, LAN Shadow (AT-HISIN-LAN-01), Manual UAT, Clinical/DPO/DCC Approval, เกณฑ์ Clinical Eligibility หรือ Consent จริง, P3 Acceptance บน HIS จริง และไม่ได้เริ่ม P4

## 1. Baselines และ Git

| รายการ | ค่า |
| --- | --- |
| P2 บน `main` | `9bada1e14f07643824cf751b884254833b910215` (CI [38237868261](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38237868261): native 910 / browser 36) |
| P3 ก่อน Integration | `4b980e221dc17694c1578c62863c31810e7a794c` (Draft PR [#1](https://github.com/nicssj-world/NIPT-CBH/pull/1)) |
| Merge | `git merge --no-ff origin/main` → `6d3b839` ไม่มี Conflict เชิงข้อความ (ทั้งสองฝั่งไม่ได้แก้ไฟล์เดียวกัน) ไม่ Rebase ไม่ Force Push และไม่ Rewrite History |
| Workspace | ทำงานเฉพาะ `D:\Claude workspace\NIPT-CBH-P3` ไม่แตะ Workspace ของ P2 (Codex) ก่อนเริ่มตรวจแล้วว่า Working tree สะอาด, Local = Remote และไม่มี Process อื่นแก้ Branch นี้ |
| Commit Integration และ CI | SHA และผล CI ของ Commit นี้บันทึกไว้ใน Draft PR #1 (เอกสารฝัง Hash ของ Commit ตัวเองไม่ได้) |

แหล่งอ้างอิงที่อ่าน: `docs/p2-delivery.md`, `docs/p2-p3-handoff.md`, `docs/p2-governance.md`, `docs/architecture.md`, `docs/migrations.md` บน `main`, `docs/p3-synthetic-delivery.md` บน P3, Plan v6.2.1 (§4.7 L1–L7, §6.6(h), §10.2 ข้อ 5–9, D-40, D-49, OD-14, OD-15, AT-LDR-02/08, AT-ID-REG-01) และ AL-2 Owner Decision & Lock `NIPT-CBH-AL2-20261012-001` ใน NIPT-Audit (อ่านอย่างเดียว) ไม่ได้เลือก Clinical Rule ใดเอง

## 2. สิ่งที่ทำใน Integration

### A. Registration + HIS Intake (D-49)
- `registerP2` เรียก `linkIntakeAtRegistration` **ใน Transaction เดียวกัน** หลังจากสร้างหรือเปิด Case และหลังตรวจ Scope (`scopedCase`) แล้ว โดยถือ LN advisory lock ตัวเดียวกับ Worker (`lockLn`, salt `75432802`, reentrant) Registration และการ Link จึง Commit หรือ Rollback พร้อมกันเสมอ
- Hook รับ **Principal** ของผู้ลงทะเบียน HN ที่ผู้เรียกส่งมาใช้เพียง Cross-check ซึ่งต้องตรงกับ `p2_case_identity.hn` (Immutable) **และ** `nipt_case.identity_key` ต้องเท่ากับ Digest ของคู่ LN/HN ตาม P2 ผู้ลงทะเบียนต้องมีสิทธิ์ `case.read` ในหน่วยงานของ Case และ LN ต้องเป็นของ Case นั้น ถ้าไม่ผ่านจะได้ `IDENTITY_UNVERIFIED`, `FORBIDDEN` หรือ `CASE_LN_MISMATCH` และ Registration ทั้งหมด Rollback ขั้น Matching อ่าน Identity ที่เก็บไว้ชุดเดียวกับที่ Worker อ่าน ผู้เรียกจึงกำหนดผลการเทียบเองไม่ได้
- ถ้ามี Intake รออยู่แต่อ่าน Bytes จาก File store ไม่ได้ Registration จะล้มแบบ Fail-closed ด้วย `INTAKE_STORE_UNAVAILABLE` ไม่ข้ามการ Link แบบเงียบ
- การ Replay ด้วย Idempotency key เดิมคืนผลเดิม ถ้า Replay แต่เปลี่ยน Unit หรือแหล่งของตัวระบุจะได้ `IDEMPOTENCY_CONFLICT` หรือ `Idempotency conflict`
- กรณีมี Case ที่ผู้ลงทะเบียนไม่มีสิทธิ์เห็น ระบบคืน `IDENTITY_UNVERIFIED` โดยไม่ระบุ Case ไม่ Link และไม่เปิดเคส และตอนนี้มี Audit `CASE_REGISTRATION/REJECTED` ที่ไม่มี `resource_id`

### B. Identity Contract

| แหล่ง | ค่า | ผลหลัง Integration |
| --- | --- | --- |
| P2 `registerP2` | `identityLookup(JSON.stringify([normalizedLn, hn]), key)` | เป็นสูตรเดียว (LN ตัดเฉพาะขีด ไม่ตัดศูนย์นำหน้า; HN trim) |
| `nipt_case.identity_key` | Digest จาก P2 ด้านบน | ทดสอบแล้วว่าเท่ากันทุกไบต์ รวม LN/HN ที่มีศูนย์นำหน้า |
| P3 `lnHnKey(ln,hn,key)` | `identityLookup(JSON.stringify([ln,hn.trim()]),key)` | เท่ากับ P2 (contract test) |
| P3 `defaultIdentitySource` | **เปลี่ยนเป็น** `p2IdentitySource` → `{scheme:'P2_LN_HN',ln,hn,key}` | MATCH ต้องมีทั้ง Digest ที่เป็นคู่ P2 ของ LN/HN นั้น **และ** HN ตรงทุกตัวอักษร |
| P1 Synthetic Legacy (`SYNTHETIC-ID-…`) | ไม่มี `p2_case_identity` | `NONE` → `IDENTITY_UNVERIFIED` พร้อม Issue และ Audit ไม่แปลง Digest และ LN ที่ตรงกันไม่ทำให้ Upgrade หรือรับ Case |

ระบบไม่ยืนยันตัวตนด้วย LN อย่างเดียว ถ้า Key ของ Web กับ Worker ไม่ตรงกัน (เช่น Mount ผิด) Digest จะไม่ตรงคู่ P2 และผลคือ `IDENTITY_UNVERIFIED` ไม่ใช่การจับคู่ผิดคน นอกจากนี้ `registerP2` ปฏิเสธ Lookup key ที่ยาวไม่ใช่ 32 ไบต์ (`IDENTITY_LOOKUP_KEY_INVALID`)

### C. LAB_DIRECT Blind Entry (§4.7 L2–L3, D-40, AT-LDR-02)
- L2: `POST /api/p2/intake-presence` ต้องผ่าน Session, CSRF/Origin และสิทธิ์ `case.register.lab` ตอบเพียง `{unlinkedIntake:boolean}` และตอบ `true` เฉพาะเมื่อ LN นั้นยังไม่มี Case ทุกครั้งที่ตรวจมี Audit `INTAKE_PRESENCE_CHECKED` (บันทึกแค่ PRESENT/ABSENT)
- UI ลงทะเบียน Lab: เมื่อออกจากช่อง LN จะแสดงข้อความ `role=status` ว่ามีหรือไม่มีข้อมูลสั่งตรวจรออยู่ ไม่แสดงชื่อ HN หรือวันเกิดจาก HIS ช่อง HN ระบุให้กรอกจากหลอดหรือเอกสารเท่านั้น และมีช่องบังคับ **แหล่งของตัวระบุ** (`TUBE_LABEL` / `REQUEST_FORM` / `PATIENT_DOCUMENT`)
- Server บังคับแหล่งของตัวระบุสำหรับ LAB_DIRECT (`IDENTIFIER_SOURCE_REQUIRED`) และบันทึกใน `registration_attempt.identifier_source` (Migration 009) กับ `case_event INTAKE_LINK_AT_REGISTRATION`
- หลังกรอก: ถ้าตรงจะ Link S1 ด้วยเวลา `P[21]` ถ้าไม่ตรงจะสร้าง Case ที่ S1 = Expected, Intake คง `Unlinked` และเปิด `IDENTITY_MISMATCH` ให้ผู้ตรวจคนที่สอง UI แสดงเพียง **ชื่อช่อง** ที่ไม่ตรง (เช่น "HN") ไม่แสดงค่า

### D. Migration
- เปลี่ยนชื่อ `090_p3_his_inbound.sql` เป็น **`008_p3_his_inbound.sql`** ด้วย `git mv` (008 ว่างจริง) แก้เฉพาะบรรทัด Comment หัวไฟล์ ส่วน SQL เหมือนเดิมทุกไบต์ เพิ่ม **`009_p2_p3_registration_identifier_source.sql`** (Additive, nullable, CHECK ค่า)
- ไม่แก้ 001–007 และไม่แก้ Ledger ของฐานข้อมูลใด ฐานข้อมูล P3 เดิมที่ Apply 090 ไปแล้วถือเป็น Disposable และไม่ถูกแก้ให้ดูเหมือน Apply 008
- สร้างฐานข้อมูลจำลองใหม่ (`nipt_p3int_synthetic_test`, `nipt_synthetic_p2_browser_p3int` บน Container P3 `127.0.0.1:55443`) แล้วรัน 001→009 ตามลำดับผ่าน Migrator ที่ตรวจ Checksum Ledger ตรงกับ Source ทุกไฟล์ และ 001–007 ตรงกับ `docs/migrations.md` ของ P2
- ย้าย `roles-p3.sql` เข้า `packages/db/roles.sql` แล้วลบไฟล์เดิม เพิ่ม Grant แบบระบุคอลัมน์ให้ `worker_rw` อ่าน `p2_case_identity(case_id,hn)` และ `p2_collection_fact(case_id,round_id,source,collection_date,sequence)` ตรวจแล้วว่า `nipt_web` เป็นสมาชิกของ `app_rw` และ `nipt_worker` เป็นสมาชิกของ `worker_rw` โดยไม่มี Superuser, CREATEDB หรือ CREATEROLE

| Migration | SHA-256 (LF) |
| --- | --- |
| 008_p3_his_inbound.sql | `666c7ebed7839479ba52b40d76080502a03fb34c2bdb5ddc088f15124b4a25cf` |
| 009_p2_p3_registration_identifier_source.sql | `aa98a4723624a2902bd9e28cc223e72dcbc9dac9a2dc5c553ccde0eaaea5a79a` |

### E. Worker / Secret / Runtime
- Worker `synthetic_scan` เรียก `runInboundCycle` และมี Job `synthetic_inbound_test` เหมือนเดิม Lookup key ต้องยาว 32 ไบต์ Health, Backoff และ Test Connection ไม่เปลี่ยน
- `compose.yaml`: Service `web` Mount secret `identity_lookup` แล้ว (เดิมตั้ง `IDENTITY_LOOKUP_KEY_FILE` ไว้แต่ไม่ได้ Mount ทำให้ลงทะเบียน P2 ใน Compose ไม่ได้) Web และ Worker รันด้วย User `node` และใช้ไฟล์ Key เดียวกัน (สร้างด้วย Mode 0600)
- เพิ่มเมนู `/inbound` ("รับใบสั่งจาก HIS") แสดงเฉพาะผู้มีสิทธิ์ `his.scan` อ่าน (Lab/IT/Admin/Auditor) ANC ไม่เห็นเมนูนี้
- ระบบยังตรวจ Identity ของ PDF/RES ใน P1 Publisher และ P2 Signing/Consent/Withdrawal/PDF ครบเหมือนเดิม และ Worker ยังไม่รับ S2+ (`p3_worker_round_guard`, AT-HISIN-11 property test)

### F. Clinical Data Provenance (OD-14 / CG-06)
- เวลารับใน HIS `P[21]` เก็บที่ `specimen_round.received_at` / `his_order.his_received_at` (Immutable) วันเก็บตัวอย่างใน HIS `P[23]` เก็บที่ `specimen_round.collection_date` วันเจาะที่ ANC/Lab แจ้งยังอยู่ใน `p2_collection_fact` (append-only) เวลาที่บันทึก (Recorded time) คือ `created_at` / `processed_at` ของแต่ละแถว
- ถ้าวันเก็บตัวอย่างจาก HIS ไม่ตรงกับแหล่งที่แจ้งไว้ ระบบบันทึก `case_event COLLECTION_PROVENANCE_CONFLICT` (เก็บเพียงชื่อแหล่ง) พร้อม Audit และไม่เขียนทับหลักฐาน ANC การประเมินครั้งต่อไปของ P2 จะได้ `ClinicalDataConflict` ส่วน `gate.passed` ยังเป็น `false` เสมอ ระบบไม่ Auto-pass

### G. ลำดับ Lock
Registration: Session → LN advisory → (`registerCase` insert/FK) → Audit → Scope/Identity → `p2_workspace` → Intake file → `case_ln` → Round
Worker: LN advisory → Intake file → `case_ln` (FOR UPDATE) → Round (NO KEY UPDATE) → `his_order` → Case (KEY SHARE ผ่าน FK) → Audit
P2 (Autosave/Signing): Session → Case (FOR UPDATE) → Workspace/Signing row → Audit
ทั้งสองเส้นทางที่แตะ LN เดียวกันเริ่มที่ LN lock เส้นทางของ Worker ไม่แตะแถว Signing จึงไม่ขัดกับลำดับ case-before-signing Native test ทดสอบ P2 Autosave และ `startSigning` ขณะถือ Case lock กับ Worker Apply S1 ทั้งสองลำดับ ไม่พบ Deadlock และ Signing session ยัง Active

## 3. ผลการทดสอบ (รันจริงบนเครื่อง Windows, Node 24.15, PostgreSQL 17 ใน Container ของ P3)

| Gate | ผลจริง |
| --- | --- |
| `npm run typecheck` / `npm run lint` | PASS / PASS (`--max-warnings 0`) |
| `npm run guard` | PASS, 232 ไฟล์ |
| `npm test` แบบ Native (`NIPT_TEST_DATABASE_URL` = DB ใหม่ `nipt_p3int_synthetic_test`) + `NIPT_LEGACY_PET_PARSER_DIR` | **32 ไฟล์ / 956 PASS, 0 skip**, 107 วินาที รวม P1/P2/P3 Contract, Regression, Permission, Native concurrency ของ P2, Native smoke ของ P3 (`registerP2` ด้วย `nipt_web` แข่งกับ Worker จริงด้วย `nipt_worker` ผ่าน pg-boss), Native ของ P2–P3 ใหม่ และ AT-HISIN-02 Differential กับ Parser Python ของ Legacy (แตกไฟล์ไว้นอก Repository) |
| `npm run build` | PASS มี Tracing warning เดิมของ P1 3 รายการ ไม่มี Warning ใหม่ |
| Playwright เต็มชุด (Production build, App ต่อ DB ด้วย `nipt_web`/`app_rw`, Renderer จริง, DB ใหม่ `nipt_synthetic_p2_browser_p3int`, Windows Chromium, เปิด Visual comparison) | **42/42 PASS, 0 skip, 0 flaky**, 1.4 นาที (P1 8 + P2 28 + P3 6) รวม Lab blind entry และ axe AA ที่ 375px |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Migration ledger | 001–009 Apply ตามลำดับบน DB ใหม่ 2 ชุด Checksum ตรงกับ Source ทุกไฟล์ |

ฐานเดิมเพื่อเทียบ: P2 `main` มี 24 ไฟล์ / 910 Native และ 36 Browser ส่วน P3 ก่อน Integration มี 888 Native และ 12 Browser หลัง Merge ก่อนแก้ ชุด PGlite ล้ม 18 Test เพราะ Helper ของ P3 ลงทะเบียนแบบ P1 ซึ่งไม่มี `p2_case_identity` จึงถูกปฏิเสธแบบ Fail-closed ตามที่ควรเป็น ปัญหานี้แก้ด้วยการเปลี่ยนไปใช้เส้นทางที่ Integrate แล้ว ไม่ได้ผ่อนการตรวจ ผล CI บน GitHub ของ Commit นี้บันทึกไว้ใน Draft PR #1

## 4. Technical Review — Findings และ Disposition

Review ครอบคลุม Identity, Transaction/Concurrency, Permissions/Secrets/Audit, Provenance, Worker/Idempotency, Migration/Deployment, P1–P3 Regression และ UI/Accessibility

| ID | ระดับ | ด้าน | Finding | Disposition |
| --- | --- | --- | --- | --- |
| I-1 | Important | Worker privilege | หลัง Merge Worker อ่าน `p2_case_identity` แต่ `worker_rw` ไม่มีสิทธิ์ จึงล้มด้วย `permission denied` ทุกครั้งที่จับคู่ Case ของ P2 และ S1 ค้างอยู่ | **แก้แล้ว** เพิ่ม Grant แบบระบุคอลัมน์ Test: `p3-roles` (Worker cycle รันจริงด้วย `worker_rw` รวมกรณี Negative ของ Read/Write) และ Native smoke ใช้ `nipt_worker` |
| I-2 | Important | Identity / AuthZ | Hook รับ HN จากผู้เรียกแล้วใช้เทียบโดยตรง ไม่ผูกกับ `p2_case_identity`, Digest หรือ Unit scope จึงถูกบังคับผลได้ | **แก้แล้ว** HN จากผู้เรียกใช้เพียง Cross-check, Matching อ่าน Identity ที่เก็บไว้ และตรวจ Unit scope Test: ลองบังคับด้วยศูนย์นำหน้า, HN อื่น, Case อื่น, Unit อื่น และแหล่งที่ไม่ถูกต้อง |
| I-3 | Important | D-49 | ยังไม่ได้เรียก Hook ใน `registerP2` ทำให้การ Link ไม่อยู่ใน Transaction เดียวกับการลงทะเบียน | **แก้แล้ว** Test: ทั้งสองลำดับให้ผลสุดท้ายเดียวกันสำหรับ ANC/LAB × ตรง/ไม่ตรง, Rollback พร้อมกัน และแข่งกันจริงบน Native |
| I-4 | Important | Idempotency (P2 เดิม) | Replay `registerP2` ด้วย Key เดิมได้ `CREATED` แล้วพยายาม Insert `case_unit_scope` ซ้ำจนติด PK error ทำให้การ Retry หลัง Response หายกลายเป็น Error | **แก้แล้ว** Replay คืนผลเดิม และการ Replay ที่เปลี่ยน Unit หรือแหล่งของตัวระบุเป็น Conflict Test: PGlite และ Native (สอง Session ใช้ Key เดียวกันพร้อมกัน) |
| I-5 | Important | Deployment | Compose `web` ไม่ Mount secret `identity_lookup` | **แก้แล้ว** (Synthetic Compose ไม่ได้ Deploy) |
| I-6 | Important | Blind entry | ไม่มี L2 Presence และไม่บันทึกแหล่งของตัวระบุ (AT-LDR-02) | **แก้แล้ว** Server บังคับใช้, มี Migration 009, UI, Audit และ Browser test |
| m-1 | Minor (แก้แล้ว) | Identity | `defaultIdentitySource` เทียบ HN อย่างเดียวและยังมี Fallback ของ P1 ที่ไม่มีทางถูกใช้แล้ว | เปลี่ยนเป็น `P2_LN_HN` ที่ตรวจ Digest ด้วย |
| m-2 | Minor (แก้แล้ว) | Audit | การปฏิเสธเพราะมี LN นอกสิทธิ์ไม่มี Audit | เพิ่ม Audit `REJECTED` ที่ไม่ระบุ Case |
| m-3 | Minor (แก้แล้ว) | Provenance | ความขัดแย้งของวันเก็บตัวอย่างไม่ถูกบันทึกตอนรับ S1 | บันทึก `COLLECTION_PROVENANCE_CONFLICT` พร้อม Audit |
| m-4 | Minor (แก้แล้ว) | Secret | `registerP2` ใช้ Lookup key โดยไม่ตรวจความยาว | Fail-closed `IDENTITY_LOOKUP_KEY_INVALID` |
| m-5 | Minor (แก้แล้ว) | UI determinism | ทะเบียนเรียงแถวที่มี `created_at` เท่ากันด้วย UUID สุ่ม ทำให้ Visual baseline ไม่คงที่ | เรียงด้วย `created_at DESC, ln, id` และสร้าง Baseline registry ใหม่ 4 ภาพโดยตรวจทีละภาพ (§5) |
| m-6 | Minor (เปิด) | DB constraint | `identifier_source` ของ LAB_DIRECT ยังเป็น nullable ใน DB เพราะ `registerCase` ของ P1 และ Seed เกิดก่อน Blind entry | ยอมรับใน Synthetic เพราะ Runtime path มีทางเดียว (`/api/p2/register` → `registerP2`) และบังคับที่ Service แล้ว ให้ทบทวนเมื่อ P4/P5H เพิ่มทางลงทะเบียน |
| m-7 | Minor (เปิด) | Availability | ถ้ามี Intake รออยู่แต่ File store ใช้ไม่ได้ Registration จะล้ม (Fail-closed) | ตั้งใจตาม D-49 เพราะการข้าม Link จะผิดสัญญา Transaction เดียว |
| m-8 | Minor (เปิด) | Privacy | Presence probe ทำให้ Lab รู้ว่า LN ใดมี Intake รออยู่ | ข้อมูลระดับเดียวกับที่ Lab เห็นใน `/inbound` อยู่แล้ว ไม่เปิดเผย PHI และมี Audit ทุกครั้ง |
| m-9 | Minor (เปิด) | Withdrawal | Case ที่ถอนความยินยอม (W0/W1) แล้วยังรับ HIS S1 เป็นหลักฐานได้ | Hold ของ P2 ยังบล็อกงาน P2 ทุกอย่าง และระบบไม่ Void HIS นโยบายหลังจากนี้อยู่ใน OD-10/P4 |
| m-10 | Minor (เปิด) | OD-15 | ยังเทียบเฉพาะ LN+HN ไม่เทียบ DOB/ชื่อ (P2 ไม่เก็บ DOB และยังไม่มีเกณฑ์ชื่อไทย) | ตามขอบเขต AL-2 ต้องรอ OD-15 |
| m-11 | Minor (เปิด) | Throughput | Audit chain ใช้ Global advisory lock ทั้ง Web และ Worker | Native test ไม่พบ Deadlock เรื่อง Throughput ไปพิจารณาใน P7 Hardening |
| m-12 | Minor (เปิด) | P3 scope | `scanSimulator`/`applyPet` ของ P1 ยังคงอยู่ (Worker ไม่เรียกแล้ว) และ Resolution `accept_his`/`create_case`/`new_generation` ยังปิดอยู่ | ตาม P3 delivery §7 ข้อ 7–8 ให้ทำต่อใน P4 |
| m-13 | Minor (เปิด) | PHI at rest | `his_inbound_file.parsed` ยังเก็บชื่อ, HN และวันเกิดแบบ Plaintext ใน DB จำลอง | ต้องตัดสินเรื่องเข้ารหัสระดับคอลัมน์ก่อนใช้ข้อมูลจริง (AL-3/DPO) |
| P2-M1 | Minor (เปิด, คงทะเบียน) | PDF layout | บล็อกแพทย์ของ Consent ที่ยังไม่ลงนามอาจตกไปหน้าต่อ | ไม่แก้ในรอบนี้ตามคำสั่ง ไม่เกี่ยวกับ Integration |

**Critical: 0 · Important ค้าง: 0** (แก้ครบ 6 รายการ) · Minor: แก้แล้ว 5 รายการ และเปิดอยู่ 9 รายการ (รวม P2-M1) พร้อม Disposition

## 5. การเปลี่ยนจำนวน Tests และ Baseline
- ไม่มี Test ใดถูกลบ, Skip หรือผ่อนเงื่อนไข ตรวจแล้วว่าจำนวน `it(`/`test(` ในทุกไฟล์ไม่ลดลง และไม่มี `.skip`/`.only`/`fixme`
- เพิ่ม Test: `tests/contracts/p2-p3-integration.test.ts` (+9), `tests/contracts/p2-p3-native.test.ts` (+1, Native), `tests/db/p3-roles.test.ts` (+1), `tests/e2e/p3-inbound.spec.ts` (+1 Browser)
- ปรับ Test ที่มีอยู่ตามสัญญาใหม่ (ไม่ได้ผ่อนเงื่อนไข) Helper `register()` ของ P3 ตอนนี้ผ่าน `registerP2` จริง กรณี "ลงทะเบียนก่อนมี Hook" ใช้ Helper ที่ระบุชื่อชัดเจน (`registerWithoutHook`) เพื่อทดสอบ Rematch ส่วน Test ของ P2 ที่ลงทะเบียน LAB_DIRECT ส่ง `identifierSource` และ Assertion ผลลงทะเบียนตรวจ `intake:{outcome:'NO_INTAKE'}` เพิ่ม
- Visual baseline: สร้าง `tests/e2e/foundation.spec.ts-snapshots/registry-{375,768,1280,1440}-win32.png` ใหม่ **ครั้งเดียว (Batch เดียว)** หลังตรวจ Diff ว่ามาจาก (1) เมนู "รับใบสั่งจาก HIS" ที่ตั้งใจเพิ่ม และ (2) ลำดับแถวที่เคยสุ่มและตอนนี้คงที่ ได้ตรวจภาพใหม่ทีละภาพแล้ว Baseline ของ P2 (`p2-*`) ไม่เปลี่ยน การรับรอง Visual อย่างเป็นทางการยังเป็นของ Owner

## 6. ที่ยังต้องได้รับการรับรอง
Owner ตรวจรับ Integration นี้ก่อน Merge PR #1 · AL-3 (Share/ACL จริง และ LAN Shadow) · OD-15 (ตัวระบุขั้นต่ำ) · OD-14 (ความหมายของ HIS P[23]) · Clinical/DPO/DCC · Manual UAT/Accessibility/NVDA · Owner Visual · รายการที่ค้างใน [p2-governance.md](p2-governance.md) ทั้งหมด
