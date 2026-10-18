# ANC Request (Fm-WI-T-BM17/01) and Consent (Fm-WI-T-BM17/02): auto-fill and preview

**Status:** technical DRAFT preview, built 2026-10-18 on `feat/task-list-parity-p0`. It is **not** a DCC-approved electronic controlled document. Every page carries a red banner and watermark saying "ฉบับร่างเพื่อดูตัวอย่าง (DRAFT PREVIEW) — ไม่ใช่เอกสารควบคุม · DCC ยังไม่อนุมัติ".

## Sources (read-only, outside the repository)

All four Owner files sit in `NIPT-Audit`. The draft mapping `CBH_NIPT_ANC_Forms_Autofill_Preview_Mapping_2026-10-18.md` was checked against them.

| File | Use |
|---|---|
| `FM-WI-T-BM17_01 ใบขอส่งตรวจคัดกรอง CBH-NIPT.pdf` (SHA-256 `c5b2bf…511b`, 595.2 × 841.92 pt, 1 page, 337 text items) | Layout reference **and** the request background page, embedded unchanged as a vector form |
| `FM-WI-T-BM17_02 เอกสารยินยอมรับการตรวจคัดกรอง CBH-NIPT(1).pdf` (SHA-256 `dc791b…f0332`, 594.96 × 842.04 pt, 1 page) | Layout reference **and** the consent background page, embedded unchanged |
| `Fm-WI-T-BM17_01 … .pptx`, `Fm-WI-T-BM17-02 … .docx` | Structure cross-check only. They are not rendered. The mapping notes that the DOCX reflows to 3 pages on another machine. |

**How the PDFs are used:**
- Field positions in `packages/forms/layout.ts` were measured from the PDFs' own text and box positions.
- The template pages are never edited. A transparent overlay carries only the recorded values.

**Template sets (OD-06).** The installation registry is a JSON file named by `NIPT_ANC_FORM_REGISTRY`. For each set it lists the files, their SHA-256 hashes, document codes and a known layout.
- The Owner reference set `CBH-BM17-REF-2026-10-18` has both hashes **pinned in code**.
- Every preview re-checks the hashes. A missing file, a hash mismatch or an unknown layout stops the preview.

## Request `/01`: field mapping (implemented)

| Printed field | Source in NIPT-CBH | Rule |
|---|---|---|
| ชื่อ-นามสกุล | `draft.patient.syntheticName` | Up to 2 lines; font shrinks only as needed |
| HN | `p2_case_identity.hn` (registration) | Printed as text; leading zeros kept |
| หมายเลขบัตรประชาชน | `draft.patient.identifier` | Blank if not recorded |
| วันเกิด (DD/MM/YYYY boxes) | `draft.patient.dob` | BE digits in the printed boxes |
| อายุ | DOB vs. collection date (today if no collection date) | Derived from recorded DOB only |
| น้ำหนัก / ส่วนสูง / BMI | `pregnancy.weightKg/heightCm`, BMI calculated | Blank if either input is missing |
| สิทธิ สปสช. / เรียกเก็บเงิน | `draft.patient.entitlement` text | Ticked only when the recorded text says so; otherwise both blank |
| เหตุผลในการส่งตรวจ | `ordering.reason` | Up to 2 lines |
| โรงพยาบาล/คลินิก | `ordering.facility` | |
| **แพทย์ผู้สั่งตรวจ** | **`ordering.doctorVersionId` → `p2_doctor_version.name`** (Doctor Registry) | Printed only if the version is active for the unit (same rule as `activeDoctor`). Never the user's name. Never a signature. |
| ผู้ประสานงาน / เบอร์โทร, อีเมล | `ordering.coordinator`, `ordering.phone`, `ordering.email` | |
| วันที่อัลตราซาวน์, วันกำหนดคลอด | `pregnancy.ultrasoundDate`, `pregnancy.edd` | BE digit boxes |
| อายุครรภ์ (สัปดาห์+วัน) | Calculated from EDD and collection date | Blank without a collection date |
| ครรภ์เดี่ยว / แฝด | `pregnancy.type` | `Unknown` leaves both boxes empty |
| ตัวอ่อนฝ่อ ไม่ใช่ / ใช่, GA found, เจาะหลัง 8 สัปดาห์ | `vanishingTwin`, `vanishingGaDays`, `drawEightWeeksAfterLoss` | Recorded answers only |
| เทคโนโลยีช่วยเจริญพันธุ์ | `pregnancy.art` | |
| ครั้งที่ / G/P/A | `gravida`, `para`, `abortion` | |
| ประวัติ 1–7 ใช่/ไม่ใช่ | `transfusion4months`, `heparin24h`, `immune1month`, `cancerTreatment`, `gaUnder8`, `tumor`, `priorChromosomeTest` | `null` or `Unknown` leaves the item blank (absent ≠ ไม่ใช่). Item 7 also prints method and result. |
| ข้อ 8 ระบุ | `otherHistory = Yes` → `otherDetails` | **Wording gap:** the paper says "family history of chromosomal disease"; the ANC screen says "8. ประวัติอื่น". DCC/clinic must confirm. |
| ความต้องการทราบเพศทารก | `pregnancy.fetalSex` | Singleton only. Twins never get a tick. |
| เจ้าหน้าที่เจาะ: วันที่ / เวลา | Latest `p2_collection_fact` of the round (the recorded collection) | Collector name and tube tick stay blank: not recorded |
| เจ้าหน้าที่รับตัวอย่าง: รับปกติ / ปฏิเสธ (เพราะ), วันที่ / เวลา | `specimen_acceptance` (Lab condition check) and `specimen_round.received_at` **only when received from the HIS PET** | No second reception is created. Signature lines stay blank. |
| ปั่นแยกพลาสมา | — | Not recorded in NIPT-CBH: blank |
| ข้อควรทราบ A / B | `acknowledgments.conditionA/B = Yes` | Recorded acknowledgement only; never inferred from GA or BMI |
| Sticker box | — | Left untouched |

## Consent `/02`: rules (implemented)

- **Clauses 1–12 and all wording** come from the template page itself and are never retyped.
- **"เข้าใจแล้ว" ticks** appear only when a completed electronic signing recorded all 12 acknowledgements (`p2_consent_ack` → `p2_final_consent`). Partial evidence gives no ticks. A verified paper review gives no ticks (the paper original holds them).
- **ยินยอม / ไม่ยินยอม** comes only from the completed signature decision or a verified paper review. Otherwise both boxes stay empty.
- **The service-user signing date** comes only from the recorded signature. No signature image is ever drawn, neither the patient's, the doctor's nor a representative's. The doctor's signing date stays blank.
- **Printed names in parentheses:** the patient name, and the doctor from the request's Doctor Registry selection.
- **Doctor mismatch:** if a prepared consent document names a different doctor, the name is left blank and the banner says "แพทย์ในเอกสารยินยอมไม่ตรงกับแพทย์ผู้สั่งตรวจ".
- **Status line:** ยังไม่ได้ลงนาม / ลงนามอิเล็กทรอนิกส์แล้ว (หลักฐานอยู่ในระบบ) / เอกสารกระดาษที่ตรวจแล้ว / เลือกใช้ Paper Consent — ไม่ใช่หลักฐานการลงนาม (marker only, see `docs/p2-paper-consent.md`) / ถอนความยินยอมแล้ว.
- Opening a preview never creates or changes consent evidence (test-proven).

**Fix made (Owner lock).** `prepareConsent` used to accept any doctor. It now:
- requires the request's ordering doctor (`ORDERING_DOCTOR_REQUIRED`);
- refuses any other doctor (`CONSENT_DOCTOR_MUST_MATCH_REQUEST`).

The consent dialog now shows that doctor read-only instead of a doctor picker.

## Preview

**Where:** the ANC case page has three buttons: **ดูตัวอย่างใบขอส่งตรวจ**, **ดูตัวอย่างใบยินยอม** and **ดูเอกสารรวม 2 หน้า**. They call `GET /api/p2/cases/<id>/forms?kind=request|consent|both&intent=preview|download|print`.

**Access:** permission `document.request.read`, as for other case documents. ANC in its unit, Lab and certifier are allowed; the auditor and other units are refused.

**What the PDF is:**
- A4. The request has 1 page, the consent 1 page, and the combined document 2 pages. Pages keep each template's exact size.
- It is not stored.
- Each preview is audited as `P2_FORM_PREVIEW`.
- Response headers report the template set, DCC status, consent status and the number of missing fields.

**Rendering:**
- Template page: embedded unchanged with pdf-lib.
- Overlay: typeset by Chromium in the renderer service from structured items (no caller HTML).
- Font: Tahoma, a standard Windows font with looped Thai, with the bundled Noto Sans Thai as fallback.
- Fitting rule: long text shrinks; name, reason, facility, doctor and coordinator may use 2 lines. Any text that still cannot fit is reported as `overflow`, and the tests require none.

**Known limitation:** where a Thai tone mark stacks above an upper vowel, the PDF uses an alternate glyph without a Unicode mapping. The printed page is correct, but copying the text loses that tone mark.

## Settings (OD-06 consumer)

**What is live:** `request_consent.templateVersion` selects the active template set.
- **Validation:** "ทดสอบร่าง" loads and hash-checks the set. A set that is not installed, or whose hash is wrong, cannot be approved.
- **Lifecycle:** the CLINICAL maker-checker is unchanged. Rollback works through the existing revisions.

**What stays locked:** `request_consent.mode` is still OD-06 HOLD. Changing it is refused (`CONSENT_MODE_PENDING_OD06`).

## Tests

| Test | What it proves |
|---|---|
| `tests/db/anc-forms.test.ts` | 6 tests on the real reference PDFs: empty record stays blank; registry doctor on both forms; BE digits read back by position; HN zeros; long Thai text inside its space (measured from the PDF); 2 A4 pages; sources unchanged; doctor change; consent-doctor lock; preview creates no evidence; Settings set switch / broken set / not installed / mode refused; permissions |
| `tests/unit/anc-forms-fields.test.ts` | Twins, unanswered items, recorded events only, consent ticks only from a complete signing, paper decision, revoked, inactive or mismatched doctor |
| `tests/e2e/anc-forms.spec.ts` | Browser: ANC fills the form once and picks the doctor from the registry; three buttons; PDF content; doctor change; no consent evidence; Axe; auditor 403, Lab 200; Settings UI switches the active set; an uninstalled set cannot be approved |

## Still needed from DCC / QA / clinic

1. **DCC decision** on whether an electronically filled `/01` and `/02` may be used. Until then these are previews only. If approved, register the approved set with `dccStatus: DCC_APPROVED`.
2. **Wording of item 8** (family history vs. "ประวัติอื่น") and the source for **สิทธิการตรวจ**. Today entitlement is free text, so a box is ticked only when that text clearly says สปสช. or เรียกเก็บเงิน.
3. Whether **printed names** in the consent parentheses are allowed (mapping §3 says "only if DCC allows").
4. **Physical print check** on the hospital printer, including the Tahoma availability on the server.
5. **OD-06** (request/consent channel mode).
