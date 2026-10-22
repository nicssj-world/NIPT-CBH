# LAB Final Regression — SKIP ledger (2026-10-22)

Source/Runtime/Test revision: **56175ded59b9624768d2f157c520b0505dd67404**. Full log: `.local/lab-owner-evidence/all-tests-56175de-final.log`: **2364 PASS / 0 FAIL / 62 SKIP**,176 passed files/20 wholly skipped files,2426 tests total,693.50s. **SKIP is not PASS.** No Full Regression rerun was performed for this closeout.

Exact62 names/conditions were reconciled using Vitest definition collection (`ctx.collect`, staticParse=false) without executing tests/beforeAll hooks; total collected2426 and skipCount62 match the retained full result. Original run cache was copied before collection. See `.local/lab-owner-evidence/full-regression-skip-ledger.json` and `full-regression-56175de-cache.json`. Native3-suite run is a separate result, never subtracted from or relabelled in the62 SKIPs.

## Conditions and remaining risk

| Group | SKIP count | Condition / reason | Remaining risk | Separate evidence / scope |
|---|---:|---|---|---|
| A | 17 | NIPT_TEST_DATABASE_URL ไม่ถูกตั้งในการรัน Full Suite — Native PostgreSQL เป็น opt-in และไม่ใช้ DATABASE_URL โดยปริยาย เพื่อไม่แตะฐานข้อมูลผิดเครื่อง | สูงสำหรับข้อสรุปเรื่อง stress/race/role/clock บน Production; Local LAB มี native/runtime proof แยก แต่ไม่แทนทุก scenario | lab-repeat-native / p5h-native / p2-p3-native รันแยกผ่าน3ชุดในฐาน Synthetic ใหม่ที่19831; อีก14รายการในกลุ่มนี้ยังไม่ได้รันแยกใน closeout |
| B | 33 | NIPT_P6_NATIVE_URL ไม่ถูกตั้ง — P6 native sandbox ต้องระบุฐาน Synthetic สำหรับ stress/crash/retry/reconciliation โดยเฉพาะ | สูงสำหรับการรับรอง native fault/stress/HIS Production; ไม่ใช่อุปสรรคต่อ Owner Local UAT ที่มี actual local Worker delivery แต่ยังไม่ยืนยัน HIS ACK | Browser local RES/PDF/Backup/BOM-onlyOK ของ Singleton/Twin/S2 ผ่าน; P6 unit/DB/contracts ใน Full Suite ผ่าน; native33 scenarios นี้ยัง SKIP |
| C | 1 | NIPT_P7_NATIVE_URL ไม่ถูกตั้ง — P7 maintenance safety ต้องมีฐาน Synthetic แยกเฉพาะ | คงเหลือที่ native maintenance/privilege boundary; ไม่มีการส่งมอบ P7/Production maintenance ในงาน LAB นี้ | P7 source/contracts ที่อยู่ใน Full Suite ใช้ผลจริงตาม log; native รายการนี้ไม่ถูกนับ PASS |
| D | 1 | NIPT_LEGACY_PET_PARSER_DIR ไม่ถูกตั้ง — ไม่ได้เปิดเปรียบเทียบกับ Python parser จาก archive ภายนอก100ไฟล์ | ยังไม่พิสูจน์ differential parity กับ legacy parser; Owner mapping P21/P23 ใหม่ยังเป็นข้อกำหนดสูงสุด | Owner PET mapping/CP874/native receipt/race tests และ BrowserS1/S2 มีหลักฐานแยก; ไม่อนุมานว่าตรง legacy ทุก field |
| E | 1 | NIPT_LEGACY_RESULT_SAMPLES_DIR ไม่ถูกตั้ง — Corpus100ไฟล์จาก NIPTY_handover พร้อม cases.csv ไม่ถูกส่งเข้า test run นี้ | ยังไม่ครอบคลุม layout/variant ของ legacy corpus100ไฟล์; ไม่อ้าง real BGI/clinical acceptance | Actual local Singleton/Twin/S2/NOTICE/ZIP/duplicate flows ผ่าน พร้อม parser/identity/revision contracts; ไม่แทน corpus100 |
| F | 4 | NIPT_LEGACY_HANDOVER_FIXTURES_DIR/MANIFEST.json ไม่ถูกตั้งให้ชุดทดสอบ — Settings→Worker ZIP acceptance ต้องมี read-only extraction พร้อม manifest/hash ที่ test ยอมรับ | ยังไม่มี proof ของ4 end-to-end ZIP-fixture settings scenarios เดิม; ไม่อ้าง Hospital shares | Local inbound/outbound settings Maker-Checker และ native Worker positive journeys มีหลักฐานจริงแยก |
| G | 1 | NIPT_TEST_NATIVE_EXCEL ไม่ใช่ yes (test ยังตรวจ source file ด้วย) — Native Excel F52 save/resume/rebind เป็น opt-in ไม่เรียก Excel โดยปริยายจาก Full Suite | native F52 scenario เฉพาะนี้ยังไม่ถูกรันใน suite; ความเสี่ยง Local ลดด้วย independent native Excel/Master calculations และ actual Browser PDF | Native default47/urgent48/boundary40, dilution C1/EB/V1, final Excel PDF Preview ผ่านแยก; ไม่เปลี่ยนสถานะ SKIP ของ test นี้ |
| H | 2 | NIPT_ANC_REQUEST_PDF และ NIPT_ANC_CONSENT_PDF ไม่ถูกตั้ง — DCC original-PDF rendering opt-in ไม่ใส่เอกสารต้นฉบับใน Git | DCC actual-original rendering2 scenarios นี้ไม่ได้เปิดใน run; งาน ANC เดิมอยู่นอกขอบเขต LAB และถูกเก็บไว้ | ไม่มีการใช้ SKIP นี้เป็นหลักฐานใหม่ว่า ANC/DCC ผ่าน; LAB paper route ไม่บังคับสร้าง ANC เอกสารใหม่ |
| I | 1 | NIPT_ANC_REQUEST_PDF และ NIPT_ANC_CONSENT_PDF ไม่ถูกตั้ง — Installer form-asset staging ต้องรับ DCC originals อย่างชัดเจน | Installer/upgrade asset acceptance ยังไม่ทดสอบ และไม่ใช่ deliverable ของระยะนี้ | ไม่มีการสร้าง Upgrade.exe ตาม Owner Lock; หยุดรอ Owner acceptance ก่อนระยะถัดไป |
| J | 1 | NIPT_TASK_MASTER_PATH ไม่ถูกตั้ง — Unit case นี้ต้องใช้ explicit configured owner Master เพื่อทดสอบ reject obsolete Master | ต่ำสำหรับ runtime นี้ เพราะ Master read-only SHA ถูกยืนยันจริง; explicit-env branch ของ unit test นี้ยัง SKIP | Runtime web/worker/renderer+Master checksum, exhaustive bindings149 formulas, native/current derivative tests และ actual Browser preview มีผลแยก |

Total **62 SKIP**. Groups A+B=50 Native DB opt-in tests; C=1 P7; D+E+F=6 legacy/ZIP fixtures; G=1 Native Excel; H+I=3 DCC/installer; J=1 explicit Master path. No test was removed, changed to skip, or counted as PASS during closeout. These residuals limit hardware/Hospital/clinical/Production conclusions; they do not erase the actual local LAB evidence. `OWNER-UAT=PENDING`.

## Every skipped test

| # | Status | Group | Source file | Collected test name |
|---:|---|---|---|---|
| 1 | SKIP | A | tests/db/migration-103.test.ts | native PostgreSQL: fresh install and populated 102 → 103 upgrade preserve data and are idempotent |
| 2 | SKIP | G | tests/db/workbook-f52-approved.test.ts | F52 native Excel: D52 draft/save/resume matches XLSX and PDF recalculation, then rebinds changed concentration |
| 3 | SKIP | I | tests/unit/win-installer-form-assets.test.ts | Windows release form assets > stages exact originals, loads them in web/renderer env and preserves photos across release upgrade |
| 4 | SKIP | J | tests/unit/workbook-runtime.test.ts | configured owner master loads, while the explicitly supplied obsolete master is rejected |
| 5 | SKIP | H | tests/unit/dcc-snapshot-pdf.test.ts | DCC actual PDF rendering > keeps original dimensions and hashes; Request1 + Consent1 join to2; signatures are images on actual originals |
| 6 | SKIP | H | tests/unit/dcc-snapshot-pdf.test.ts | DCC actual PDF rendering > refuses a frozen/current template hash mismatch instead of silently using another revision |
| 7 | SKIP | A | tests/contracts/lab-repeat-native.test.ts | native LAB repeat-order state changes retain immutable case/round/attempt lineage |
| 8 | SKIP | A | tests/contracts/ln-integrity-native.test.ts | native LN integrity: concurrent different-HN registration, concurrent PET workers, concurrent discovery |
| 9 | SKIP | A | tests/contracts/native.test.ts | native PostgreSQL pg-boss worker and PET/redraw integration |
| 10 | SKIP | A | tests/contracts/native.test.ts | native worker cannot bypass outbound identity validation on retries |
| 11 | SKIP | A | tests/contracts/p2-native.test.ts | native P2 app_rw grants, simultaneous registration/version races and immutable evidence |
| 12 | SKIP | A | tests/contracts/p2-p3-native.test.ts | native P2-P3: registration vs PET races for ANC and LAB_DIRECT, and P2 case/signing locks vs worker S1 apply in both orders |
| 13 | SKIP | D | tests/contracts/p3-legacy-differential.test.ts | AT-HISIN-02 differential: TS parser equals legacy Python parse_pet_file on 100 synthetic files |
| 14 | SKIP | A | tests/contracts/p3-native.test.ts | native P3 inbound: concurrent registration vs worker, real worker scan, Test Connection, share outage |
| 15 | SKIP | A | tests/contracts/p4-native.test.ts | native P4: concurrent receipts never duplicate LN Halos; concurrent assignment/receipt/batch creation serialize |
| 16 | SKIP | A | tests/contracts/p4b-direct-entry-clock-native.test.ts | native DIRECT_ENTRY Pool/DNB/QC4 timestamps come from the database clock under ±3 s application clock skew |
| 17 | SKIP | A | tests/contracts/p4b-native.test.ts | native P4b app_rw: concurrent create/crosscheck, immutable evidence, atomic source invalidation |
| 18 | SKIP | A | tests/contracts/p4c-evidence-native.test.ts | native app_rw P4c rejects malformed F5, cell plans, exact verification and first-cycle evidence; serializes raw reviews |
| 19 | SKIP | A | tests/contracts/p4c-native.test.ts | native P4c app_rw: idempotent create race, optimistic conflicts, immutable evidence, rollback and upstream Stop-use |
| 20 | SKIP | E | tests/contracts/p5-legacy-samples.test.ts | P5 legacy sample parity (NIPTY_handover samples/bgi_pdf) > classifies and reads all 100 legacy synthetic result files exactly as cases.csv records them |
| 21 | SKIP | A | tests/contracts/p5-native.test.ts | native P5: idempotent certification, redraw vs certify, one approval, one version per file, role boundaries |
| 22 | SKIP | A | tests/contracts/p5a-auto-link-native.test.ts | native P5-A: concurrent system links of one round produce one link and no failed import |
| 23 | SKIP | A | tests/contracts/p5h-native.test.ts | native P5H: one case per LN under races, idempotent batch confirmation, role boundaries |
| 24 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > atomically reserves one N/ID under 12 real concurrent clients and denies clinical/fixture escalation |
| 25 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > two workers plus concurrent retry calls cannot publish the same transfer twice |
| 26 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > a new worker connection resumes after file publication/checkpoint loss with identical inode/bytes/N |
| 27 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native PDF/BEFORE_WRITE failure is durable and obeys retry/reconcile policy |
| 28 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native PDF/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy |
| 29 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native PDF/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy |
| 30 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native PDF/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy |
| 31 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native PDF/AFTER_VERIFY failure is durable and obeys retry/reconcile policy |
| 32 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native RES/BEFORE_WRITE failure is durable and obeys retry/reconcile policy |
| 33 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native RES/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy |
| 34 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native RES/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy |
| 35 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native RES/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy |
| 36 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native RES/AFTER_VERIFY failure is durable and obeys retry/reconcile policy |
| 37 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native BACKUP/BEFORE_WRITE failure is durable and obeys retry/reconcile policy |
| 38 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native BACKUP/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy |
| 39 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native BACKUP/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy |
| 40 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native BACKUP/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy |
| 41 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native BACKUP/AFTER_VERIFY failure is durable and obeys retry/reconcile policy |
| 42 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native OK/BEFORE_WRITE failure is durable and obeys retry/reconcile policy |
| 43 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native OK/AFTER_TEMP_SYNC failure is durable and obeys retry/reconcile policy |
| 44 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native OK/BEFORE_PUBLISH failure is durable and obeys retry/reconcile policy |
| 45 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native OK/AFTER_PUBLISH failure is durable and obeys retry/reconcile policy |
| 46 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > native OK/AFTER_VERIFY failure is durable and obeys retry/reconcile policy |
| 47 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > OK/checkpoint ambiguity stays held and durable operator investigation never resends |
| 48 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > concurrent withdrawal after OK creates reconciliation and preserves files |
| 49 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > concurrent withdrawal immediately before OK blocks sentinel publication on native PG |
| 50 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > final gate read and OK publication hold the same row lock as cancellation |
| 51 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > abrupt process exit at PDF hardlink window recovers only proven staging twins |
| 52 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > abrupt process exit at RES hardlink window recovers only proven staging twins |
| 53 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > abrupt process exit at BACKUP hardlink window recovers only proven staging twins |
| 54 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > abrupt process exit at OK hardlink window recovers only proven staging twins |
| 55 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > simulated receiver pickup is unconfirmed, timeout creates work, CLI records synthetic confirmation/history/status |
| 56 | SKIP | B | tests/contracts/p6-native.test.ts | P6 native PostgreSQL 17: isolated sandbox only > existing application worker processes the P6 queue only with explicit opt-in; audit and migrations remain valid |
| 57 | SKIP | C | tests/contracts/p7-safety-native.test.ts | native P7 owner/app_rw reject clinical state INSERT/UPDATE; ordinary lifecycle and independent AL5 HOLD survive |
| 58 | SKIP | A | tests/db/concurrency.test.ts | isolated native PostgreSQL concurrency > serializes eight genuinely concurrent registration transactions across clients |
| 59 | SKIP | F | tests/db/settings-zip-simulation.test.ts | Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files > A. PET reception: Settings path → worker → registry/worklist; read-only source; missing OK, duplicate, invalid, non-NIPT and identity conflict |
| 60 | SKIP | F | tests/db/settings-zip-simulation.test.ts | Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files > B. changing the inbound path while running: new path only, old configuration refused, errors visible, recovery and rollback |
| 61 | SKIP | F | tests/db/settings-zip-simulation.test.ts | Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files > C. external result PDFs from the ZIP: Settings folder → worker scan/preview → parse equals cases.csv; P5-A never links an unclear match; switch folders |
| 62 | SKIP | F | tests/db/settings-zip-simulation.test.ts | Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files > D. HIS delivery through Settings: RES/PDF/OK equal the ZIP expected output (de-identified), order, backup, idempotency, failure/retry |
