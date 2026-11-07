# ออกผลแบบขั้นตอนน้อย — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HALOS และ ReadyGen ไปจบที่ช่อง "รอส่ง HIS" เดียวกัน กดส่ง HIS (ทีละคน/ทั้งหมด) เป็นจุดเดียวที่รับรองผล ANC จะเห็นผลหลังจากนั้น งานค้างทุกแบบมีทางออก และลายเซ็นในรายงานต้องไม่เบี้ยว

**Architecture:** ใช้สถานะผลเดิมของ `result_report_version`: `PendingCertification` (ผ่าน Gate + มี review/QC5) = "รอส่ง HIS" และ `certifyAttempt` = "ส่ง HIS" แยก review+QC5 ออกจากการรับรอง ทำ read model เดียวสำหรับ 3 แท็บ เพิ่ม migration เดียว (205) สำหรับการทิ้งรายการ งานค้างเดิมใช้สคริปต์ปฏิบัติการครั้งเดียว

**Tech Stack:** Next.js (App Router, รุ่นในโปรเจกต์ — อ่าน `node_modules/next/dist/docs/` ก่อนแก้ route), TypeScript, PostgreSQL (PGlite ในเทสต์), Vitest, zod, decimal.js

**Spec:** [docs/superpowers/specs/2026-11-07-result-release-simplification-design.md](../specs/2026-11-07-result-release-simplification-design.md)

## Global Constraints

- Dev loop เท่านั้น: แก้ → `npm run dev:verify` → `npm run dev:test -- <file>` ห้าม `npm test` ทั้งชุด ห้าม build package ห้าม deploy ระหว่างทำแผนนี้ (AGENTS.md)
- Node อยู่ที่ `C:\NIPT-CBH\toolchain\node` (เติมเข้า PATH ก่อนรัน npm ในเครื่องนี้)
- ห้ามแก้ migration ที่มีอยู่ การเปลี่ยน DB ทั้งหมดอยู่ใน `db/migrations/205_result_release_simplification.sql` เท่านั้น และต้องเพิ่มชื่อนี้ต่อท้ายรายการใน `tests/unit/update-112-source-scope.test.ts`
- ANC ต้องไม่เห็นผลหรือเปิด PDF ได้ก่อน `certifyAttempt` สำเร็จ (spec §2 สิ่งที่ห้ามเกิด)
- กฎจับคู่ ReadyGen: **HN ตรง และเลข Lab ตรงกับ LN หรือ LN Halos หรือรหัสตัวอย่างที่พิมพ์ และตรงเพียง 1 case / 1 Attempt ล่าสุดของรอบปัจจุบัน** (spec §3.4)
- GA ในรายงาน: HALOS sampleinfo ก่อน แล้วจึง EDD ถ้าไม่มีทั้งคู่ระงับด้วย `GA_UNAVAILABLE` (spec §3.7, §5.2)
- ห้ามระงับด้วย `REQUEST_DOB_NOT_RECORDED`, `DOB_SOURCES_DISAGREE`, `REQUEST_EDD_NOT_RECORDED`, `EDD_REQUIRED_FOR_GA`, `GA_SOURCES_DISAGREE`
- ทุกการกระทำใหม่ (ส่ง HIS, เลือกผู้ป่วย, ทิ้ง, ซ่อนแถว HALOS, relink สคริปต์) ต้องเรียก `audit(...)`
- ข้อความ UI เป็นภาษาไทยตามรูปแบบเดิมของหน้า `src/components/p5/*`
- เทสต์ task3/HALOS หลายไฟล์ถูก dev ข้ามเพราะต้องใช้ไฟล์ Owner master หรือ Word (`tests/contracts/task3-*`, `tests/db/task3-halos-import.test.ts`) ถ้าเทสต์ของ task ใดอยู่ในรายการข้าม ให้รายงานว่า **BLOCKED ใน dev** ห้ามรายงานว่า PASS และให้ไปรันที่ `release:preflight`
- งานแก้ lab ที่ยังไม่ commit ใน working tree (Pooling/Blank, Re-xxx, migration 204, ภาพ Run) ต้องแยกออกไปก่อนเริ่ม Task 1 ตามที่ Owner ตัดสิน (ดู Task 0)

## Review Focus

1. **PDF ReadyGen ที่ HN ตรงแต่เลข Lab เป็นของ Attempt เก่า (ก่อน Re-Library)** → ต้องไม่ผูกกับ Attempt ใหม่ ต้องไปแท็บ "ต้องจัดการ" — เทสต์ใน Task 1
2. **กด "ส่งทั้งหมด" ซ้ำ หรือสองคนกดพร้อมกัน** → ส่ง HIS ได้ครั้งเดียวต่อผล (`job_outbox` ไม่ซ้ำ) — เทสต์ใน Task 4
3. **รายการ "รอส่ง HIS" ที่ระหว่างรอมีการถอนความยินยอมหรือมีผลใหม่กว่า** → ตอนส่ง Gate ต้องไม่ผ่านและรายการย้ายไป "ต้องจัดการ" ไม่ล้มทั้งชุด — เทสต์ใน Task 4
4. **ANC เปิดหน้าเคสระหว่างที่ผลอยู่ "รอส่ง HIS"** → ไม่เห็นผลและไม่มีลิงก์ PDF — เทสต์ใน Task 3
5. **รูปลายเซ็นยาวมาก (เช่น 1200×100) หรือสูงมาก** → ต้องอยู่ในกรอบเดิม ไม่ยืดและไม่ล้นกรอบ — เทสต์ใน Task 7

---

### Task 0: แยกงานค้างใน working tree ออกก่อน

**Files:** ไม่มี (git เท่านั้น)

- [ ] **Step 1:** ถาม Owner ว่าจะ commit งานแก้ lab ที่ค้าง (`packages/lab/*`, `packages/pooling/owner-master.ts`, `packages/run-photos/service.ts`, `src/components/p4/lab-bench.tsx`, `db/migrations/204_bench_ready_repeat_slots.sql`, เทสต์ที่เกี่ยวข้อง) ลงสาขา `fix/lab-pooling-repeat-photos` หรือไม่ ห้าม commit `docs/deployment/2026-11-04-production-deploy-status.md`
- [ ] **Step 2:** หลัง Owner ตอบ สร้างสาขา `feat/result-release-simplification` จากสาขาที่มี migration 204 อยู่แล้ว (เพราะ 205 ต้องต่อจาก 204) แล้ว commit spec และแผนนี้ลงสาขาใหม่
- [ ] **Step 3:** ตรวจ `git status --short` ว่าเหลือเฉพาะไฟล์สถานะ deploy ที่ไม่ track

---

### Task 1: กฎจับคู่ใหม่ (HN + LN/LN Halos)

**Files:**
- Modify: `packages/results/gates.ts:37` (`LINK_KEYS`)
- Modify: `packages/results/service.ts:155-161` (`autoMatchCandidate`), `:278-298` (`autoLinkUnique`)
- Test: `tests/unit/p5-gates.test.ts`, `tests/db/p5a-auto-link.test.ts`

**Interfaces:**
- Produces: `LINK_KEYS.RESULT = {required:['hn','labNumber'], optional:[]}`; `autoMatchCandidate(candidates, {kind, openRevision}) : Candidate|null` (ตัดพารามิเตอร์ `nameConflicts`); `autoLinkUnique` ไม่อ่าน `linkageMode` อีกเมื่อไม่ใช่ `migrationOnly`

- [ ] **Step 1: เทสต์ที่ต้องล้มก่อน** ใน `tests/unit/p5-gates.test.ts`:
  - `crossFailures({hn:'MATCH',labNumber:'MATCH',dob:'MISMATCH',pregnancy:'NOT_AVAILABLE',collectionDate:'MISMATCH',gestationalAge:'NOT_AVAILABLE'},'RESULT')` → `[]`
  - `crossFailures({...same, labNumber:'NOT_AVAILABLE'},'RESULT')` → `['labNumber']`
  - `crossFailures({...same, hn:'MISMATCH'},'RESULT')` → `['hn']`

  ใน `tests/db/p5a-auto-link.test.ts`:
  - `links when HN and LN Halos match one current attempt even if DOB and GA differ` → state `Linked`, `link_mode='AUTO_UNIQUE'`
  - `does not link when the lab number is the printed ID of a superseded attempt` → `Unlinked` (Review Focus 1)
  - `does not link when two cases share the HN and lab number` → `Unlinked`
  - `links while result_management.linkageMode is MANUAL` → `Linked`
- [ ] **Step 2:** `npm run dev:test -- tests/unit/p5-gates.test.ts tests/db/p5a-auto-link.test.ts` → FAIL ตามที่คาด
- [ ] **Step 3:** แก้ `LINK_KEYS.RESULT`, ตัดเงื่อนไข `nameConflicts` ใน `autoMatchCandidate` (คง `openRevision`, `c.matchedOn.includes('HN')`, `c.cross.labNumber==='MATCH'`, รอบปัจจุบัน, Attempt ล่าสุด, ไม่ใช่สถานะ Superseded/BatchCancelled/Stopped/Cancelled, เหลือ 1 รายการ และ 1 case) ให้ `autoLinkUnique` ข้ามเช็ก `linkageMode` แล้วปรับผู้เรียก `autoMatchCandidate` ใน `packages/results/completion.ts:12` และที่อื่นตาม `tsc`
- [ ] **Step 4:** รันเทสต์ Step 2 → PASS รัน `npm run dev:verify` → PASS (`tests/db/result-completion.test.ts` และ `tests/db/p5-results*.test.ts` ที่ verify เลือกต้องผ่าน ถ้ามีเทสต์เดิมที่ยืนยันกฎเก่า เช่นต้องตรงวันเกิด ให้แก้ค่าคาดหวังให้ตรงกฎใหม่ และระบุในข้อความ commit)
- [ ] **Step 5: Commit** `feat(results): link ReadyGen PDFs by HN and LN/LN Halos only`

---

### Task 2: HALOS ไม่ระงับเรื่องวันเกิด/EDD และใช้ GA จาก HALOS

**Files:**
- Modify: `packages/readygen/interpretation.ts` (เพิ่มฟังก์ชัน), `packages/readygen/reports.ts:113-147` (`prepareReport`)
- Test: `tests/unit/task3-interpretation.test.ts`

**Interfaces:**
- Produces: `reportGaDays(i:{halosGa:string|undefined; edd:string|null; collectionDay:string|null}): number|null` ใน `interpretation.ts` คืน `halosGaDays(halosGa)` ถ้าอ่านได้ ไม่เช่นนั้นคืน `280 - (edd - collectionDay)` เป็นวัน ไม่เช่นนั้นคืน `null`

- [ ] **Step 1: เทสต์** ใน `tests/unit/task3-interpretation.test.ts`:
  - `reportGaDays({halosGa:'18,3',edd:'2027-03-01',collectionDay:'2026-11-01'})` → `129`
  - `reportGaDays({halosGa:undefined,edd:'2027-03-01',collectionDay:'2026-11-01'})` → `280-120` = `160`
  - `reportGaDays({halosGa:'',edd:null,collectionDay:'2026-11-01'})` → `null`
- [ ] **Step 2:** `npm run dev:test -- tests/unit/task3-interpretation.test.ts` → FAIL (`reportGaDays` ไม่มี)
- [ ] **Step 3:** เพิ่ม `reportGaDays` ใน `prepareReport` (ส่วนที่ไม่ใช่ EQA) ลบการ push hold 5 รหัสใน Global Constraints ใช้ `ga=reportGaDays(...)` ถ้าเป็น `null` ให้ `h('GA_UNAVAILABLE')` คง `GA_OUT_OF_RANGE` ไว้ ส่วน EQA ไม่เปลี่ยน เพิ่ม `GA_UNAVAILABLE:"ไม่มีอายุครรภ์ในไฟล์ HALOS และไม่มี EDD"` ใน `HOLD_TEXT` (`src/components/p5/native-reports.tsx`) และลบข้อความของ 5 รหัสที่เลิกใช้
- [ ] **Step 4:** รันเทสต์ Step 2 → PASS แล้วรัน `npm run dev:test -- tests/contracts/task3-identity-sources.test.ts` ถ้าถูกข้ามให้บันทึก **BLOCKED ใน dev** แล้วรัน `npm run dev:verify` → PASS
- [ ] **Step 5: Commit** `feat(task3): use PET DOB and HALOS GA; drop DOB/EDD holds`

---

### Task 3: หยุดที่ "รอส่ง HIS" — แยก review+QC5 ออกจากการรับรอง

**Files:**
- Modify: `packages/results/service.ts` (`acceptAndRelease` :519, `acceptInternalAndRelease` :583)
- Modify: `packages/readygen/reports.ts:295-298` (`finalizeReports`), `packages/results/completion.ts:72-73` (`confirmCompletion`)
- Test: `tests/db/result-completion.test.ts`

**Interfaces:**
- Produces (ใน `service.ts`):
  - `reviewExternalForRelease(db,user,{versionId,expectedRowVersion,abnormalAcknowledged,note?}): Promise<VersionRow>` = ส่วน `recordReview` + `recordQc5` (และ migration review) ของ `acceptAndRelease` โดยไม่เรียก `certifyAttempt`
  - `reviewInternalForRelease(db,user,{versionId,expectedRowVersion,abnormalAcknowledged,benchRevision?,benchMeasurementsReviewed?,note?}): Promise<VersionRow>` = ส่วนเดียวกันของ `acceptInternalAndRelease` รวมเช็ก `task3_internal_version_current`
  - `releaseReviewed(db,versionId): Promise<boolean>` = มี `result_review` และ QC5 ของ version นี้ (Task 4 และ 6 ใช้)
  - `acceptAndRelease` / `acceptInternalAndRelease` เดิมให้เรียกฟังก์ชันใหม่แล้วตามด้วย `certifyAttempt` (ผู้เรียกเดิมไม่เสีย)
- `confirmCompletion` คืน `outcome:'PendingCertification'` แทน `'CertifiedReleased'` ส่วน `finalizeReports` เมื่อ `release:true` ให้เรียก `reviewInternalForRelease` ค่า `release` ใน `FinalizeOutcome` เป็น `'PendingCertification'`

- [ ] **Step 1: เทสต์** ใน `tests/db/result-completion.test.ts` (ปรับเทสต์เดิมที่คาด `CertifiedReleased`):
  - `confirmCompletion leaves the PDF in PendingCertification with review and QC5 recorded` → state `PendingCertification`, `releaseReviewed` true, ไม่มีแถว `result_release` และไม่มี `job_outbox` kind `result_release_completed`
  - `ANC sees no result and no PDF while the result waits to be sent` → `ancCaseResults(...)` ของเคสนั้นไม่มีผล และ `readReleasedFile` โยน `NOT_FOUND` หรือ 403 ตามที่ฟังก์ชันใช้อยู่ (Review Focus 4)
- [ ] **Step 2:** `npm run dev:test -- tests/db/result-completion.test.ts` → FAIL
- [ ] **Step 3:** ทำตาม Interfaces แล้วยืนยันว่า `validate()` (`service.ts:410`) ย้ายเป็น `PendingCertification` หลัง QC5 ถ้าไม่ย้าย ให้เรียก `validate` ต่อท้ายใน `review*ForRelease`
- [ ] **Step 4:** รันเทสต์ → PASS รัน `npm run dev:test -- tests/db/operational-results.test.ts tests/db/p5-results-flow.test.ts` → PASS (แก้ค่าคาดหวังที่ผูกกับพฤติกรรมเดิม "รับรองทันที") แล้วรัน `npm run dev:verify`
- [ ] **Step 5: Commit** `feat(results): stop at PendingCertification; certification moves to Send HIS`

---

### Task 4: ปุ่มส่ง HIS ทีละรายการ / ทั้งชุด

**Files:**
- Create: `packages/results/send-his.ts`
- Modify: `src/app/api/p5/results/route.ts` (action `send`)
- Test: `tests/db/result-send-his.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `reviewExternalForRelease`, `reviewInternalForRelease`, `releaseReviewed` (Task 3), `certifyAttempt`
- Produces: `sendToHis(db,user,input:{idempotencyKey:string(uuid); reviewConfirmed:boolean; abnormalAcknowledged:boolean; items:{versionId:string;expectedRowVersion:number}[] (1..100)}): Promise<{items:{versionId:string;outcome:'CertifiedReleased'|'BLOCKED'|'ERROR';code?:string;failed?:string[]}[]}>`
  - ต่อรายการใช้ `SAVEPOINT` แยก และใช้ key ของ `certifyAttempt` = `send-` + sha256(`idempotencyKey`+`versionId`) ตัดเหลือ 48 ตัว
  - ถ้า `releaseReviewed` เป็น false: ต้องมี `reviewConfirmed:true` (ไม่มีให้ `outcome:'ERROR', code:'REVIEW_CONFIRMATION_REQUIRED'`) แล้วเรียก `review*ForRelease` ตาม `origin` ก่อนรับรอง
  - ต้องมีสิทธิ์ `result.certify`; API ตอบ JSON เดียวกับ action อื่นใน route

- [ ] **Step 1: เทสต์** `tests/db/result-send-his.test.ts`:
  - `sends one result: release exists, ANC sees it, one outbox job`
  - `sends a batch where one item lost consent while waiting: others CertifiedReleased, that one BLOCKED and back in ValidationBlocked` (Review Focus 3)
  - `replaying the same idempotencyKey creates no second release or outbox job` และ `two keys for the same version: second is BLOCKED/ERROR, outbox count stays 1` (Review Focus 2)
  - `unreviewed item without reviewConfirmed → REVIEW_CONFIRMATION_REQUIRED, nothing released`
  - `EQA item: CertifiedReleased with no outbox job`
- [ ] **Step 2:** `npm run dev:test -- tests/db/result-send-his.test.ts` → FAIL
- [ ] **Step 3:** สร้าง `send-his.ts` ตาม Interfaces แล้วเพิ่ม `action==="send"` ใน route เรียก `sendToHis` ภายใน transaction เดียวกับ action อื่น
- [ ] **Step 4:** เทสต์ → PASS แล้ว `npm run dev:verify`
- [ ] **Step 5: Commit** `feat(results): send to HIS one by one or in batch`

---

### Task 5: ทิ้งรายการ / ซ่อนแถว HALOS / เลือกผู้ป่วยคนเดียว (migration 205)

**Files:**
- Create: `db/migrations/205_result_release_simplification.sql`
- Modify: `packages/results/service.ts:645-651` (`voidVersion`), เพิ่ม `pickPatient`
- Modify: `packages/readygen/halos-import.ts` (เพิ่ม `dismissHalosRow`), `packages/readygen/reports.ts:318-332` (`reportWorklist` ไม่แสดงแถวที่ถูกซ่อน)
- Modify: `tests/unit/update-112-source-scope.test.ts` (เพิ่ม `'205_result_release_simplification.sql'` ต่อท้าย)
- Test: `tests/db/result-action-needed.test.ts` (ใหม่)

**Interfaces:**
- Migration 205:
  - `CREATE OR REPLACE FUNCTION p5_version_guard()` จากนิยามปัจจุบัน (ดึงด้วย `pg_get_functiondef` แล้ว `regexp_replace` เพิ่มคู่ในรายการ transition ตามแบบ migration 192 ถ้าไม่เจอ pattern ให้ `RAISE EXCEPTION`) เพิ่ม `('LinkConflict','Voided'),('Linked','Voided'),('ValidationBlocked','Voided'),('PendingCertification','Voided')`
  - ตาราง `halos_row_dismissal(row_id uuid PRIMARY KEY REFERENCES halos_import_row, reason text NOT NULL CHECK(length(trim(reason))>=8), actor_id uuid NOT NULL REFERENCES app_user, created_at timestamptz NOT NULL DEFAULT now())` พร้อม trigger `immutable_row` และ GRANT ตามแบบตารางใน migration 189 (บันทึก memory: ตารางใหม่ต้องมี GRANT)
- `voidVersion` รับสถานะ `Unlinked|LinkConflict|Linked|ValidationBlocked|PendingCertification` (ยังห้าม `CertifiedReleased`)
- `pickPatient(db,user,{versionId,expectedRowVersion,caseId,roundId,attemptId,reason}): Promise<{state:string}>` = `proposeLink` แล้ว `decideLink(APPROVE)` ด้วยผู้ใช้คนเดียวกัน (DB อนุญาตแล้วตั้งแต่ migration 192) จากนั้นถ้า `origin==='EXTERNAL_READYGEN'` ให้เรียก `reviewExternalForRelease` เพื่อไป "รอส่ง HIS"
- `dismissHalosRow(db,user,{rowId,reason}): Promise<void>` ต้องมี `result.review`

- [ ] **Step 1: เทสต์** `tests/db/result-action-needed.test.ts`:
  - `void works from LinkConflict, Linked, ValidationBlocked and PendingCertification; refused after CertifiedReleased`
  - `pickPatient by one person links a ReadyGen PDF and reaches PendingCertification`
  - `dismissed HALOS row no longer appears in reportWorklist; reason under 8 chars is refused`
  - `migration 205 leaves every other version transition unchanged` (ลอง `Unlinked→CertifiedReleased` ต้องโยน `REPORT_TRANSITION_PROHIBITED`)
- [ ] **Step 2:** `npm run dev:test -- tests/db/result-action-needed.test.ts` → FAIL
- [ ] **Step 3:** เขียน migration และฟังก์ชันตาม Interfaces เพิ่ม action `void` (มีอยู่แล้ว ปรับให้ใช้สถานะใหม่) และ `pick` ใน `src/app/api/p5/results/[id]/route.ts` และ `dismiss` ใน `src/app/api/task3/halos/[id]/route.ts` (หรือ route ของ worklist ที่ใกล้ที่สุด)
- [ ] **Step 4:** เทสต์ → PASS แล้ว `npm run dev:verify` (ต้องมี Migration rehearsal + inventory PASS)
- [ ] **Step 5: Commit** `feat(results): every stuck item can be picked or discarded (migration 205)`

---

### Task 6: Read model 3 แท็บ + หน้าจอรวม

**Files:**
- Create: `packages/results/release-queue.ts`, `src/components/p5/release-board.tsx`
- Modify: `src/components/p5/result-workspace.tsx` (ใช้ `ReleaseBoard` แทนส่วน "ค้นหาและติดตามผล" และ `NativeReports` worklist), `src/components/p5/task3-panel.tsx` (ลบบล็อก `acceptInternal`), `src/components/p5/native-reports.tsx` (เหลือส่วนนำเข้า HALOS + กล่องออกรายงาน; หลังออกรายงานพาไปแท็บ "รอส่ง HIS")
- Modify: route `src/app/api/p5/results/route.ts` (action `board`)
- Test: `tests/db/result-release-queue.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `reportWorklist` hold logic (`prepareReport`), `releaseReviewed`, `readHisDeliveryStatuses`
- Produces: `releaseQueue(db,user,deps,input:{tab:'ACTION'|'READY'|'SENT'; q?:string; page?:number; pageSize?:number}): Promise<{rows:BoardRow[]; counts:{ACTION:number;READY:number;SENT:number}; page:{number,size,total,totalPages,hasNext}}>`
  - `BoardRow = {key:string; source:'HALOS'|'READYGEN'; versionId:string|null; halosRowId:string|null; rowVersion:number|null; ln:string|null; hn:string|null; lnHalos:string|null; sampleId:string|null; template:string|null; abnormal:boolean; reviewed:boolean; reasons:{code:string;fixHref?:string}[]; hisDelivery?:HisDeliveryStatus; pdfHref:string|null}`
  - ACTION = แถว HALOS ที่ HOLD และไม่ถูกซ่อน + version `Unlinked|LinkConflict|ValidationBlocked|Linked` (ไม่รวม historical, EQA ตาม scope เดิม)
  - READY = `PendingCertification` (`reviewed` = `releaseReviewed`)
  - SENT = `CertifiedReleased` เรียงใหม่สุดก่อน
  - `fixHref` ของเหตุระงับ: หน้าเคส `/cases/<caseId>` สำหรับข้อมูลผู้ป่วย และ `/settings?key=report_interpretation` สำหรับชุดกฎ
- UI `ReleaseBoard`: แท็บ 3 อันพร้อมตัวเลข, ค้นหา LN/HN/LN Halos, แท็บ READY มี checkbox + "ส่ง HIS" ต่อแถว + "ส่งที่เลือก" (ติ๊ก "ตรวจผลรายการที่เลือกแล้ว" แสดงเมื่อมี `reviewed=false`, ติ๊ก "รับทราบผลผิดปกติ" เมื่อมี `abnormal`) + ปุ่ม "เปิด PDF" ใช้ `PdfPreviewButton`; แท็บ ACTION มี "เลือกผู้ป่วย" (dialog เลือกจาก `linkCandidates`) / "ทิ้ง" / "ซ่อน" + ลิงก์ "แก้ที่นี่"; แท็บ SENT มีตัวกรองขั้นสูงเดิมและ CSV ย้ายมาจาก `result-workspace.tsx`
- ReadyGen ในส่วนบน: ตารางสแกนแสดงเฉพาะ `status==='NEW'`; ปุ่มเดียว "นำเข้า" = preview → `previewCompletion` → `confirmCompletion` ของรายการที่ `ready` ส่วนที่ไม่ ready ให้ `confirmImport` เข้าคิว (ไปแท็บ ACTION) แล้วตัด `<details>` "จัดการรายการที่ต้องตรวจหรืออนุมัติเพิ่ม" ออก

- [ ] **Step 1: เทสต์** `tests/db/result-release-queue.test.ts`:
  - `a confirmCompletion result appears in READY with reviewed=true and a pdfHref`
  - `an Unlinked ReadyGen PDF appears in ACTION with a reason`
  - `after sendToHis the row moves to SENT and counts change by one`
  - `voided and dismissed items appear in no tab`
- [ ] **Step 2:** `npm run dev:test -- tests/db/result-release-queue.test.ts` → FAIL
- [ ] **Step 3:** ทำ `releaseQueue` + action `board` แล้วทำ UI ตาม Interfaces
- [ ] **Step 4:** เทสต์ → PASS, `npm run dev:verify` แล้ว `npm run dev` เปิดหน้า `/results` ด้วยข้อมูลสังเคราะห์: นำเข้า PDF → เห็นใน "รอส่ง HIS" → ส่ง → เห็นใน "ส่งแล้ว" (ใช้ skill `run` ถ้าต้องการภาพหน้าจอ)
- [ ] **Step 5: Commit** `feat(results): one results board with Action needed / Waiting for HIS / Sent`

---

### Task 7: ลายเซ็นพอดีกรอบ + ตรวจตอนอนุมัติผู้ลงนาม

**Files:**
- Create: `packages/readygen/signature-fit.ts`
- Modify: `packages/readygen/docx.ts:8,120-141` (`SignerSlot.signature` เพิ่ม `width`,`height`; ปรับ extent ของรูป), `packages/readygen/reports.ts:177-185` (`signerSlots` ส่งขนาดรูป; final ที่ไม่มีลายเซ็นโยน `REPORT_SIGNATURE_MISSING`)
- Modify: `packages/readygen/signers.ts:13` (`signatureImage` คืน `opaque:boolean`), `decideSignerProfile` (VERIFY ต้องมี `layoutReviewed:true`), เพิ่ม `signerSamplePreview`
- Modify: `src/components/signer-profile.tsx` และหน้าอนุมัติผู้ลงนาม (`src/app/(protected)/results/signers`)
- Test: `tests/unit/report-signature-fit.test.ts` (ใหม่), `tests/contracts/owner-lab-054-signers-native.test.ts` (ถ้าถูกข้าม → BLOCKED ใน dev)

**Interfaces:**
- `fitSignature(frame:{cx:number;cy:number}, image:{width:number;height:number}): {cx:number;cy:number;offsetX:number;offsetY:number}` — ขนาดใหม่ ≤ กรอบทั้งสองด้าน รักษาสัดส่วน ±1 EMU ด้านหนึ่งเท่ากรอบพอดี และ offset จัดกึ่งกลาง
- `fitDrawingXml(drawingXml:string, image:{width:number;height:number}): string` — แก้ `wp:extent` และ `a:ext` ของ drawing นั้นด้วย `fitSignature` ถ้าเป็น `wp:anchor` ให้บวก offset ใน `wp:positionH/V wp:posOffset` ถ้าเป็น `wp:inline` ไม่ต้องเลื่อน ไม่แตะส่วนอื่น
- `signatureImage(bytes)` คืน `{media,width,height,opaque}` — PNG: `opaque` = color type 0 หรือ 2 และไม่มี chunk `tRNS`; JPEG: `opaque=true`
- `signerSamplePreview(db,user,deps,{profileId,kind:'SINGLETON'|'TWIN'}): Promise<{bytes:Buffer}>` — ค่าสังเคราะห์คงที่ ใช้ผู้ลงนามนั้นทั้งสองช่อง render ด้วย `deps.render??renderDocxBatch` ใส่ `watermark` ไม่บันทึกรายงาน audit `SIGNER_SAMPLE_PREVIEWED`

- [ ] **Step 1: เทสต์** `tests/unit/report-signature-fit.test.ts`:
  - `fitSignature({cx:1800000,cy:600000},{width:1200,height:100})` → `cx=1800000`, `cy=150000`, `offsetY=225000`, `offsetX=0` (Review Focus 5)
  - `fitSignature({cx:1800000,cy:600000},{width:100,height:400})` → `cy=600000`, `cx=150000`, `offsetX=825000`
  - `fitSignature(frame,{width:300,height:100})` (สัดส่วนเท่ากรอบ) → เท่ากรอบ offset 0
  - `fitDrawingXml` กับ snippet `wp:anchor` ตัวอย่าง: `wp:extent` และ `a:ext` เปลี่ยน `wp:posOffset` เพิ่มตาม offset ส่วนอื่นของ XML เท่าเดิม
  - `signatureImage` ของ PNG RGBA → `opaque:false`, PNG RGB ไม่มี tRNS → `opaque:true`, JPEG → `opaque:true`
- [ ] **Step 2:** `npm run dev:test -- tests/unit/report-signature-fit.test.ts` → FAIL
- [ ] **Step 3:** ทำตาม Interfaces เรียก `fitDrawingXml` กับแต่ละ segment ของ drawing ที่มี blip ลายเซ็นใน `fillReport` (ขยายช่วงจาก `pic:blipFill` เป็นทั้ง `w:drawing` ของรูปนั้น) UI: ตอนอัปโหลด ถ้า `opaque` แสดง "พื้นหลังสีขาวอาจทับเส้นในแบบฟอร์ม — แนะนำ PNG พื้นโปร่งใส" หน้าอนุมัติมีปุ่ม "ดูตัวอย่างแบบเดี่ยว" / "ดูตัวอย่างแบบแฝด" และ checkbox "ลายเซ็นแสดงถูกต้องตามแบบฟอร์ม" ที่ต้องติ๊กก่อนปุ่มอนุมัติจะกดได้
- [ ] **Step 4:** เทสต์ → PASS; รัน contract test ผู้ลงนาม (BLOCKED ถ้าถูกข้าม); `npm run dev:verify`
- [ ] **Step 5:** ทำรายงานตัวอย่างให้ Owner ดู (spec §5.8 และที่สัญญาไว้): ใน dev ใช้ลายเซ็นทดสอบสัดส่วนกว้างและสูง render แบบเดี่ยวและแฝดผ่าน `signerSamplePreview` บันทึก PDF ไว้ใน scratchpad แล้วแสดงให้ Owner ดู ถ้าเครื่องไม่มี Word หรือ master ให้รายงาน BLOCKED และบอกว่าต้องทำบน Staging
- [ ] **Step 6: Commit** `feat(task3): fit signatures to the template frame and review them on approval`

---

### Task 8: สคริปต์เคลียร์งานค้างครั้งเดียว

**Files:**
- Create: `tools/operational/backlog-relink-20261107.ts`
- Modify: `tools/win-installer/build-package.ts` (ลงทะเบียนให้ `nipt-admin ops-run` รันได้)
- Test: `tests/db/backlog-relink.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `systemMatch`/`autoLinkUnique` (Task 1), `pickPatient` (Task 5, ใช้เมื่อ auto-link ถูก DB ปฏิเสธเพราะเคยมีคนตัดสินใจไว้: `AUTO_LINK_AFTER_HUMAN_DECISION` / `AUTO_LINK_SERIES_NOT_EMPTY`), `validate`/`revalidate`
- Produces: `runBacklogRelink(db, actor, {apply:boolean}): Promise<{rows:{versionId:string;from:string;to:string;match:{hn:string;ln:string|null;lnHalos:string|null}|null;reason:string|null}[]}>` และ CLI `--apply` (ค่าเริ่มต้นเป็นโหมดทดลอง) เขียนรายงาน CSV + Markdown ลง `--out <dir>`
  - ครอบคลุม version `Unlinked|LinkConflict|ValidationBlocked|Linked` ที่ไม่ใช่ historical และรายงาน HALOS ที่ `internal_report.state='Final'` แต่ version ยังไม่ `CertifiedReleased`
  - `LinkConflict` ต้อง `unlinkVersion` ก่อนจับคู่ใหม่ (transition ที่อนุญาตคือ `LinkConflict→Unlinked`)
  - ห้ามเรียก `recordReview`, `recordQc5`, `certifyAttempt`, `voidVersion`
  - audit ทุกแถวด้วย reasonCode `BACKLOG_RELINK_20261107`

- [ ] **Step 1: เทสต์** `tests/db/backlog-relink.test.ts`:
  - `dry run writes nothing` (นับ `result_link_event`, `result_version_event`, `audit_event` ก่อน/หลังเท่ากัน)
  - `apply links a stuck PDF whose DOB differed to the one HN+LN match and leaves it at PendingCertification with reviewed=false`
  - `apply leaves an HN-only match in ACTION with a reason`
  - `apply never creates result_release or outbox jobs`
- [ ] **Step 2:** `npm run dev:test -- tests/db/backlog-relink.test.ts` → FAIL
- [ ] **Step 3:** ทำตาม Interfaces
- [ ] **Step 4:** เทสต์ → PASS; `npm run dev:verify` (มี Deployment contracts เพราะแก้ `build-package.ts`)
- [ ] **Step 5: Commit** `feat(ops): one-time backlog relink script with dry run`

---

### Task 9: ตรวจรวมก่อนส่งมอบ

- [ ] **Step 1:** `npm run dev:verify` ทั้งสาขา → PASS ทุกขั้น
- [ ] **Step 2:** รวบรวมรายการเทสต์ที่เป็น BLOCKED ใน dev (task3 / signer native) ไว้ในข้อความส่งมอบ ห้ามรายงานว่า PASS
- [ ] **Step 3:** ใช้ superpowers:requesting-code-review กับทั้งสาขา
- [ ] **Step 4:** หยุดและรายงาน Owner: release preflight, Staging, Production และการรันสคริปต์ Task 8 บน Production (โหมดทดลอง → Owner ดูรายงาน → `--apply`) เป็นขั้นแยกที่ต้องได้รับอนุญาตในเซสชันนั้น
