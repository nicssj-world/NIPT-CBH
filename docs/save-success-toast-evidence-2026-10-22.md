# Toast หลังบันทึกสำเร็จ

Subsequent runtime update: **c7cba91**, clean `.local/ln-highlight-uat-source`, restores existing overview/registry LN links and highlights while retaining this Toast patch. [Current runtime/launch evidence](ln-highlight-restoration-evidence-2026-10-22.md). The Toast-specific SHA/checks below remain historical evidence for that patch.

2026-10-22 · Owner approved: “ใช้ Toast ตามที่แนะนำ” — ข้อความ **บันทึกสำเร็จ**, หายเองประมาณ3วินาที มีปุ่มปิด คงสถานะ Auto-save เดิม

Status: **PASS — เปิดใช้งานใน Local UAT แล้ว**. **OWNER-UAT=PENDING**. Final source/runtime SHA `afd67341278c80c54629f808fa7eca4c16aca68e` ตรงกันทั้ง Web/Worker/Renderer; health ready=true, Worker FRESH, Renderer200, native Excel bridge IDLE, loopback-only และ Master/Migration inventory เดิม

## การเปลี่ยนแปลง

- เพิ่ม Toast กลางใน root layout, ใช้สีและฟอนต์เดิม รองรับ light/dark/mobile, live status สำหรับ screen reader และปุ่มปิด44px ไม่มีการแย่ง focus
- ใช้ native manual Popover และ Portal เข้า Dialog ที่เปิดอยู่ เพื่อให้ Toast มองเห็นและกดปิดได้จริง เมื่อฟอร์มปิดหรือถูกถอดออก Toast ย้ายกลับ body; หยุด timer ขณะ hover/focus และเริ่มเวลาใหม่เมื่อบันทึกครั้งถัดไป
- ANC กดบันทึกสำเร็จจึงแจ้ง รวมกรณี Auto-save บันทึกไว้แล้วและผู้ใช้กดบันทึกปิดฟอร์ม; ไม่แจ้งจาก Auto-save, invalid date, validation failure หรือ conflict
- เชื่อมคำสั่งเขียนที่ระบุชัดใน API helpers ของ ANC/LAB/Task List/QC/Pooling/Sequencing/Result/Manual/แก้ข้อมูลภาพ และ Admin; Settings แจ้งหลังบันทึก response สำเร็จและไม่ใช่ queued test การอ่าน/ค้นหา/Preview/Export/ทดสอบการเชื่อมต่อไม่ถูกเหมาว่าเป็นการบันทึก
- คงข้อความรายละเอียด/ข้อผิดพลาดเดิม รวมสถานะ clinical/review/HOLD; Toast บอกเฉพาะการบันทึกข้อมูล ไม่เปลี่ยนสิทธิ์หรือการอนุมัติ

Source: `5ef94de` + final correction **`afd67341278c80c54629f808fa7eca4c16aca68e`**, ต่อจาก ANC date patch `b14a4ea` และ LAB baseline `56175de`. Clean runtime source `.local/save-toast-uat-source`.

ไฟล์ Source ที่เปลี่ยน11ไฟล์ (รวม tests): root layout; `admin-console.tsx`, `settings-editor.tsx`, `p2/shared.tsx`, `p2/request-form.tsx`, `p4/lab-api.ts`; new `shared/save-notice.ts`, `shared/save-toast.tsx`, `shared/save-toast.module.css`; new tests `save-notice.test.ts`, `save-toast.test.ts`.

## ผลทดสอบ

หลักฐานใน `.local/save-toast-evidence/`:

| การตรวจ | ผล | หลักฐาน |
|---|---|---|
| Toast/notification + affected date/ANC/Result tests | 7files,35PASS | `affected-final.log`, final helper assertions `notice-final.log`, final modal lifecycle `lifecycle-final.log` |
| Settings/permissions regression | 3files,12PASS | `settings-regression.log` |
| Typecheck / Lint | PASS | `typecheck-final.log`, `lint-final.log` |
| Source guard | PASS | `guard.log` |
| Browser component จริง | PASS | Modal hit-test, focus preserved, close, survival after dialog removal, repeated-save timer, automatic dismissal,375px fit ใน `save-toast.test.ts` |
| Rebuild preservation | PASS (final build) | ก่อน/หลัง60cases,4batches,3releases,16artifacts;19data-group hashesตรงกัน ใน `persistence-before.json`/`persistence-after.json` |
| Final runtime Browser | PASS | `browser-result.json`/`browser-final.log`: รอ Server ACK จริงก่อนแจ้ง, ฟอร์มปิดแล้วยังแสดง, ปุ่มปิด, injected409 ไม่แจ้งสำเร็จ, Auto-saveเงียบ, explicit Save ที่ข้อมูลบันทึกแล้วแจ้งได้,3วินาทีหายเอง; ใช้เคส Synthetic ANC เดิมเท่านั้น |
| Accessibility/responsive | PASS (executed scope) | หน้าทดสอบจริง axe0violations/pageErrors0,375px no overflow; screenshots4ภาพ Desktop/Mobile Light/Dark. Component testตรวจ Toast เหนือ modal ด้วย hit-test/focus จริง; ไม่อ้างว่า Browser ครบทุกฟอร์ม |
| Final health/provenance | PASS | `final-health.json`, `final-runtime-provenance.json`, clean snapshotที่SHAข้างต้น |

Tests รวม **47 PASS / 0 FAIL** (10ไฟล์ ไม่บวกรอบตรวจย่อยซ้ำ). Full Regression2364/0/62 เดิมเป็นหลักฐาน LAB baseline ไม่ได้รันซ้ำในงาน Toast. ไม่มี migration/reset/push/merge/deploy/Hospital/EXE. Unrelated ANC/CSS/Registry/test edits และเอกสารเดิมคงอยู่ ไม่ stage รวมใน commits นี้

การแก้ระหว่างตรวจ: initial component hit-test พบ Popover นอก modal เป็น inert จึงแก้ Portal ก่อน final checks; Browser harness รอบแรกใช้ exact textกับสถานะที่มีคำนำหน้า “หมวด1/5” จึงปรับ locator ให้ตรง DOM โดยไม่เปลี่ยนพฤติกรรม/expectation ของแอป Final Browser ผ่านบน final SHA แล้ว ภาพหลักฐาน `toast-desktop-light.png`, `toast-1280-dark.png`, `toast-375-light.png`, `toast-375-dark.png` ถูกตรวจด้วยภาพจริง

## เปิดใช้งาน

URL https://127.0.0.1:19548/login · บัญชีและรหัสผ่านอยู่ใน protected `.local/owner-local-uat-1.0.2/credentials.txt`.

```powershell
& tools/operational/Home-UAT.ps1 -Action Start -SourceSnapshot '.local/save-toast-uat-source'
& tools/operational/Home-UAT.ps1 -Action Health -SourceSnapshot '.local/save-toast-uat-source'
& tools/operational/Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/save-toast-uat-source'
```

Owner ทดสอบ: Login `uat.anc` → เคส Synthetic LN9903001900 → เปิดแบบขอส่งตรวจ → แก้ข้อมูล → บันทึก → Toast “บันทึกสำเร็จ”; กรอกวันที่ผิดแล้วบันทึกต้องไม่มี Toast สำเร็จ; Auto-save ใช้สถานะในฟอร์มเดิม

**OWNER-UAT=PENDING** จนกว่า Owner ทดสอบและยืนยันเอง
