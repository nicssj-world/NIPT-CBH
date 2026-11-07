# Fast Development Pipeline — คู่มือปฏิบัติ

คู่มือนี้คือจุดเริ่มต้นของการพัฒนาและ Release ของ NIPT-CBH บน Windows 11 / Windows Server ในโรงพยาบาล เขียนสำหรับผู้พัฒนา ผู้ดูแลระบบ และ Codex/Claude ในเซสชันถัดไป คำสั่งทุกคำสั่งในเอกสารนี้ตรงกับสคริปต์ที่มีอยู่จริงใน Repository

## 1. สถาปัตยกรรมและเป้าหมาย

**ปัญหาเดิม** (วัดจาก `C:\NIPT-CBH\deploy\history`, ดูข้อ 14): การแก้บั๊กหนึ่งครั้งต้องผ่าน commit → worktree ใหม่ → `npm ci` → validation → `next build` → stage/hash/sign → upgrade → backup → migration → restart → health เมื่อ validation ล้มเหลว (เช่น test เดียวที่ล้มแบบ deterministic) ก็ต้องทำซ้ำทั้งหมด วันที่ 2 พ.ย. 2026 มี deployment 27 ครั้ง ล้มเหลว 15 ครั้ง ใช้เวลาไปกับครั้งที่ล้มรวม 201 นาที

**หลักการใหม่:** ความผิดพลาดแบบ deterministic ต้องถูกพบ *ในเครื่องภายในวินาทีถึงไม่กี่นาที* ก่อนจะสร้าง package ใดๆ

```
DEVELOP        แก้โค้ด → Hot Reload → npm run dev:verify → แก้ → ซ้ำ     (ไม่ commit, ไม่ build package, ไม่แตะ installer)
PRE-RELEASE    commit สะอาด → npm run release:preflight → Release Candidate
STAGING        deploy-staging.ps1  — เมื่อนโยบายต้องการเท่านั้น (integration / installer / release verification)
PRODUCTION     deploy-production.ps1 — ผู้ดูแลระบบ + อนุมัติจาก Owner เท่านั้น
```

ความล้มเหลวในขั้น DEVELOP กลับไปที่ลูปในเครื่อง ไม่ใช่เริ่มขั้นตอน deployment ใหม่ ความล้มเหลวจริงของ installer/runtime เก็บ log และหลักฐานไว้ใน `C:\NIPT-CBH\deploy\history\<env>\<run>\` (`run.log`, `record.json`) เพื่อวิเคราะห์ซ้ำโดยไม่ต้อง upgrade ซ้ำ

### สิ่งที่นำของเดิมมาใช้ (ไม่ได้สร้างซ้ำ)

| ความสามารถ | ของเดิมที่ใช้ |
|---|---|
| Migration engine (forward-only, checksum, advisory lock) | `tools/migrate.ts` — rehearsal เรียกใช้ตัวเดียวกันบน PGlite (PostgreSQL ใน memory) |
| ตรวจ SQL ทำลายข้อมูล | `destructiveStatements` ใน `deploy/windows/deploy-gates.mjs` |
| จัดระดับความเสี่ยง LOW/MEDIUM/HIGH | `deploy/windows/risk-classification.mjs` (ไม่ถูกแก้ ไม่ผ่อนปรน) |
| ตรวจ environment แยก Staging/Production | `validateEnvironmentPair` |
| ลงนาม package Ed25519 / manifest SHA-256 | `tools/win-installer/build-package.ts`, `lib.mjs` (รูปแบบ manifest ไม่เปลี่ยน) |
| Backup ก่อน upgrade, rollback, health | `tools/win-installer/nipt-admin.mjs` (ไม่ถูกแก้) |

### สิ่งที่เพิ่มใหม่

| คำสั่ง | หน้าที่ | ไฟล์ |
|---|---|---|
| `npm run dev:setup` | เตรียม workspace แยก: คีย์สังเคราะห์, PostgreSQL 17 ส่วนตัว, migration, seed | `tools/dev/setup.mjs` |
| `npm run dev` / `dev:up` / `dev:down` | Next.js dev server (Hot Reload), Worker, Renderer, Simulator | `tools/dev/up.mjs`, `down.mjs` |
| `npm run dev:test -- <ไฟล์>` | รัน test เฉพาะไฟล์ในสภาพแวดล้อม dev (`--watch` ได้) | `tools/dev/test.mjs` |
| `npm run dev:verify` | ตรวจเฉพาะไฟล์ที่เปลี่ยน | `tools/dev/verify.mjs`, `select.mjs` |
| `npm run release:preflight` | ประตูก่อน Release | `tools/release/preflight.mjs`, `checks.mjs` |
| `npm run perf:report` | รายงานเวลาจาก history จริง | `tools/release/perf-report.mjs` |
| (ในสคริปต์ deploy) preflight ก่อน package | `Invoke-NiptPreflight` | `deploy/windows/NiptDeploy.psm1` |
| Build stamp + cache | `--skip-build` ใช้ `.next` เดิมได้เมื่อพิสูจน์ได้ว่าเป็น commit/อินพุตเดียวกัน | `tools/release/build-stamp.mjs` |

## 2. Development / Preflight / Staging / Production ต่างกันอย่างไร

| | Development | Preflight | Staging | Production |
|---|---|---|---|---|
| ข้อมูล | สังเคราะห์เท่านั้น | ไม่มีฐานข้อมูลจริง (PGlite ใน memory) | สังเคราะห์ (45 ผู้ป่วยทดสอบ) | ผู้ป่วยจริง |
| Web | 127.0.0.1:3100 | ไม่รัน | 3010 / HTTPS 8443 | 3000 / HTTPS 443 (LAN) |
| ฐานข้อมูล | 127.0.0.1:55452 `nipt_synthetic_dev` | — | 55442 | 55432 |
| ไฟล์ | `.local/dev/data` | `.local/release` | `C:\NIPT-CBH\staging` | `C:\NIPT-CBH\production` |
| HIS/NAS | **ไม่มี** (ตัวจำลองใน `.local/dev` เท่านั้น) | ไม่แตะ | Simulator / egress ถูกบล็อก | HIS จริง |
| สร้าง package ลงนาม | ไม่ | ไม่ | ใช่ (คีย์ Staging) | ใช่ (คีย์ Production) |
| ใช้เมื่อ | ทุกครั้งที่แก้โค้ด | ก่อนเตรียม Release | ตามนโยบาย Release | หลังอนุมัติ Owner |

## 3. ตั้งค่าครั้งแรก (one-time)

ต้องการ: Node 24 (บนเซิร์ฟเวอร์: `C:\NIPT-CBH\toolchain\node`), Git, PostgreSQL 17 binaries (`C:\Program Files\PostgreSQL\17` หรือ `NIPT_PG_HOME`)

```powershell
$env:Path = "C:\NIPT-CBH\toolchain\node;$env:Path"   # เฉพาะบนเซิร์ฟเวอร์ที่ node ไม่อยู่ใน PATH
cd D:\NIPT-CBH
npm ci
npm run dev:setup
```

`dev:setup` ทำซ้ำได้ (idempotent) และทำสิ่งต่อไปนี้ภายใน `.local/dev` (ไม่เข้า Git):

1. สร้างคีย์และ secret สังเคราะห์แบบสุ่ม (ใช้ `tools/init-dev.ts`)
2. สร้าง PostgreSQL cluster ส่วนตัว `127.0.0.1:55452` (shared_buffers 64 MB, 30 connections — จำกัดเพื่อไม่แย่งทรัพยากรบริการโรงพยาบาลบนเครื่องเดียวกัน)
3. สร้างฐานข้อมูล `nipt_synthetic_dev` พร้อม migration จริง, login สิทธิ์ต่ำ และข้อมูล seed (`synthetic.admin`, `synthetic.lab`, `synthetic.anc` … รหัสผ่านอยู่ที่ `.local/dev/data/secrets/seed-password`)

ตัวเลือก: `npm run dev:setup -- --reset-db` (ทิ้งและสร้าง `nipt_synthetic_dev` ใหม่เท่านั้น), `--skip-seed`

## 4. Codex / Claude ควรทำงานอย่างไรในเซสชันถัดไป

1. อ่าน `README.md` (ส่วน *Development & Deployment — Start Here*), `AGENTS.md` และคู่มือนี้ก่อนแก้โค้ด
2. ตรวจ `git status` / branch ก่อน — working tree อาจใช้ร่วมกับผู้อื่น ห้ามย้อนหรือ commit งานที่ไม่ใช่ของตน
3. แก้ → `npm run dev:verify` → แก้ → ซ้ำ ใช้ `npm run dev:test -- <ไฟล์>` ตรวจเฉพาะจุด
4. **ห้าม** รัน `npm test` ทั้งชุด, `deploy-staging.ps1`, `build-package.ts` หรือ installer เพียงเพื่อตรวจการแก้ไขทั่วไป
5. เมื่อพร้อมเตรียม Release: commit สะอาด → `npm run release:preflight` → ส่ง commit SHA และผลให้ Owner/ผู้ดูแลระบบ
6. ห้ามแตะ Production ถ้า Owner ไม่ได้อนุมัติในเซสชันนั้นอย่างชัดเจน
7. รายงานผลตามจริง: `BLOCKED` ไม่ใช่ `PASS`

## 5. วงจร edit / test / debug

```powershell
npm run dev                          # terminal 1: http://127.0.0.1:3100 (Fast Refresh เมื่อบันทึกไฟล์)
npm run dev:verify                   # terminal 2: ไฟล์ที่เปลี่ยนเทียบ HEAD (รวม untracked)
npm run dev:verify -- --base main    # ทั้ง branch เทียบ main
npm run dev:verify -- --files packages/p2/service.ts,tests/db/anc-owner-registry.test.ts
npm run dev:verify -- --only typecheck,lint
npm run dev:verify -- --related       # เพิ่ม test ทุกไฟล์ที่ import ไฟล์ที่แก้ (ช้าสำหรับโมดูลแกนกลางอย่าง packages/p2)
npm run dev:verify -- --json          # ผลแบบ machine-readable
npm run dev:test -- tests/unit/p2-pdf.test.ts -t "ชื่อ test"
npm run dev:test -- --watch tests/unit/pdf.test.ts
```

`dev:verify` เลือกตรวจตามไฟล์ที่เปลี่ยน (กฎใน `tools/dev/select.mjs`):

| ไฟล์ที่เปลี่ยน | สิ่งที่รัน |
|---|---|
| `.ts/.tsx` | `tsc --noEmit` (incremental) ; `next typegen` เมื่อแก้ `src/app/**` |
| `.ts/.tsx/.mjs/.js` | ESLint เฉพาะไฟล์ที่แก้ (cache), `--max-warnings 0` |
| test ที่แก้ + ชุด test ของพื้นที่ที่แตะ | vitest (พื้นที่: pdf, worker, his, registration, database, historical, results) |
| `deploy/`, `tools/win-installer/`, `tools/dev/`, `tools/release/`, `tests/deploy/`, `package*.json` | `node --test tests/deploy/*.node.mjs` |
| `db/migrations/`, `tools/migrate.ts` | migration rehearsal (ข้อ 7) |
| `package*.json`, `next.config.*`, `tsconfig.json` | ตรวจ dependency ตรงกับ lockfile |

ผลลัพธ์: `PASS`, `FAIL`, `BLOCKED` (ขาด prerequisite — ไม่นับเป็นผ่าน) และ `skip` exit code: 0 / 1 / 2 ความล้มเหลวแสดง **stage, command, exit code, output ท้ายสุด, ระยะเวลา, commit, environment, คำแนะนำถัดไป และ retry ได้ปลอดภัยหรือไม่** พร้อม log เต็มที่ `.local/dev/runs/<run>/` และรายงาน `verify.json`

## 6. ทดสอบ API / Worker / PDF / Database

| งาน | วิธี |
|---|---|
| API / หน้าเว็บ | `npm run dev` แล้วเปิด 127.0.0.1:3100 ; test ของ route ใน `tests/unit`, `tests/db`, `tests/permissions` |
| Worker | `npm run dev:up -- web worker` (หรือ `worker --inspect` ต่อ debugger ที่ 127.0.0.1:9330) ; Worker ใช้คิวของ `nipt_synthetic_dev` เท่านั้น ; test: `npm run dev:test -- tests/unit/storage-worker.test.ts` |
| PDF Renderer | `npm run dev:up -- renderer` (127.0.0.1:3101, `--inspect` ที่ 9331) ; test: `npm run dev:test -- tests/unit/p2-pdf.test.ts` ; แก้ `packages/pdf/**` แล้ว `dev:verify` จะรันชุด PDF ให้อัตโนมัติ |
| HIS/PET simulator | `npm run dev:up -- simulator` สร้างคู่ PET/OK สังเคราะห์ใน `.local/dev/data/simulator` เท่านั้น |
| Database | test ส่วนใหญ่ใช้ PGlite ใน memory (ไม่ต้องมี server) ; dev server ใช้ `nipt_synthetic_dev` ; ล้างข้อมูล dev: `npm run dev:setup -- --reset-db` ; หยุด PostgreSQL ของ dev: `npm run dev:down` |
| Migration ใหม่ | เพิ่มไฟล์เลขถัดไปใน `db/migrations/` แล้ว `npm run dev:verify -- --base main` |

## 7. Migration Safety

`node --import tsx tools/dev/migration-check.mjs --base <ref>` (เรียกโดย `dev:verify` และ `release:preflight`) ทำบน PostgreSQL ใน memory เท่านั้น — เชื่อมต่อฐานข้อมูลจริงไม่ได้:

1. apply ทุก migration บน DB ว่าง
2. รันซ้ำ → ต้องไม่ apply ซ้ำ (ledger และ `applied_at` ต้องเหมือนเดิม)
3. แก้ migration ที่ apply แล้ว (ในสำเนา) → ถูกปฏิเสธ (`Migration checksum mismatch`)
4. ลบ migration ที่ apply แล้ว / เพิ่มเลขย้อนหลัง → ถูกปฏิเสธ
5. `--base`: apply migration ของ `<ref>` ก่อน แล้ว apply ส่วนที่ค้าง → ตรวจว่ารันบน schema ที่มีอยู่จริง
6. migration ที่มีอยู่ใน `<ref>` ถูกแก้/ลบ/เปลี่ยนชื่อ → ล้มเหลว (migration ที่ apply แล้วแก้ไม่ได้ ให้เพิ่มเลขใหม่)
7. ระบุ SQL ทำลายข้อมูล (DROP/TRUNCATE/DELETE/ALTER…) ใน migration ที่ค้าง — ต้องได้รับอนุมัติชัดเจนก่อน Production (`-AllowDestructiveMigration`)

หลักฐานเป็น test ถาวร: `tests/db/migration-rehearsal.test.ts`

## 8. เตรียมและตรวจ Release Candidate

```powershell
git status                              # ต้องสะอาด
npm run release:preflight               # ครบทั้งชุด รวม build (ใช้เวลาตาม build)
npm run release:preflight -- --base <commit ที่ติดตั้งอยู่>   # เทียบกับรุ่นที่ติดตั้งจริงเพื่อให้ risk/migration ที่ค้างถูกต้อง
npm run release:preflight -- --no-build # ข้าม build (รายงานเป็น SKIPPED ไม่ใช่ PASS)
npm run release:preflight -- --full     # + vitest ทั้งชุด (release qualification)
npm run release:preflight -- --stage predeploy --env production   # เฉพาะชุดตรวจเร็วก่อน package (เหมือนที่สคริปต์ deploy เรียก)
```

ตรวจ: commit สะอาดและแน่นอน, Node ตาม `engines`, dependency ตรง lockfile, ไม่มีไฟล์ HIS/ผู้ป่วยใน Git, ดิสก์/หน่วยความจำ, master workbook และแบบฟอร์ม ANC ตรง SHA-256 ที่ pin, นิยาม Staging/Production แยกกัน (root, port, คีย์, account), คีย์ลงนามพร้อม (ไม่อ่านเนื้อคีย์), release ID, migration inventory + rehearsal + SQL ทำลาย + ชั้น rollback, ระดับความเสี่ยง, tsc/eslint/deploy contracts/test ที่เกี่ยวข้อง และ `next build` พร้อม build stamp ผลเขียนที่ `.local/release/runs/<run>/preflight.json` และ `.local/release/preflight/<commit>.<stage>.json`

exit code 1 (FAIL) หรือ 2 (BLOCKED) = **ห้ามเลื่อนไปขั้น release**

**Build stamp:** หลัง build สำเร็จจะเขียน `.next/nipt-build-stamp.json` (commit, digest ของ lockfile/Node/next.config/tsconfig/package.json, `BUILD_ID`, hash ของ `server.js`) `build-package.ts --skip-build` ปฏิเสธ `.next` ที่ stamp ไม่ตรง (`STALE_BUILD_OTHER_REVISION`, `STALE_BUILD_INPUTS_CHANGED`, `STALE_BUILD_ID_CHANGED`, …) จึงไม่มีทางนำ `.next` หรือ `BUILD_ID` ของ commit อื่นไปทำ package

## 9. Upgrade Staging (เมื่อจำเป็น)

เฉพาะเมื่อนโยบายต้องการ integration/installer/release verification ไม่ใช่เพื่อทดสอบการแก้ทั่วไป ทำบนเซิร์ฟเวอร์ใน PowerShell ผู้ดูแลระบบ:

```powershell
C:\NIPT-CBH\deploy\start-staging.ps1 -Reason "UAT ของ <งาน>"
C:\NIPT-CBH\deploy\deploy-staging.ps1 -Ref <commit> -RunJourney
C:\NIPT-CBH\deploy\staging-status.ps1
```

สคริปต์จะเรียก preflight (ชุด predeploy) **ก่อน** สร้าง package — ถ้าไม่ผ่านจะหยุดทันทีพร้อมเหตุผล ไม่ build/ลงนาม/ติดตั้ง

**ข้อสำคัญ:** สคริปต์ที่ทำงานคือสำเนาใน `C:\NIPT-CBH\deploy` การเปลี่ยน `deploy/windows/*` ใน Git จะมีผลหลังผู้ดูแลระบบรัน `deploy\windows\Install-DeployTools.ps1` เท่านั้น (ขั้นตอนที่ตั้งใจให้ทำเอง)

## 10. Deploy Production ตามนโยบายเดิม

ต้องได้รับอนุมัติจาก Owner ทุกครั้ง นโยบายเดิมไม่เปลี่ยน (ระดับความเสี่ยง LOW/MEDIUM/HIGH จากไฟล์ที่ต่างจากรุ่นที่ติดตั้ง, ตรวจสอบ commit ที่แน่นอน, backup ที่ตรวจแล้วก่อน upgrade, ข้อความยืนยัน, rollback อัตโนมัติ)

```powershell
C:\NIPT-CBH\deploy\deploy-production.ps1 -Commit <sha40> -ApprovedBy "<ชื่อ>" -ChangeReference "<เลขที่>"
```

ผู้ช่วย AI ห้ามรันคำสั่งนี้เอง

**`-SkipValidationReason "<เหตุผล>"`** (ตัวเลือกของ Owner สำหรับข้ามชุด test ที่ใช้เวลานาน) ข้ามเฉพาะ *การรัน test* เท่านั้น: ยังติดตั้ง dependency และรัน deploy contracts, **ยังรัน preflight ก่อน package ทุกครั้ง** (migration rehearsal, SQL ทำลาย, asset ที่ pin SHA-256, คีย์ลงนาม, การแยก environment), ยัง build จาก commit ที่แน่นอน, ลงนาม, backup ที่ตรวจแล้ว, migration, health check และ rollback ครบ — preflight อยู่หลังการตัดสินใจข้าม จึงไม่มีตัวเลือกใดข้ามได้ (ล็อกด้วย `tests/deploy/skip-validation-contract.node.mjs`) เหตุผลถูกบันทึกใน `run.log` และ `record.json`

ลำดับมาตรฐาน: **แก้ → `dev:verify` → แก้ → `release:preflight` → package → deploy** ห้ามใช้ Staging/Production upgrade เป็นเครื่องมือ debug

## 11. เมื่อ build / migration / health ล้มเหลว

| อาการ | ทำอย่างไร |
|---|---|
| `dev:verify` FAIL | อ่านบล็อก `reason / command / output / next` แก้แล้วรันซ้ำ (`--only <ขั้น>`); log เต็มที่ `.local/dev/runs/<run>/<ขั้น>.log` |
| test ล้มเหลว | `npm run dev:test -- <ไฟล์> -t "<ชื่อ>"` |
| `release:preflight` FAIL/BLOCKED | แก้ตาม `hint`; อย่าแก้ pin SHA-256, gate หรือ risk rule เพื่อให้ผ่าน; BLOCKED = ขาดสิ่งที่ต้องมี (asset/คีย์/นิยาม environment) ให้รันบนเซิร์ฟเวอร์ที่มี |
| `PREFLIGHT_FAILED` ใน deploy | ไม่มีอะไรถูก package/ติดตั้ง ปลอดภัยที่จะรันซ้ำหลังแก้ |
| `VALIDATION_FAILED` ใน deploy | ทำซ้ำในเครื่องด้วย `npm run dev:test -- <ไฟล์ที่ล้ม>` (ชื่อไฟล์อยู่ใน `run.log`) แล้วแก้ใน loop ปกติ — อย่า deploy ซ้ำเพื่อดูว่าเสียอะไร |
| `STALE_BUILD_*` | `.next` ไม่ใช่ของ commit นี้ ปล่อยให้ build ใหม่ (อย่าลบ stamp หรือข้ามการตรวจ) |
| `Migration checksum mismatch` | มีผู้แก้ migration ที่ apply แล้ว คืนไฟล์จาก Git แล้วเพิ่ม migration เลขใหม่ |
| upgrade ล้ม / health ไม่ผ่าน | engine rollback ไปรุ่นก่อนอัตโนมัติ ; อ่าน `C:\NIPT-CBH\deploy\history\<env>\<run>\run.log` และ `record.json` (`error`, `afterFailure`) ; `npm run perf:report` บอกว่าล้มที่ขั้นไหน |

## 12. Cache และการล้างอย่างปลอดภัย

| Cache | ที่อยู่ | คีย์ | ล้างอย่างไร |
|---|---|---|---|
| npm download cache | `C:\NIPT-CBH\source\cache\npm` (build ของ deploy) | npm จัดการเอง (integrity hash) | ลบโฟลเดอร์ได้ ปลอดภัย (ดาวน์โหลดใหม่) |
| Next/Turbopack compilation cache | `C:\NIPT-CBH\source\cache\next\<key>` (build ของ deploy) และ `.next/cache` (ในเครื่อง) | Next + Node + platform + sha256(package-lock.json) ; เก็บ 3 ชุดล่าสุด ; เขียนแบบ temp→rename (ไม่มีครึ่งๆ กลางๆ) | ลบโฟลเดอร์ได้ ปลอดภัย (build ช้าลงครั้งเดียว) ไม่มี `BUILD_ID`/output อยู่ใน cache |
| ESLint cache | `.local/dev/eslint.cache`, `.local/release/eslint.cache` | เนื้อไฟล์ | ลบได้ |
| TypeScript incremental | `tsconfig.tsbuildinfo` | tsc จัดการเอง | ลบได้ |
| node_modules ของ worktree | ตาม worktree ; deploy ข้าม `npm ci` เมื่อ lockfile+Node เดิม | sha256(lockfile)+Node | ลบ worktree เก่าใน `C:\NIPT-CBH\source\builds` ที่ไม่ใช้แล้วด้วย `git worktree remove` |

ไม่มีการ reuse `.next`/`BUILD_ID` ข้าม commit และไม่มีการข้ามการตรวจ hash/ลายเซ็น

## 13. Rollback และ Recovery

- รุ่นที่ไม่มี migration ค้าง: `C:\NIPT-CBH\deploy\rollback-production.ps1 -Reason "<เหตุผล>"` (สลับกลับรุ่นก่อน ข้อมูลและหลักฐานคงอยู่) — เฉพาะผู้ดูแลระบบ + Owner อนุมัติ
- รุ่นที่มี migration ค้าง: rollback เฉพาะแอปทำไม่ได้ (engine ปฏิเสธด้วย `ROLLBACK_REQUIRES_DATABASE_RESTORE`) การกู้คืนคือ restore จาก backup ที่ตรวจแล้วก่อน upgrade ตามขั้นตอนใน `UPGRADE-GUIDE.md` `release:preflight` แสดงชั้น rollback นี้ไว้ล่วงหน้า (`Rollback compatibility`)
- Development: ข้อมูลสังเคราะห์สร้างใหม่ได้เสมอ `npm run dev:setup -- --reset-db`

## 14. รายงานเวลาและการแก้ปัญหาประสิทธิภาพ

```powershell
npm run perf:report -- --since 2026-11-02          # อ่าน C:\NIPT-CBH\deploy\history (อ่านอย่างเดียว) → .local/release/perf-report.json
npm run perf:report -- --env production --package-perf <perf.json>
node --import tsx tools/win-installer/build-package.ts … --perf-out <perf.json>   # เวลาต่อ phase ของการสร้าง package
```

### ผลวัดจริง (ไม่ใช่ค่าประมาณ)

**A. Baseline จาก history จริงบนเซิร์ฟเวอร์** (`npm run perf:report -- --since 2026-11-02`, 27 deployment): สำเร็จ 12 / ล้มเหลว 15 ; รอบสำเร็จมัธยฐาน 9m40s ; เวลาที่หมดไปกับรอบที่ล้ม 201m ; มัธยฐาน (สูงสุด) ต่อขั้น: package (build+stage+hash+sign) 6m41s (55m30s), engine upgrade/install 1m40s (7m55s), `npm ci` 1m07s (1m31s), typecheck/lint/tests 0m59s (20m14s) ; ล้มที่ขั้น package 7, engine 4, typecheck/lint/tests 3, ก่อนเริ่ม 1 สองรอบ Production ล่าสุด (18–22 นาทีต่อรอบ) ล้มเพราะ test เดียวกัน (`tests/db/anc-owner-registry.test.ts`) ที่รันได้ในเครื่องใน 6 วินาที

**B. Package app-only (profile test) บนเครื่องเดียวกัน worktree ใหม่ทุกครั้ง** (วัดเมื่อ 3 พ.ย. 2026, รันครั้งเดียวต่อกรณี):

| กรณี | `npm ci` | package รวม | next build | stage | hash+sign |
|---|---|---|---|---|---|
| Baseline (`e4dba20`, ก่อนปรับ) | 75.9 s | **500.2 s** | ไม่ได้แยก phase | | |
| ปรับแล้ว, compilation cache ว่าง | 83.9 s | **222.1 s** | 45.5 s | 76.0 s | 98.4 s |
| ปรับแล้ว, restore compilation cache | 78.3 s | **204.2 s** | 42.5 s | 63.8 s | 95.0 s |

สาเหตุหลักที่วัดได้แยกต่างหาก: hash ไฟล์ package 21,903 ไฟล์ที่เพิ่งเขียนใหม่ (ผลเหมือนกันทุกไบต์ → manifest/ลายเซ็นเข้ากันได้): แบบทีละไฟล์ **301.5 s** เทียบแบบ concurrent **88.8 s** ; เมื่อไฟล์อยู่ใน cache ของ OS แล้วเพียง 4.4–5.1 s เทียบ 1.7–2.0 s (ต้นทุนหลักคือการอ่านไฟล์ใหม่ครั้งแรก เช่นการสแกนของ antivirus ไม่ใช่ CPU)

ข้อจำกัดที่ต้องรู้: Turbopack compilation cache ลด `next build` ได้เพียง ≈3 s (45.5→42.5 s) เพราะ worktree ใหม่ทุก commit ; `npm ci` ไม่เร็วขึ้น (npm cache ของผู้ใช้เดิมอุ่นอยู่แล้วทั้งสองกรณี) ; การคัดลอก `node_modules` เข้า package ใช้ ≈64–76 s และ hash+sign ยังเหลือ ≈90 s ซึ่งเป็นต้นทุนการอ่านไฟล์ใหม่ ; baseline รันก่อน จึงมีความไม่แน่นอนเรื่อง cache ของ OS ; **ขั้น engine (backup, migration, สลับ release, start, health) ไม่ได้ถูกแก้ ไม่ได้วัดซ้ำ** (มัธยฐาน 1m40s, Production รวม backup สูงสุด ≈8 นาที)

**C. Fast loop** (เครื่องเดียวกัน): `dev:verify` หลังแก้ `packages/p2/service.ts` (tsc + eslint + 10 ไฟล์ test ของพื้นที่ registration) **61 s** (เทียบ 18–22 นาทีของ validation ใน Production) ; แก้เล็กน้อยแล้วตรวจซ้ำ **6.1 s** ; test ที่ตั้งใจให้ล้มถูกรายงานที่ขั้น test ใน **9 s** (รอบแรกรวม 77 s เพราะ tsc/eslint cache เย็นหลัง benchmark) ; migration rehearsal 5–14 s ; `release:preflight --stage predeploy` (14 การตรวจ รวมแอสเสตจริงและนิยาม environment แบบอ่านอย่างเดียว) **5.4 s** ; `dev:setup` (cluster ถูกสร้างแล้ว: สร้างฐานข้อมูล + migration 109 ไฟล์ + seed) 7 s

## 15. HIS / NAS / ฐานข้อมูล: กฎการแยก

`tools/dev/dev-env.mjs` บังคับกฎเหล่านี้ทุกครั้งที่ start service ของ dev (และ `dev:verify`/`dev:test`) — ฝ่าฝืนข้อใดข้อหนึ่งจะไม่ start:

- `NIPT_MODE=synthetic` ; ต้องไม่มี `NIPT_ENVIRONMENT` ; ต้องไม่มีตัวแปร HIS/operational (`HIS_*`, `PET_*`, `RES_*`, `NIPT_OPERATIONAL_*`)
- host ต้องเป็น loopback เท่านั้น (`127.0.0.1`/`localhost`/`::1`) ; ห้ามพอร์ตของ Staging/Production (3000, 3001, 3010, 3011, 443, 8443, 55432, 55442, 5432, 5433 และพอร์ตจากนิยาม environment บนเครื่อง)
- ฐานข้อมูลต้องชื่อ `nipt_synthetic_dev*` เท่านั้น
- ทุก path (ไฟล์, simulator, คีย์) ต้องอยู่ใน `.local/dev` ห้าม UNC ห้ามอยู่ใน `C:\NIPT-CBH\production|staging`
- Worker ของ dev ใช้คิวในฐานข้อมูล dev เท่านั้น ไม่มีเส้นทาง HIS inbound/outbound ; ไม่มีการส่ง RES/OK/PDF ไป HIS
- ไฟล์ `.env.local` ต้องไม่ชี้ไปพอร์ต 3000/3001/55432/55442 (ไฟล์ที่ `tools/init-dev.ts` สร้างใหม่ใช้ 3100/55452) — `npm run dev*` ส่ง environment ของตนเองและล้างตัวแปรที่รับมาก่อน

test: `tests/deploy/dev-isolation.node.mjs`

## 16. คำสั่งที่ห้ามใช้กับ Production เด็ดขาด

- `npm run dev*`, `npm run db:seed`, `tools/seed.ts`, `tools/prepare-db.ts`, `npm run dev:setup -- --reset-db`, `npx tsx tools/his-simulator/main.ts` — ใช้กับข้อมูลสังเคราะห์เท่านั้น ห้ามตั้ง `DATABASE_URL` ไปที่ Production
- `deploy-production.ps1`, `upgrade-production.ps1`, `rollback-production.ps1`, `provision-identities.ps1`, `nipt-admin.mjs install|upgrade|rollback` กับ `C:\NIPT-CBH\production` — เฉพาะผู้ดูแลระบบที่ Owner อนุมัติในครั้งนั้น
- `Install-DeployTools.ps1` (เปลี่ยนสคริปต์ deploy จริง), การแก้ `C:\NIPT-CBH\deploy\environments\*.json`
- `git worktree remove`/ลบโฟลเดอร์ใน `C:\NIPT-CBH\production`, `C:\NIPT-CBH\staging`, `…\deploy\history`
- การแก้ migration ที่ apply แล้ว, การแก้ pin SHA-256 ของ master workbook/แบบฟอร์ม, การปิด gate/risk rule, `--force`/`-SkipBackup` หรือการข้ามการตรวจลายเซ็น
- การ copy ไฟล์/ผลไปยังโฟลเดอร์ HIS หรือ NAS จากเครื่อง dev

## Fast Pipeline Enforcement V2 (2026-11-06)

- **Agent policy:** `AGENTS.md` (Codex and other agents) and `CLAUDE.md` (Claude Code) both point to this guide.
- **Claude Code hook:** `.claude/settings.json` installs the `PreToolUse` command `node tools/dev/enforce-fast-loop.mjs`. It denies common direct full-test, standalone build, direct package and Docker rebuild commands during interactive development, explaining the focused alternative. It does not block `npm run release:preflight`, which remains the supported release qualification entrypoint. The hook applies only when Claude Code loads and trusts the project; this is not an OS-level command firewall.
- **Risk-based GitHub CI:** `.github/workflows/foundation.yml` always runs `plan` and `fast` (source guard, deploy contracts, typecheck, lint). It runs `full` (native fixtures, full Vitest, production build, post-build and browser E2E) for MEDIUM/HIGH changes and manual dispatch. Risk classification imports `deploy/windows/risk-classification.mjs`; an unknown path or missing diff is HIGH.
- **Test the enforcement:** `node --test tests/deploy/fast-pipeline-enforcement.node.mjs`. This runs in fast CI and the deploy contracts. For an intentional full local release check run `npm run release:preflight -- --full`.
- **Safety unchanged:** the hook is a developer ergonomics aid, not proof of Owner approval. The Windows release gates, backup, signature, migration rehearsal, health verification and rollback remain authoritative. This V2 does not modify the server's installed deployment scripts.

## Codex PreToolUse parity (2026-11-07)

Codex loads `AGENTS.md` for instructions and `.codex/hooks.json` for a synchronous `PreToolUse` hook on Bash/shell commands. The hook reuses **the same** `tools/dev/enforce-fast-loop.mjs` as Claude Code, so direct broad test/build commands are declined with focused-development alternatives. It uses a Git-root-resolved command on both Windows and Unix and requires the local Codex client to load/trust project hooks. Run `/hooks` in Codex to review and trust it. The `.codex/hooks.json` file itself is not a hard OS-level restriction; hook support/trust and agent tool coverage must be confirmed on the installed client. The hook permits `npm run release:preflight` and does not change signed packages, approvals or Production gates.

Validate the hook with `node --test tests/deploy/codex-fast-loop-hook.node.mjs`; this exercises the shared script via synthetic `PreToolUse` events, **not** a live Windows Codex session.
