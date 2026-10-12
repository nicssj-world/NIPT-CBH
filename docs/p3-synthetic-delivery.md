# P3 HIS Inbound — Synthetic Build (ส่งมอบเพื่อรอ Integration Review)

**สถานะ:** P3 **Build** บน Synthetic Simulator เสร็จตามขอบเขต Plan v6.2.1 §15.1 (โหนด `P3B`) และ §15.3 — **ไม่ใช่ P3 Acceptance**
**Branch:** `feat/p3-inbound-synthetic` (Draft PR → `main`, ห้าม Merge จนกว่า P2 ส่งมอบและผ่าน Integration Review)
**Base:** P1 baseline `4cc73997af51878599e744738198572256a66f4e` (= `origin/main` ณ วันที่ 2026-10-12)
**ข้อมูล:** สมมติทั้งหมด · ไม่มีการอ่าน HIS Share จริง · ไม่มี Credentials จริง · ไม่มี Deploy

> **สิ่งที่ไม่ได้อ้าง:** AL-3 ยังไม่ผ่าน · ยังไม่ทดสอบ LAN Shadow (AT-HISIN-LAN-01) · ยังไม่ทดสอบ Matching End-to-End กับ Case จริงจาก P2 · ยังไม่พิสูจน์ความเข้ากันได้กับ HIS จริง ความเข้ากันได้ที่พิสูจน์คือกับ **ไฟล์สมมติรูปแบบ Legacy** และ **Parser Python ของ NIPTY เดิม** เท่านั้น

> **อัปเดตหลัง P2–P3 Integration (2026-10-12):** เอกสารนี้คือบันทึก P3 Build ก่อน Integration และคงไว้เป็นประวัติ ตอนนี้ Branch นี้ได้ Merge `origin/main` ของ P2 (`9bada1e`) เข้ามาแล้ว และทำรายการใน §7 ข้อ 1–6 เสร็จ ได้แก่ เรียก Hook ใน `registerP2`, ทำ Lab Blind Entry/แหล่งของตัวระบุ, ใช้ Identity ของ P2 ใน Matching, Mount Secret ให้ Web, เปลี่ยนเลข Migration `090` เป็น `008` และย้าย `roles-p3.sql` ไปรวมใน `roles.sql`, และเพิ่มเมนู `/inbound` ข้อ 7–9 ยังเป็นงานภายหลังตามเดิม ผลและ Findings ทั้งหมดอยู่ที่ [p2-p3-integration-review.md](p2-p3-integration-review.md) ตารางด้านล่างที่อ้าง `090_p3_his_inbound.sql` หรือ `roles-p3.sql` เป็นสถานะก่อน Integration

## 1. Workspace และการแยกจาก P2

| รายการ | ค่า |
| --- | --- |
| Codex P2 workspace | `D:\Claude workspace\NIPT-CBH` — ไม่ถูกแก้ ไม่ Checkout/Reset/Merge |
| P3 workspace | `D:\Claude workspace\NIPT-CBH-P3` (git worktree แยก, branch ใหม่จาก `4cc7399`) |
| ฐานข้อมูล P3 | Container `nipt-p3-synthetic-db` (tmpfs, `127.0.0.1:55443`) DB `nipt_p3_synthetic` / `nipt_p3_synthetic_test` — ไม่ใช้ DB `55432` หรือ Compose stack ของ Codex |
| Ports / env | Web `3300`, Renderer `3301`, `.env.local` และ `data/` ของ P3 เอง (gitignored) |
| P2 บน GitHub | ณ เวลา Preflight `origin/main` = `4cc7399`; P2 มี 4 commit **local เท่านั้น** (`b0ab490…456e65d`) + งานที่ยังไม่ commit — อ่านแบบ read-only ผ่าน git objects เพื่อหลบเลขที่ Migration และ Contract เท่านั้น |

## 2. Source Documents ที่อ่านจริง

- `NIPT_CBH_Implementation_Plan_v6.2.1_Reviewed_2026-10-11.md` — §4.7, §5.5, §5.10, §5.11, §6.2 D, §6.3, §6.6 (b)(c)(g)(h)(i), §7.2 matrix (แถว HIS), §10.1–§10.2, §10.8–§10.9, §15.1–§15.4, §16 (AT-HISIN-01..11, AT-ID-REG-01, AT-LIN-03/08, AT-LDR-02/08), OD-15, D-17/18/40/47/49 (อ่านเป็นช่วง ๆ เพราะไฟล์ 1.18 MB)
- AL-1 Lock Record, Baseline Supersession Index, P1 Technical Review Closure, P2 AL-2 Owner Decision & Lock, P2 Synthetic Start Order
- Legacy: `NIPTY_handover.zip` (แตกไว้นอก Repository) — `pet_parser.py`, `pet_scanner.py`, `pet_autoimport.py`, `samples/README_samples.md`; `NIPTY.zip` อ่าน **เฉพาะ 3 ไฟล์ Parser/Scanner** เพื่อเทียบ SHA-256 (ตรงกันทุกไฟล์) — ไม่เปิดข้อมูลอื่นใน ZIP นี้ ไม่มีไฟล์ Legacy เข้า Repository

## 3. Gap Matrix — Requirement → Existing (P1) → Missing → Test → Planned/Done Change

| Requirement | Existing P1 | Missing | Test | Change ใน P3 |
| --- | --- | --- | --- | --- |
| อ่าน `.pet` เมื่อมี `.ok` (LD-02) | `scanSimulator` ข้ามไฟล์ที่ไม่มี `.ok` | ไม่บันทึกว่ารอ `.ok`; ไม่มี Alert `.ok` ค้าง | AT-HISIN-03 | `his_inbound_waiting` + Alert `OK_SENTINEL_OVERDUE` |
| CP874 เข้มงวด + Field mapping | `parsePet` ถูกต้อง (คงไว้) | ไม่มี Differential กับ Python | AT-HISIN-01/02, unit | **ไม่เขียน Parser ใหม่**; เพิ่ม Differential harness (opt-in) |
| LN string/เลขศูนย์นำหน้า | LN เป็น string แต่ Guard บังคับขึ้นต้น `99000` | LN ที่มีศูนย์นำหน้าใช้ทดสอบไม่ได้ | AT-HISIN-01, unit | ผ่อน Guard เป็น `^0*99000\d*$` (ยังเป็นช่วงสมมติ) |
| HN สมมติแบบ P2 | Guard รับเฉพาะ `SYNTHETIC-…` | P2 ใช้ HN ตัวเลข `990…` | unit | รับ `^0*990\d{3,17}$` เพิ่ม (ช่วงเดียวกับ P2) |
| Section/รหัส NIPT | กรองชื่อ `-7.pet` เท่านั้น | Section อื่น/ไม่มี 70096 ไม่ถูกนับ; ไฟล์เสีย 1 ไฟล์ทำให้ Scan ทั้งรอบล้ม | AT-HISIN-07 | `discoverInbound` นับ NotNipt โดยไม่เก็บไฟล์; ParseError ต่อไฟล์ไม่หยุด Batch |
| Read-only source | ใช้ `confined` read | ไม่มีหลักฐานตลอดวง | AT-HISIN-08 | Tree checksum ตลอด Lifecycle + Static guard ห้าม write API ใน `packages/inbound` |
| Hash / Idempotency / Unique (path, sha) | Unique(sha256) | ไม่มี (path, sha), ไม่มีรุ่นของ Path | AT-HISIN-04 | `his_inbound_source` PK (path, sha) + `path_version` |
| ไม่ใช้ LN อย่างเดียว (OD-15) | `applyPet` เทียบ HMAC ของ P[33] ที่ Caller ส่ง | ไม่เข้ากับ P2 (`identity_key`=HMAC(LN,HN)) | AT-ID-REG-01, AT-HISIN-05/06 | `compareRegistrant` + `RegistrantIdentitySource` (HN exact; HMAC LN+HN; NONE→`IDENTITY_UNVERIFIED`) |
| Unlinked → ผูกเมื่อลงทะเบียน (D-49) | คืน `UNLINKED` เท่านั้น | ไม่มี Queue, ไม่มี Hook | AT-HISIN-05, AT-LDR-02/08 | `linkIntakeAtRegistration` (ใน Transaction เดียวกับลงทะเบียน) + Worker rematch |
| Blind entry (D-40) | — | ทั้งหมด | AT-LDR-02 | `intakePresence` คืน `{unlinkedIntake:boolean}` เท่านั้น; บันทึกแหล่งตัวระบุใน `case_event` |
| Changed PET หลัง S1 / Redraw | `INTEGRITY_CONFLICT` แบบเดียว | แยก Identity change vs ฟิลด์อื่น | AT-HISIN-04, AT-LIN-03/08 | `LN_REUSED_OR_CHANGED` / `LN_REUSED_DIFFERENT_PATIENT` / `S1_INTEGRITY_EVENT` (field names เท่านั้น) |
| S1 เท่านั้น (LD-04) | SQL แตะ round 1 | ไม่มี Property test, Role DB ของ Worker เขียน round ≥ 2 ได้ | AT-HISIN-11 | fast-check property + Trigger `p3_worker_round_guard` |
| Historical LN (LD-10) | Trigger กัน HISTORICAL | ไม่มีสถานะ Intake แยก | test HISTORICAL | `HistoricalIntake` + `HISTORICAL_LN_INTAKE`; ไม่ Apply ไม่ Promote |
| Two-person (D-18) | Policy `his.conflict.resolve` P/A | ไม่มี Workflow | AT-HISIN-06, AT-LIN-03 | `proposeResolution` / `decideResolution` + DB trigger `SECOND_PERSON_REQUIRED` |
| Retry / Reconnect / Health | Heartbeat ทั่วไป | ไม่มี Scan run, Backoff, 4 สัญญาณของ Inbound | AT-HISIN-09 | `his_inbound_scan_run`, Backoff (≤900 s), `inboundHealth` |
| Test Connection | `SyntheticMountAgent.test` (marker+inbound) | ไม่นับโฟลเดอร์/คู่ไฟล์/Parse ตัวอย่าง | test + native | `testInboundConnection` (read-only, report ไม่มี PHI) เป็น Job ของ Worker |
| Timezone / ข้ามวัน | Bangkok day folders | ไม่มี Test ข้ามเที่ยงคืน | AT-HISIN-10 | Test เท่านั้น (Logic เดิมถูก) |
| Operational UI | ปุ่ม Scan ใน Health | ไม่มีคิว | E2E + axe | หน้า `/inbound` (PHI-free) + ลิงก์จาก `/health` |

## 4. Existing vs New Implementation

**คงไว้และใช้ต่อ (ไม่เขียนใหม่):** `parsePet`, `wireDate`, `safeField`, `syntheticPet`, `simulatorRoot`/`assertSimulatorRoot`, `confined`, `FileStore`, `lockLn`, `registerCase`, `appendAudit`, `pet_order_guard`/`s1_receipt_guard` triggers, policy matrix (`his.scan`, `his.conflict.resolve`, `intake.link`, `integration.configure`) — **ไม่แก้ `policy.ts`**
**P1 API ที่คงไว้เพื่อ Regression:** `scanSimulator`, `applyPet`, `manualScan` (`tests/contracts/scanner.test.ts`, `smoke-pet.ts` ยังผ่าน) — Worker ไม่เรียกแล้ว; เสนอให้ถอดออกหลัง Integration Review
**ใหม่:** `packages/inbound/*` (wire, identity, process, discovery, cycle, health, connection-test, resolution, registration-link, queue, tx), หน้า/API P3, Simulator scenarios, smoke และ Tests

**แก้ไฟล์ P1 (เล็กที่สุด):**

| ไฟล์ | การเปลี่ยน |
| --- | --- |
| `packages/integrations/pet.ts` | Guard ช่วงสมมติ (LN มีศูนย์นำหน้า, HN ตัวเลข 990…) + `PARSER_VERSION` |
| `packages/jobs/worker.ts` | `synthetic_scan` → `runInboundCycle`; Job ใหม่ `synthetic_inbound_test`; payload `trigger/lookbackDays/actorId` |
| `src/app/api/synthetic/scan/route.ts` | payload `{trigger:"MANUAL",actorId}` |
| `src/app/(protected)/health/page.tsx` | ลิงก์ไป `/inbound` |
| `tools/prepare-db.ts` | รัน `packages/db/roles-p3.sql` หลัง `roles.sql` |

**ไม่แตะไฟล์ที่ Codex กำลังแก้:** `navigation.tsx`, `(protected)/layout.tsx`, `globals.css`, หน้า cases, README, docs ของ P1/P2, `roles.sql`, `docs/migrations.md`

## 5. Schema Delta (Additive — `db/migrations/090_p3_his_inbound.sql`)

SHA-256 (LF): `acd225953a7cce8e4a084ee6db06eb99a211ff7c770dde3392b040e243bbbadf` — Migration 001–005 ไม่ถูกแก้

- `his_inbound_file`: ขยาย CHECK state (`ParseError`, `DuplicateSameContent`, `Unlinked`, `S1IntegrityEvent`, `HistoricalIntake`); เพิ่ม `ln`, `source_path`, `path_version`, `byte_size`, `parser_version`, `error_code`, `case_id`, `discovered_at`, `processed_at`; `parsed` เก็บ P[33] เป็น HMAC + 4 หลักท้ายเท่านั้น (ไฟล์ที่ Worker เดิมของ P1 เขียนยังเก็บค่าดิบ — ไม่ถูกเรียกแล้ว)
- ตารางใหม่: `his_inbound_source` (PK path+sha, immutable), `his_inbound_waiting`, `his_inbound_scan_run` (immutable), `his_intake_issue` (lineage guard, ห้ามลบ/เปิดใหม่), `his_intake_issue_event` (append-only, trigger สองคน)
- Trigger `p3_worker_round_guard` บน `specimen_round`: สมาชิก `worker_rw` เขียน round ≥ 2 ไม่ได้ (Superuser/`app_rw` ไม่ได้รับผล)
- Grants แยกใน `packages/db/roles-p3.sql` (ทดสอบแล้วว่า Worker cycle ทั้งวงรันได้ด้วย `worker_rw` และ Registration+Link ด้วย `app_rw`)
- **เลข 090 ตั้งใจหลบ P2 (006/007)** — ตอน Integrate ให้เปลี่ยนเป็นเลขถัดจาก Migration สุดท้ายของ P2 (ฐานข้อมูลที่เคย Apply 090 เป็น Disposable ทั้งหมด) และย้ายเนื้อหา `roles-p3.sql` เข้า `roles.sql`

## 6. ผลการทดสอบ (รันจริงในเครื่อง, 2026-10-12)

| ชุด | ผล |
| --- | --- |
| `npm run typecheck` / `npm run lint` | PASS / PASS (0 warning) |
| `npm test` (PGlite, ไม่ตั้ง native DB) | **884 passed, 3 skipped** (P1 baseline 851 passed — ไม่ลดลง) |
| `npm test` + `NIPT_TEST_DATABASE_URL` (DB ของ P3) | **888 passed, 1 skipped** (skip = Differential ที่เป็น opt-in) — รวม P1 native smokes และ P3 native |
| `smoke-p3-inbound.ts` (native, สุ่มลำดับ) | **PASS 6/6 รอบ** — 12 LN แข่งกันจริง (`nipt_web` ลงทะเบียน+Link vs `nipt_worker` Apply + replay + aborted txn), Worker จริง (pg-boss, login `nipt_worker`) Scan/Test Connection/Share หลุด |
| AT-HISIN-02 Differential (Python legacy `parse_pet_file`, 100 ไฟล์สมมติ) | **PASS** (opt-in: `NIPT_LEGACY_PET_PARSER_DIR`) |
| `npm run build` | PASS — 3 tracing warnings (เท่ากับ P1 baseline) |
| `npm run guard` | PASS |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Playwright (local, Windows, `E2E_BASE_URL=http://127.0.0.1:3300`) | **12 passed** (P1 7 รวม Visual baseline + P3 5: axe AA 375/768/1280, ไม่มี horizontal scroll, Admin/ANC permission) |
| Mutation check ของ Property test | ใส่ Bug ให้แตะ round 2 → fast-check ล้มพร้อม Counterexample แล้ว Restore |

Acceptance mapping (Synthetic): AT-HISIN-01, 03, 04, 05, 06, 07, 08, 09, 10, 11 · AT-HISIN-02 (opt-in) · AT-ID-REG-01 · AT-LIN-03 · AT-LIN-08 · AT-LDR-02 · AT-LDR-08 (PGlite ทุกลำดับ + native concurrency) — **AT-HISIN-LAN-01 ไม่ได้ทำ (ต้อง AL-3)**

CI บน GitHub: ดูผล Workflow `Synthetic foundation` ของ Draft PR (ไม่อ้างในเอกสารนี้จนกว่าจะเห็นผลจริง)

## 7. จุดที่ต้องรอ P2 ก่อน Integrate

1. **เรียก `linkIntakeAtRegistration` ใน `registerP2`** ภายใน Transaction เดียวกันหลัง `registerCase` (ส่ง `hn`, `identifierSource`, `actorId`) — ระหว่างรอ Worker rematch ให้ผลสุดท้ายเดียวกัน แต่ D-49 ต้องการ Transaction เดียว
2. **หน้าลงทะเบียน Lab (P2):** ใช้ `intakePresence` เพื่อบอกเพียง "มี/ไม่มี Intake" และเพิ่มช่อง "แหล่งของตัวระบุ" (`TUBE_LABEL` / `REQUEST_FORM` / `PATIENT_DOCUMENT`)
3. **Identity source:** `defaultIdentitySource` ใช้ `p2_case_identity.hn` อัตโนมัติเมื่อมีตารางนั้น (ไม่มี HN → `IDENTITY_UNVERIFIED`) — ยืนยันกับ Schema P2 สุดท้าย
4. **Compose:** Service `web` ยังไม่ Mount secret `identity_lookup` (P2 ใช้ `IDENTITY_LOOKUP_KEY_FILE` ใน Web เช่นกัน)
5. **Migration:** Renumber 090 + รวม Grants เข้า `roles.sql`; ตรวจ `p3_worker_round_guard` ไม่ขวางเส้นทาง P2/P4
6. **Navigation:** เพิ่มเมนู `/inbound` (ตอนนี้ลิงก์จาก `/health` เพื่อไม่ชนไฟล์ที่ Codex แก้)
7. **Resolution ที่ต้องใช้ P2:** `accept_his`, `create_case`, `new_generation` (LN รุ่น 2, AT-LIN-03 ส่วนสร้าง Case ใหม่), การแก้ LN พิมพ์ผิด — ปิดไว้ (ไม่มีใน UI/API)
8. **ถอด P1 `scanSimulator`/`applyPet`** หลังย้าย `smoke-pet` มาใช้เส้นทาง P3
9. รัน Regression + E2E ใหม่ทั้งหมดหลัง Rebase บน P2 ล่าสุด แล้วจึงทำ P3 Acceptance (Matching E2E กับ Case จาก P2) และ LAN Shadow หลัง AL-3

## 8. ข้อจำกัดและความเสี่ยงที่ยังเปิด

- Q-I1 (Root path จริง, สัญญาณยกเลิก/ปฏิเสธในไฟล์) ยังไม่ทราบ — ใช้ Simulator path เท่านั้น
- OD-15 ใช้ขอบเขต AL-2: LN + HN (DOB เทียบเมื่อผู้ลงทะเบียนกรอก); ยังไม่มีเกณฑ์เทียบชื่อไทย จึงไม่เทียบชื่อ
- Lab ID / คิวฉลากหลัง Match (§10.2 ข้อ 8) และ "เข้ารายการงาน Lab" รอ OD-03 / P4
- Unique LN-Active ตาม Q-I1 ยังไม่บังคับ (ตาม §6.4)
- `parsed` (ชื่อ/HN/DOB) ยังเป็น Plaintext ใน DB สมมติ — การเข้ารหัสระดับคอลัมน์สำหรับข้อมูลจริงต้องตัดสินก่อน PHI
- ParseError เก็บเฉพาะ Hash/รหัส (ไม่เก็บ Bytes) — แก้ Parser แล้วต้อง Deep scan อ่านจาก Share ใหม่
- Usability/UAT จริงของหน้า `/inbound` ยังไม่ได้ทำ (มีเพียง axe อัตโนมัติ)

## 9. วิธีรัน (เครื่องพัฒนา, Synthetic)

```bash
npm ci && npx tsx tools/init-dev.ts            # ตั้ง .env.local ให้ชี้ DB/Port ของตนเองก่อน
npx tsx tools/prepare-db.ts && npx tsx tools/seed.ts
npm test                                        # + NIPT_TEST_DATABASE_URL=… สำหรับ native
SIMULATOR_ROOT=./data/p3-demo npx tsx tools/his-simulator/p3-scenarios.ts
SIMULATOR_ROOT=./data/p3-demo npx tsx tools/his-simulator/p3-demo-cycle.ts
NIPT_LEGACY_PET_PARSER_DIR=<legacy>/source/app/services npx vitest run tests/contracts/p3-legacy-differential.test.ts
```
