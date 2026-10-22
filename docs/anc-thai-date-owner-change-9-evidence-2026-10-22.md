# ANC Thai Date Input — Owner Change 9

2026-10-22 · **PASS — READY FOR OWNER TEST (Local Development)** · **OWNER-UAT = PENDING**

Subsequent Owner-approved Toast update: current runtime **afd67341278c80c54629f808fa7eca4c16aca68e** / `.local/save-toast-uat-source`; [current evidence and launch commands](save-success-toast-evidence-2026-10-22.md). The date-patch SHA/tests below remain evidence for that patch, retained intact; final Toast Browser checks also confirmed saved DOB/EDD ISO unchanged.

คำสั่ง Owner: attachment `35f18596-8809-41bc-8d69-ba1e7ac12ba5/Pasted text.txt` ให้แก้วันที่ ANC โดยรักษา LAB baseline และข้อมูล UAT เดิม การเปลี่ยนแปลงนี้เป็น Patch แยกจาก LAB-01–13; ไม่เพิ่ม Workflow หรือเกณฑ์คลินิก

## Source และ Runtime

- LAB baseline: `56175ded59b9624768d2f157c520b0505dd67404` — retained Full Regression **2364 PASS / 0 FAIL / 62 SKIP**, Native PostgreSQL 3 suites เดิมแยกต่างหาก ไม่รันซ้ำและไม่นับเป็นผล Full Regression ของ Patch นี้
- Date patch: local commit **`b14a4ea331872a15c4011fbc73482bfa57184122`**, parent เป็น baseline ข้างต้น เปลี่ยนเฉพาะ 5 ไฟล์ด้านล่าง ไม่มี Migration
- Clean build snapshot: `.local/anc-date-uat-source`, detached ที่ Patch SHA และ `git status --porcelain` ว่าง; snapshot เดิม `.local/lab-uat-source` ยังอยู่ที่ LAB baseline
- Web, Worker และ Renderer อ่าน baked `/app/build-provenance.json` แล้วตรงกับ Patch SHA ทั้งสามตัว Migration inventory ยังเป็น `43f663d903641a33e0836c75b1ad45828215ba832f9b915bdefa900cbd50ce21` เหมือน baseline
- Focused tests ทำใน primary worktree ที่ HEAD Patch โดยรักษา unrelated dirty files; runtime build ใช้ clean snapshot จึงไม่รวม ANC dashboard/CSS/registry/test ที่ Owner แก้ค้างไว้ ไม่ได้อ้างว่า primary worktree ทั้งต้นไม้สะอาด
- ไม่มี Push, Merge, Production Deploy, Hospital access, Database reset หรือ Upgrade EXE

## ไฟล์ใน Patch

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `packages/domain/thai-date.ts` | รับ DDMMBBBB และ compact date พร้อมเวลา; แปลง พ.ศ. เป็น ISO ค.ศ. ครั้งเดียว ใช้ validation วันจริงเดิม |
| `src/components/shared/thai-date-input.tsx` | จัดรูปแบบทันทีเมื่อครบ 8 หลัก รักษา caret และข้อความที่ยังผิด; ไม่ emit ค่าว่างจาก validation failure; native custom validity และ optional validity callback; คง Calendar เดิม |
| `src/components/p2/request-form.tsx` | ติดตาม invalid date draft แยกจาก ISO; ระงับ autosave/save/confirm และการเปลี่ยนหมวดที่อาจซ่อน invalid draft พร้อมข้อความและ focus; แก้ได้หรือล้างโดยตั้งใจ |
| `tests/unit/thai-date.test.ts` | เพิ่ม compact dates/datetime, leap/invalid/CE rejection และ compatibility |
| `tests/unit/thai-date-input.test.ts` | Bundle component จริงด้วย React แล้วทดสอบใน Chromium รวม invalid saved value, sequential typing, caret, calendar, intentional clear, required และ datetime |

ไม่มีการเปลี่ยน Lab Registration EDC แบบ MM/DD/YYYY ค.ศ., PET/HIS/GA/LN Halos, clinical/release logic หรือสูตรวิเคราะห์ Shared component ใช้ ISO/wall ISO contract เดิม

## ผลตามข้อกำหนด

| รายการ | ผล | หลักฐานจริง |
|---|---|---|
| `21102569` → `21/10/2569` → `2026-10-21` | PASS | Parser/component และ ANC EDD/collection ใน Browser, POST, API, PostgreSQL |
| `02052532` → `02/05/2532` → `1989-05-02` | PASS | ANC DOB พิมพ์ทีละหลัก, Save/Reload, PostgreSQL และ PDF |
| Clipboard paste 8 หลัก | PASS | Browser ใช้ `navigator.clipboard.writeText` + Ctrl+V: `29022567` → `29/02/2567` → `2024-02-29` |
| รูปแบบเดิม / - . | PASS | Parser tests ทุกตัวคั่น; Browser slash และ hyphen ตามด้วย blur |
| วันไม่มีจริง/Leap Year/ปี ค.ศ. | PASS | `31022569`, `29022569`, `21102026` ไม่ยอมรับ; `29022567` ยอมรับ |
| Invalid draft ไม่ล้างวันที่เดิม | PASS | EDD ที่บันทึกแล้วถูกแก้เป็น 31/02/2569 รอเกิน autosave 900ms, blur/Save/เปลี่ยนหมวด: ข้อความผิดยังอยู่, ISO เดิมและ workspace version ไม่เปลี่ยน; error แสดงชัดเจน |
| Save/confirm ไม่รับวันที่ผิดเงียบ ๆ | PASS | Browser Save/nav ถูกกัน; confirm เรียก save ที่ใช้ invalid-draft gate เดียวกัน, required validation เดิมยังอยู่; actual component native form submission ถูกกันด้วย custom validity |
| ล้างโดยตั้งใจ | PASS | Browser ล้าง ultrasound → null จริง; component optional clear และ required clear ไม่ผ่าน native validity |
| Cursor/Keyboard/Calendar | PASS | Sequential caret=10, middle edit caret=2; Calendar ลูกศรขวา + Enter เลือกวัน พ.ศ. ได้; ไม่มี picker ใหม่ |
| ครบ 5 หมวดของ Request | PASS | หมวด1 DOB; หมวด2 EDD/Ultrasound/Collection/conditional Vanishing Date; เปิดหมวด3–5 และตรวจ source แล้วไม่มี date controls เพิ่ม |
| Mobile | PASS (Browser) | Viewport 375px, `inputmode=numeric`, ไม่มี document horizontal overflow; ไม่อ้างว่าทดสอบแป้นพิมพ์โทรศัพท์จริง |
| ThaiDateTimeInput | PASS | Parser/component compact date+time, invalid datetime รักษา wall ISO เดิม, Calendar รักษาเวลา |
| Shared Paper/Lab/Result regression | PASS (affected automated/source) | Real shared component test; P2/P3/PDF/Paper link, Lab PDF/parity/owner exports และ P5 gates tests; source consumers/EDC แยกจากช่อง BE ยืนยันแล้ว ไม่อ้างว่าออกผลใหม่ผ่าน Browser ใน Patch นี้ |
| PDF Preview จริง | PASS | ANC Preview route คืน application/pdf, DRAFT_PREVIEW; Browser คลิกลิงก์ Preview หลัง Restart ได้ PDF200; extract text และ raster ตรวจ DOB 02/05/2532, EDD/Collection21/10/2569 ในช่องตัวเลขของ DCC Master |
| ข้อมูลเดิมและ Restart | PASS | ก่อน rebuild 59เคส/4Batch/3Release + artifact16 ชิ้น; หลัง rebuild hash19กลุ่มข้อมูลและ artifact16ตรงกัน; หลังเพิ่มเคสทดสอบเป็น60เคสและ Restart ยังตรงกัน; เปิด ANC ใหม่หลัง Restart แสดง พ.ศ./API ISO เดิม |
| Health/Source alignment | PASS | ready=true; Web/Worker/Renderer baked SHA ตรง Patch; Worker FRESH, Renderer200, Excel bridge IDLE, Master SHAเดิม, loopback-only |

## Incremental validation ที่รันจริง

หลักฐานทั้งหมดอยู่ `.local/anc-date-evidence/` ไม่รวม password/connection string ในรายงาน

| Command/ขอบเขต | ผล | Log |
|---|---|---|
| `npx.cmd vitest run tests/unit/thai-date.test.ts tests/unit/thai-date-input.test.ts tests/unit/p2-request-progress.test.ts tests/unit/p2-operational-ui.test.ts tests/unit/lab-paper-redraw-gate.test.ts tests/contracts/lab-owner-nifty.test.ts tests/contracts/lab-owner-task-import.test.ts` | 7 files, **37 PASS** | `final-focused.log` |
| `npx.cmd vitest run tests/unit/anc-forms-fields.test.ts tests/unit/p2-pdf.test.ts tests/unit/p2-domain.test.ts tests/unit/p4-pdf.test.ts tests/unit/p4-parity.test.ts tests/unit/p5-gates.test.ts tests/contracts/p2-p3-integration.test.ts` | 7 files, **51 PASS** | `affected-regression-final.log` |
| `npx.cmd vitest run tests/db/p2.test.ts tests/db/p5-paper-link.test.ts` | 2 files, **27 PASS** | `affected-db-final.log` |
| `npm.cmd run typecheck` | PASS | `typecheck-final.log` |
| `npm.cmd run lint` | PASS, max warnings0 | `lint.log` |
| `npm.cmd run guard` | PASS,1058files | `guard-final.log` |
| Home-UAT Start from clean snapshot / production Next build | PASS | `build-start.log` |
| Browser ANC/API/DB/PDF | PASS | `browser-final.log`, `browser-result.json`, `browser-save-date-payloads.json`, `persisted-date-values.json` |
| Rebuild preservation / Restart | PASS | `persistence-before.json`, `persistence-after.json`, `owner-restart-persistence.json`, `restart/owner-restart-persistence.json`, `restart.log`, `post-restart-dates.json` |
| Final health/provenance | PASS | `final-health.json`, `final-runtime-provenance.json` |

รวม affected automated tests **115 PASS / 0 FAIL / 0 SKIP** ใน16ไฟล์ ไม่ได้รัน Full Regression ซ้ำ TDD red หลักฐานเดิม `parser-red.log`/`component-red.log` ถูกเก็บไว้ ผล harness ระหว่างพัฒนาที่ไม่ผ่านไม่ถูกนับเป็นผลสุดท้าย: แก้ Windows URL decoding, PDF boxed-digit assertion และ Preview response timing โดยไม่เปลี่ยน expectation วันที่หรือ Source เพื่อหลบ failure

## Owner ทดสอบต่อ

- URL: **https://127.0.0.1:19548/login** (Development PC เท่านั้น)
- Login: `uat.anc` สำหรับ ANC; account/password อยู่ไฟล์ป้องกัน `.local/owner-local-uat-1.0.2/credentials.txt` ไม่คัดลอกรหัสผ่านลงรายงาน
- เคสทดสอบใหม่ LN `9903001900`, HN `9900041900`, case `3e182abf-0c20-4e94-b56e-3e6ce374b824` ใน LOCAL_UAT unit เท่านั้น ไม่มี clinical approval/signature/result ปลอม เคสเดิมไม่ถูกนำมาแก้
- เปิดแบบขอส่งตรวจ5หมวด → DOB `02052532` → หมวด2 EDD `21102569` → บันทึก/Reload → ทดลองกรอกผิดแล้ว Save → แก้กลับถูก → เปิดดูตัวอย่างใบขอส่งตรวจ
- PDF: `.local/anc-date-evidence/anc-date-request-preview.pdf`; SHA256 `44c15961a2207a318b9b9686069e5c0e865eabddb52c3b1916d34500e2a5823f`; ภาพตรวจ `anc-date-request-preview-final.png`; ภาพ invalid/mobile แยกไว้ในโฟลเดอร์เดียวกัน PDF เป็นร่างตามจริง ข้อมูลที่ยังไม่กรอกเว้นว่าง ไม่มีลายเซ็นที่สร้างขึ้น

เปิด/ตรวจ/ปิด จาก worktree นี้:

```powershell
& tools/operational/Home-UAT.ps1 -Action Start -SourceSnapshot '.local/anc-date-uat-source'
& tools/operational/Home-UAT.ps1 -Action Health -SourceSnapshot '.local/anc-date-uat-source'
& tools/operational/Home-UAT.ps1 -Action Restart -SourceSnapshot '.local/anc-date-uat-source'
& tools/operational/Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/anc-date-uat-source'
```

Unrelated dirty changes ทั้ง5ไฟล์และเอกสาร Owner เดิมยังอยู่ ไม่ถูก stage ใน Patch; 4ไฟล์นอก registry ตรง original hash inventory ส่วน registry เป็น diffเดิมที่ตรวจแยกไว้ก่อน Patch ไม่อ้างว่า inventory เก่าครอบคลุมการแก้จาก Owner ภายหลังทั้งหมด

ข้อจำกัดเดิมยังคงเดิม: **OWNER-UAT=PENDING**, Hospital/HIS/clinical/physical hardware acceptance ยังไม่ถูกอ้างว่าผ่าน; P5H real historical promotion ยังรอวัน Go-live จริงและไม่ได้ตั้ง cutoff ใน persistent UAT งาน Patch นี้ไม่มี BLOCKED ที่ขัดขวางการทดสอบวันที่ Local
