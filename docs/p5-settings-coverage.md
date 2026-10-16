# Settings Coverage Matrix (Admin source re-audit)

Generated from `packages/settings/coverage.ts`; the unit test `tests/unit/p5-settings.test.ts` fails if this file drifts.
Sources: Plan v6.2.1 §13.1–§13.2 (SHA-256 `261acf8c…3c2e`), NIPTY settings seed (`app/database.py`, identical 25 keys in NIPTY.zip v1.4.3 and NIPTY_handover.zip), current NIPT CBH source.

Status: **Implemented** configurable/enforced and consumed now · **Partial** stored or simulator-only · **Missing** due by its phase but absent · **Deferred** later phase (P5H/P6/P7) · **HOLD** waits for an Owner/IT decision.

Installation-owned = operator/deployment responsibility; Locked = intentional fixed contract. See `docs/admin-settings-audit.md` for the nine evidence dimensions for every row.

## Summary

| # | หมวด | Implemented | Partial | Missing | Deferred | HOLD | Installation-owned | Locked |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | General | 2 | 0 | 0 | 0 | 0 | 2 | 3 |
| 2 | ANC / Request & Consent | 0 | 2 | 1 | 0 | 6 | 0 | 0 |
| 3 | ANC Doctors | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| 4 | User / Role / Permission | 1 | 0 | 0 | 0 | 1 | 0 | 3 |
| 5 | HIS Inbound | 8 | 1 | 0 | 0 | 1 | 0 | 2 |
| 6 | Laboratory | 1 | 3 | 1 | 0 | 11 | 0 | 0 |
| 7 | Result Management | 16 | 1 | 0 | 0 | 8 | 0 | 0 |
| 8 | HIS Outbound / CFS | 10 | 0 | 0 | 0 | 2 | 0 | 0 |
| 9 | Storage / NAS / Backup | 0 | 1 | 0 | 0 | 0 | 5 | 0 |
| 10 | Notifications / System / Audit | 1 | 1 | 3 | 1 | 1 | 1 | 0 |

## 1. General

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| ชื่อระบบ | §13.2 #1 | — | general.systemName | Implemented | P1 | Active general revision is read by protected layout Sidebar; documents/provenance unchanged |
| โลโก้ | §13.2 #1 | — | — | Installation-owned | P1 | No public brand assets or upload endpoint. Approved workbook/PDF logos remain controlled source assets; installer may provision a separately approved UI asset later |
| หน่วยงาน | §13.2 #1 | ward_master.csv | unit + packages/admin/service.ts + /settings/units | Implemented | P1 | Browser create/edit/search/pagination/Inactive; unused code correction only; all FK/pending scope references protected |
| รูปแบบวัน/เวลาไทย | §13.2 #1 | thai_date.py | — | Locked | P1 | Asia/Bangkok date format is enforced by code; not a mutable setting |
| Timezone Asia/Bangkok (ล็อก) | §13.2 #1 | — | general.timezone | Locked | P1 | Literal ใน Schema |
| Session timeout | §13.2 #1 | — | security.idleMinutes / absoluteHours | Locked | P1 | อยู่ในหมวด 4 และล็อกตาม Baseline |
| Host / Port ของเครื่องแม่ข่าย | — | server_host, server_port | — | Installation-owned | P7 | APP_ORIGIN, service ports, HTTPS and DB target are installation configuration |

## 2. ANC / Request & Consent

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| ชุดฟิลด์บังคับ (ยืนยัน vs ก่อน Batch) | §13.2 #2 | — | packages/p2/schema.ts | Partial | P2 | บังคับในโค้ด ยังไม่เป็น Setting แบบมีรุ่น |
| รุ่นแบบฟอร์ม FM-01/FM-02 | §13.2 #2 | — | request_consent.templateVersion | Partial | P2 | Stored revision has no templateVersion consumer; editor labels NOT IMPLEMENTED/read-only. P2 uses documentTemplate(), including operational templates; DCC-controlled |
| ช่องทางที่เปิดใช้และการผสม | §13.2 #2 (OD-06) | — | request_consent.mode | HOLD | P2 | Global request_consent.mode has no active runtime consumer; Web/API read-only NOT IMPLEMENTED. Existing case-specific request/consent modes and OD-06 guards retained |
| ตัวระบุขั้นต่ำตอนลงทะเบียน | §13.2 #2 (OD-15) | — | — | HOLD | P2 | OD-15 |
| Paper path P1/P2/P3 + ผู้ตรวจ | §13.2 #2 (OD-06) | — | p2_paper_review | HOLD | P2 | กลไกมี นโยบายรอ OD-06 |
| เกณฑ์ระยะเวลาเตือน | §13.2 #2 | — | — | Missing | P2 | ยังไม่มี |
| ฟิลด์บันทึกการเก็บตัวอย่างรอบใหม่ + Applicability | §13.2 #2 (OD-16) | — | — | HOLD | P4 | OD-16 |
| แหล่งวันที่เจาะของรอบ ≥ 2 | §13.2 #2 (OD-14) | — | — | HOLD | P4 | OD-14 |
| ช่องทาง Request/Consent ของเคสที่ Lab ลงทะเบียน | §13.2 #2 (OD-25) | — | — | HOLD | P2 | OD-25 |

## 3. ANC Doctors

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| แพทย์ ใบอนุญาต ลายเซ็นเวอร์ชัน หลักฐาน | §13.2 #3 | — | หน้าทะเบียนแพทย์จำลอง (Maker-Checker) | Implemented | P2 | จัดการในหน้าทะเบียนแพทย์ ไม่ใช่หน้าตั้งค่า |
| รุ่นทะเบียนแพทย์ | §13.2 #3 | — | doctor_registry.version | Partial | P2 | Stored version has no runtime consumer; read-only NOT IMPLEMENTED. Reuse existing versioned Doctor Registry |

## 4. User / Role / Permission

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| Role / Scope ผู้ใช้ | §13.2 #4 | users_routes.py | role_assignment, user_unit_scope, user_permission + admin_access_request | Implemented | P1 | APP_ADMIN proposes, independent CLINICAL_APPROVER checks; no self-target; session revocation and audit; 9 existing roles |
| Password policy | §13.2 #4 | — | packages/security/password.ts | Locked | P1 | ล็อกในโค้ด |
| Lockout | §13.2 #4 | — | security.lockoutAttempts / lockoutMinutes | Locked | P1 | Literal ตาม Baseline |
| Session | §13.2 #4 | — | security.idleMinutes / absoluteHours | Locked | P1 | Literal ตาม Baseline |
| นโยบาย SoD (OD-04) | §13.2 #4 | — | result.link.manual (P/A), RG-13 | HOLD | P5 | Synthetic restrictions retained. Operational baseline has source-bound reviews/release gates in 086/088/089; this Admin work grants no new clinical authority |

## 5. HIS Inbound

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| Server / Share / Base path | §13.2 #5 | path_request | his_inbound.basePath | Implemented | P3/P6 | Active Settings + Local/UNC Allowed Test Root; ผู้ป่วยจริง HOLD AL-3 |
| รูปแบบโฟลเดอร์รายวัน | §13.2 #5 | path_request (YYYYMMDD) | packages/inbound/discovery.ts | Implemented | P3 | บังคับในโค้ด |
| Section / Test code | §13.2 #5 | nipt_testcode | his_inbound.section / testCode | Locked | P3 | Literal ตาม LOCKED §7.1 |
| Interval | §13.2 #5 | pet_scan_interval_min | his_inbound.intervalSeconds | Implemented | P3 | — |
| Lookback | §13.2 #5 | pet_scan_days_back | his_inbound.lookbackDays | Implemented | P3 | — |
| เปิด/ปิดการสแกน | §13.2 #5 | pet_autoimport_enabled | his_inbound.enabled | Implemented | P3 | — |
| Deep scan / Scan now / ดู Log | §13.2 #5 | — | หน้า รับใบสั่งจาก HIS | Implemented | P3 | — |
| Test Connection (Read-only) | §13.2 #5 | test_path(read_only) | synthetic_inbound_test (Worker) | Implemented | P3 | — |
| เกณฑ์เตือน .ok ขาด | §13.2 #5 | — | his_inbound_waiting | Partial | P3 | บันทึกไฟล์ที่รอ .ok แต่ยังไม่มีเกณฑ์เตือนแบบตั้งค่าได้ |
| Credential (Secret ref) | §13.2 #5 | — | his_inbound.secretRef | Implemented | P3/P6 | อ้างอิง Credential ที่ IT ผูกกับ Service Account ใน Share Policy; ไม่เก็บรหัสผ่านใน Settings |
| แหล่งวันที่เก็บตัวอย่างของ S1 | §13.2 #5 (OD-14) | — | — | HOLD | P3 | OD-14 |
| นำเข้า STAT workload (.txt) | — | path_workload, auto_scan_min | — | Locked | P3 | STAT replacement by PET is an intentional architectural lock, not an editable integration |

## 6. Laboratory

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| Batch template version | §13.2 #6 (OD-34) | — | laboratory.templateVersion | Partial | P4 | Active templateVersion is frozen as metadata in lab_batch/placement via pendingPolicy(); it does not select a runtime template. Read-only controlled metadata. Native artifacts bind master via 091/092/094 |
| Formula Spec / ค่าคงที่ / ความละเอียดปิเปต | §13.2 #6 (OD-28/29) | — | laboratory.formulaVersion | HOLD | P4b | Active formulaVersion is frozen as batch metadata only; calculation uses immutable FORMULA_VERSION/master inventory. Read-only metadata; no formula/pipette edits authorized |
| QC criteria QC1–QC5 | §13.2 #6 (OD-31) | — | lab_qc_criteria_version | HOLD | P4/P4b | OD-31 |
| Stability rules | §13.2 #6 (OD-33) | — | — | HOLD | P4 | OD-33 |
| Template F2–F6 + รหัสเอกสารควบคุม | §13.2 #6 (Q-G4) | — | — | HOLD | P4/P4b | Operational F2-F5 native controlled artifacts exist (092/094); F6 and DCC acceptance remain separate; no Admin template replacement |
| รูปแบบไฟล์ HALOS/SP100 | §13.2 #6 (OD-35) | — | laboratory.halosDataRows | Partial | P4b | Native HALOS export/readback + observed import exist in 086; 47-row lock retained; physical device acceptance external |
| รหัสเหตุผล Slot disposition | §13.2 #6 (OD-34) | — | DISPOSITION_REASONS (โค้ด) | HOLD | P4 | OD-34 |
| ผู้อนุมัติกู้คืน Downtime + แบบฟอร์มสำรอง | §13.2 #6 (OD-36) | — | — | HOLD | P4 | OD-36 |
| ทางเลือกหลัง HIS รับตัวอย่าง | §13.2 #6 (OD-01) | — | BG-02 PENDING | HOLD | P4 | OD-01 |
| รูปแบบ Lab ID / Suffix / ระดับ Repeat | §13.2 #6 (OD-03) | — | packages/lab/rules.ts | HOLD | P4 | Existing operational receipt/lineage/suffix guards in 084/090 retained; not configurable from Admin |
| รหัสเหตุผล Repeat/Redraw + ข้อความที่ ANC เห็น | §13.2 #6 (OD-11) | — | REDRAW_REASONS / REPEAT_REASONS (โค้ด) | HOLD | P4 | OD-11 |
| รายการตรวจตอนรับตัวอย่างเจาะซ้ำ | §13.2 #6 | — | specimen_round.receipt_check | Partial | P4 | บังคับ identity+label ในโค้ด ยังไม่เป็น Setting |
| เกณฑ์เตือนรอบที่รอรับนานเกิน / TAT | §13.2 #6 | alert_days | — | Missing | P4 | ยังไม่มีเกณฑ์เตือนแบบตั้งค่าได้ |
| Clinical rule set | §13.2 #6 (OD-08) | — | RULE_VERSION (โค้ด) | HOLD | P2 | Operational P2 evidence/review guard in 088 exists; clinical acceptance and rule changes remain governed |
| ผู้มีสิทธิ์ลงทะเบียนโดย Lab + หน่วยงานที่เห็นเคส | §13.2 #6 (OD-25) | — | — | HOLD | P2 | OD-25 |
| นโยบายเมื่อ Gate รอการตัดสินใจ | — | — | laboratory.pendingGovernanceGate | Implemented | P4 | HOLD หรือข้อมูลจำลองพร้อมป้าย |

## 7. Result Management

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| โฟลเดอร์ผล PDF (PDF Source Folder) | §11.1 / §13.2 #7 | path_pdfresult | result_management.pdfSourcePath | Implemented | P5 | Worker อ่านอย่างเดียว ตัวจำลอง simulator/results เท่านั้น |
| สแกนรวมโฟลเดอร์ย่อย | §11.1 | scan_pdf_folder_new (rglob) | result_management.scanSubfolders | Implemented | P5 | — |
| รับ ZIP / ZIP-as-PDF | §11.1 (F-08) | pdf_parser.py | result_management.acceptZip | Implemented | P5 | — |
| จำนวนไฟล์สูงสุดต่อการสแกน | §11.1 | — | result_management.maxFilesPerScan | Implemented | P5 | — |
| ขีดจำกัด Upload | §13.2 #7 | — | result_management.maxUploadMb | Implemented | P5 | ใช้กับไฟล์จากโฟลเดอร์และจากเครื่อง |
| Test Path (จาก Worker) | §13.2 #7 | test_path / test_all_paths | synthetic_result_test_path (Worker) | Implemented | P5 | — |
| Parse ไฟล์ตัวอย่าง (Dry-run) | §13.2 #7 | /import/pdf/preview | Preview ก่อนยืนยันนำเข้า | Implemented | P5 | Preview ไม่สร้างรายงานจนกว่าจะยืนยัน |
| โฟลเดอร์ที่นำเข้าล่าสุด | — | get_latest_pdf_source_folder | หน้า ผลตรวจ | Implemented | P5 | — |
| สแกนโฟลเดอร์ผลตามรอบเวลา (ค้นหาและแสดงรายการเท่านั้น) | Owner A23 | auto_scan_min | result_management.scheduledScanMinutes | Implemented | P5 | Owner A23: 0 = ปิด (ค่าเริ่มต้น); เปิดได้เฉพาะผ่าน Maker-Checker; Worker อ่านอย่างเดียว |
| ห้ามนำเข้า/เชื่อมโยง/รับรอง/ปล่อยผลอัตโนมัติจากการสแกน | Owner A23 | — | SCHEDULED_SCAN_LIST_ONLY (Worker) | Implemented | P5 | บังคับในโค้ดและทดสอบว่าการสแกนตามรอบไม่สร้าง Intake/Report |
| ตรวจไฟล์ซ้ำด้วย SHA-256 + เตือนชื่อซ้ำเนื้อหาต่าง | Owner A14 | file_hash, raw_filename (import_log) | result_report_version.sha256 + nameConflicts + result_link_event.name_review | Implemented | P5 | Owner A14: ไม่ข้ามเพราะชื่อซ้ำ; ต้องรับทราบตอนนำเข้าและจัดประเภทใหม่/ฉบับแก้ไขโดยสองคน |
| รุ่น Template / Parser | §13.2 #7 | — | PARSER_VERSION, TEMPLATE_VERSIONS | Partial | P5 | Actual parser/template versions are frozen per report. picVersion Setting is not parser selection; Owner/DCC approvals remain external |
| PIC version | §13.2 #7 (OD-07) | — | result_management.picVersion | HOLD | P5 | OD-07; ใช้ MANUAL_REVIEWED เท่านั้น |
| ความคลาดเคลื่อน GA | §13.2 #7 | — | result_management.gaToleranceDays | Implemented | P5 | ใช้ใน Cross-check RG-04 |
| วิธียืนยันการรับรอง | §13.2 #7 (OD-05) | — | result_management.certificationMethod | HOLD | P5 | OD-05 |
| การรับทราบผลผิดปกติ | §13.2 #7 | — | Dialog รับรอง (abnormalAcknowledged) | Implemented | P5 | บังคับเมื่อผล High Risk / Detected |
| กฎการเปิดเผยเพศ | §13.2 #7 (OD-09) | — | result_management.sexDisclosureRule / RG-11 | HOLD | P5 | ข้อเสนอถูกบังคับเป็น FAIL/PENDING ใน RG-11 |
| การเก็บตัวอย่างใหม่หลังออกผล | §13.2 #7 (OD-17) | — | result_management.postReleaseRecollection | HOLD | P5 | OD-17 |
| ช่องทางหนังสือแจ้ง | §13.2 #7 (OD-07) | — | result_management.noticeChannel / RN-07 | HOLD | P5 | ค่าระหว่างรอ: ใน NIPT เท่านั้น |
| สิทธิ์ปล่อยผลจริง | AL-5 | — | result_management.releaseAuthority + p5_release_authorized() | HOLD | P5 | HOLD_AL5 catalog literal is retained; operational baseline separately enforces p5_release_authorized/current reviewed evidence in 086/088/089. Admin changes do not enable release |
| go_live_cutoff (Versioned + Maker-Checker + รายงานผลกระทบ) | §13.1 / §13.2 #7 (D-50, OD-27) | — | go_live_cutoff + settings_activation_guard | Implemented | P5H | packages/historical/service.ts reads active cutoff version; maker-checker and historical-case guard remain. No default cutoff is invented |
| ชุดข้อมูลขั้นต่ำ/Anchor ของเคสย้อนหลัง | §13.2 #7 (OD-18) | — | historical_backfill.anchorPolicy / minimumProfile | HOLD | P5H | OD-18: ค่า PENDING ทำให้ประเมินไม่ผ่านทุกเคส (Fail Closed) |
| ผู้ตรวจเคสย้อนหลัง | §13.2 #7 (OD-19) | — | HISTORICAL_VERIFIER + packages/historical/service.ts | Implemented | P5H | Existing separate verifier permission and independent review; owner policy/eligibility still required |
| การแสดงผลเคสย้อนหลัง | §13.2 #7 (OD-20) | — | /historical + packages/historical/service.ts | Implemented | P5H | Existing drafts/promoted list/detail and evidence; reviewable software, not acceptance |
| การมองเห็นของ ANC ต่อผลย้อนหลัง | §13.2 #7 (OD-21) | — | — | HOLD | P5H | No ANC historical visibility policy inferred; existing denial remains |

## 8. HIS Outbound / CFS

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| ปลายทาง (Path + Secret) | §13.2 #8 | path_resoutput, path_pdfrename | his_outbound.resDestinationPath / pdfDestinationPath / backupPath / secretRef | Implemented | P6 | Synthetic Authorized Test Share เท่านั้น; Clinical HOLD AL-5/6 |
| Sandbox เป็นค่าเริ่มต้น | §13.2 #8 | — | his_outbound.target = SIMULATOR | Implemented | P1 | SIMULATOR is the default, not a schema literal. Existing operational AUTHORIZED_SHARE path remains separately guarded |
| Production outbound authorized | §13.2 #8 | — | his_outbound.productionAuthorized = false | Implemented | P6 | Existing operational-only productionAuthorized consumer in p6 release path + runtime/DB/approved settings guards; synthetic mode cannot gain authority |
| RES profile (HL7 fields) | §13.2 #8 | hl7_sender, hl7_receiver, hl7_specimen_code, hl7_o_field18, hl7_accession_sfx, hl7_operator_id, hl7_ward_id, hl7_ward_name | his_outbound.resProfile + packages/p6/res.ts | Implemented | P6 | Validated and frozen active RES profile; hospital mapping acceptance external |
| รูปแบบชื่อ PDF | §13.2 #8 | pdf_template, hospital_suffix | his_outbound.resProfile.pdfTemplate + packages/p6/res.ts + packages/p6/transfer.ts | Implemented | P6 | Validated naming profile is frozen per transfer; existing files never renamed or overwritten |
| Result style | §13.2 #8 | nipt_result_style | his_outbound.resultStyle | Implemented | P6 | ผูกกับ RES Profile ใน Frozen Transfer ของ Active Settings |
| ข้อความผลใน .res | — | nipt_result_text | his_outbound.resProfile + packages/p6/res.ts resultText() | Implemented | P6 | Frozen profile/style consumed during serialization; no clinical value invented |
| ความยาว R[3] | §13.2 #8 | — | his_outbound.resProfile.maxResultCodeUnits + packages/p6/res.ts | Implemented | P6 | Escaped R[3] code unit limit checked before delivery |
| วันที่เก็บตัวอย่างใน .res ของรอบ ≥ 2 | §13.2 #8 (Q-I5) | — | his_outbound.round2SpecimenDatePolicy = null | HOLD | P6 | Existing operational source supports explicitly configured CURRENT_ROUND/ORIGINAL_ORDER; null stays fail closed; no mapping chosen here |
| Retry / Backoff | §13.2 #8 | — | his_outbound.retryLimit / retryDelaySeconds | Implemented | P6 | P6 Journal/Backoff/Recovery เดิม; Settings UI แสดง History/Error/Retry |
| นโยบาย Evidence / Timeout | §13.2 #8 | — | his_outbound.confirmationTimeoutSeconds | Implemented | P6 | Synthetic Timeout; Pickup/OK ไม่ยืนยัน HIS; Clinical Evidence Acceptance ยัง HOLD |
| ช่องทางหนังสือแจ้ง/ผลแก้ไข | §13.2 #8 (OD-07) | — | — | HOLD | P6 | OD-07 |

## 9. Storage / NAS / Backup

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| ที่เก็บไฟล์ | §13.2 #9 | — | FILE_STORE_ROOT (ค่าติดตั้ง) | Installation-owned | P1 | FILE_STORE_ROOT content-addressed storage; Web cannot move or replace storage roots |
| เป้าหมาย Backup | §13.2 #9 | — | storage_backup.target = SIMULATOR | Installation-owned | P7 | Existing Operational Backup policy/service account/encryption are IT-owned; catalog SIMULATOR is not the operational backup target |
| ตารางเวลา Backup | §13.2 #9 | — | — | Installation-owned | P7 | Backup scheduling is an operator/service responsibility; no web scheduler added |
| Retention ของ Backup | §13.2 #9 | — | storage_backup.retentionDays | Installation-owned | P7 | retentionDays is unused legacy metadata; read-only and new proposals rejected. No automatic deletion or retention enforcement claimed |
| ตาราง Restore test | §13.2 #9 | — | — | Installation-owned | P7 | Restore drill scheduling/acceptance operator-owned; monitoring explicitly NOT VERIFIED without authoritative telemetry |
| เกณฑ์ความจุ | §13.2 #9 | — | src/server/health.ts storageHealth() | Partial | P7 | statfs measures configured File Store filesystem; fixed 1 GiB warning. Network quotas and hospital threshold acceptance are not inferred |

## 10. Notifications / System / Audit

| รายการ | Plan | NIPTY | NIPT CBH | สถานะ | Phase | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- |
| เกณฑ์ Alert (Worker/Backlog) | §13.2 #10 | — | notifications.staleSeconds / backlogWarning | Implemented | P1 | Active staleSeconds/backlogWarning now consumed by runtime-specific Health calculator; defaults only when no active revision |
| ผู้รับตาม Role | §13.2 #10 | — | — | Missing | P1 | In-app visibility uses health.read Matrix. No recipient routing/provider or external delivery; not an implemented per-role recipient configuration |
| อีเมลภายใน | §13.2 #10 (Q-I6) | — | — | HOLD | P7 | Q-I6 |
| การเก็บ Log | §13.2 #10 | — | — | Installation-owned | P1 | Audit chain is immutable/permanent. Service log rotation/retention is IT-owned; no web deletion |
| อายุคิวในศูนย์แก้ไขความขัดแย้ง | §13.2 #10 | — | — | Missing | P3 | — |
| ผู้รับรายงานการรับตัวอย่างเจาะซ้ำรายวัน | §13.2 #10 | — | — | Missing | P4 | — |
| ผู้รับรายงานการลงทะเบียน/บันทึกย้อนหลังรายวัน | §13.2 #10 | — | — | Deferred | P5H | — |
| ส่ง Alert ทดสอบ | §13.2 #10 | — | src/components/local-alert-test.tsx | Partial | P1 | Local-only labelled browser simulation; no outbound message or backend incident fabricated |
