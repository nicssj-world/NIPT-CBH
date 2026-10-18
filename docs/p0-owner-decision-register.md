# P0 Owner Decision Register (Task List parity, Plan Rev 3.4)

**Updated:** 2026-10-18
**Branch:** `feat/task-list-parity-p0`
**Full plan (outside the repository):** `NIPT-CBH-AUDIT/NIPT-CBH_Workflow_UX_BE-Date_Plan_Rev3.4_2026-10-17.md`
**Implementation evidence:** `NIPT-CBH-AUDIT/NIPT-CBH_P0_Implementation_Evidence_2026-10-18.md`
**Workflow Owner Lock:** [his-workflow-owner-lock.md](his-workflow-owner-lock.md)

**Status words:**
- **CONFIRMED** — written Owner decision exists.
- **OWNER DIRECTION** — the Owner stated the rule. Remaining detail is implemented conservatively and listed for confirmation.
- **PROPOSAL IMPLEMENTED** — display only and reversible; awaiting confirmation.
- **OPEN** — not implemented, because it would change a business rule or a controlled document.

| OD | Topic | Status | What the code does now |
|---|---|---|---|
| OD-R1 / OD-R1a | S2 = S1 base + `R`; twins `D` before `R`; same 8-half label pattern | CONFIRMED | Implemented (`specimenDisplayCode`, labels, print audit) |
| Migration 099 | `printed_code` CHECK allows `D?R?` | CONFIRMED (synthetic DB only) | Implemented; applied only to isolated synthetic databases |
| OD-R1b | S2-only shrink-to-fit; S1 unchanged | CONFIRMED (conditional) | Implemented; **physical print test still required before go-live** |
| Control ID date | Actual Library Preparation date per Task, CE in identifiers | CONFIRMED (Owner Final Lock) | Existing behaviour kept; mapping of fields is OD-S |
| BE dates | Thai BE in UI and documents; ISO/CE in storage, API, HIS and identifiers | CONFIRMED | Implemented (P0-0, P0-4, P0-7) |
| OD-F | GA ≥ 22+0 | OWNER DIRECTION (warning only) | Badge on the worklist and Task slots. EDD comes from the latest verified Request; collection date from HIS receipt, otherwise the Request. No effect on gate, FIFO, urgent or override. Not shown to ANC. |
| OD-K | Labels before placement | PROPOSAL IMPLEMENTED | Placement is not blocked; the slot shows "ยังไม่พิมพ์ฉลาก" |
| OD-R2 | S3+ redraw | OPEN (interim block per Rev 3.4 §11A fix 8) | Operational mode refuses an S3+ order with a clear message; nothing existing changes |
| OD-A | Urgent vs FIFO override reason | **APPROVED 2026-10-18 — implemented** | FIFO is receive-time order only; urgent never jumps the queue or the auto-fill. When every out-of-order sample is urgent, its recorded urgent reason is reused for the override (event `reasonSource=URGENT_REASON`). Any other overtake still needs a reason. |
| OD-B | Draft PDF preview before Finalize | **APPROVED — implemented** | "ดูตัวอย่าง PDF ฉบับร่าง (DRAFT)" on Draft/PlanChecked/Amended Tasks: DRAFT watermark and footer, no DocID series, never stored as `lab_document`, audited `LAB_DRAFT_PREVIEW`; refused after Finalize |
| OD-G | Choose the destination Task | **APPROVED — implemented** | Optional Task choice in the assign dialog (default: first empty slot); locked Tasks are refused; Gate, control-slot and FIFO-reason rules unchanged |
| OD-E / OD-E2 | Actual Library date differs after start | **APPROVED — implemented**; native annex **pending QA format acceptance** | Control IDs kept. F2-02 with a different date requires a short reason (`LIBRARY_DATE_DEVIATION_REASON_REQUIRED`). Chromium F2 Completed prints the basis line (planned date in IDs, actual date, reason). Native master Completed for a deviating sheet is held (`LIBRARY_DATE_DEVIATION_ANNEX_PENDING_QA`) because B4 alone would be ambiguous; pooling/sequencing are not blocked. |
| OD-S / OD-T | Field mapping and identifier lock | **APPROVED — implemented** | `planned_work_date` labelled planned Library Preparation date (drives control IDs). F2-02 = actual Library Preparation date (B4). New F2-03 = actual DNA Extraction date: optional, informational, bound to no master cell. IDs locked at execution start (existing state machine). Approved master unchanged. Field inventory remains SEED_UNVERIFIED until Lab/QA sign-off. |
| OD-L | Extra non-blocking date warnings | **APPROVED: none added** | Existing validation only (non-existent date, ISO year ≥ 2400, existing LOT warning) |
| P5-A | Auto-match a unique, clean PDF | **APPROVED incl. migration — implemented 2026-10-18** | Migration 100 (forward only, synthetic databases only): `AUTO_LINKED` / `AUTO_UNIQUE` with match evidence and DB guards. `autoLinkUnique` links only a single clean match (HN, DOB, pregnancy, collection date, GA, lab number; all cases searched; current round, latest attempt; empty series; no name conflict; no earlier human decision), at import and from the one-click button. Active while `result_management.linkageMode = UNIQUE_AUTO_LINK` (Settings maker-checker; default stays two-person). Never reviews, certifies, releases or sends. Evidence: [settings-operational-acceptance.md](settings-operational-acceptance.md) §5. |
| P5-B | One confirmation for review/QC5/certification | **APPROVED — implemented (operational mode)** | "ตรวจรับ PDF และยืนยันส่งผล": one authorised person confirms external-final, identity/values, disclosure (+ abnormal ack); one transaction records review, QC5 and certification through the existing services; all RG gates, identity, version and consent checks unchanged; any failure rolls back. Synthetic mode keeps the separate steps. |

## Owner approvals recorded 2026-10-18

All eight questions of the earlier packet were approved by the Owner on 2026-10-18 (see the rows above). G07 "เติมตัวอย่างจากคิว" is implemented: preview, then fill of the selected Task's empty patient slots (max 15) from the eligible FIFO queue through the normal Assignment Gate; controls 1/25/40 untouched; refused when the proposal changed or the Task is finalized; never triggered by PET receipt.

## Still needing a decision or acceptance

1. **P5-A activation** — the code and migration are in place; switching `result_management.linkageMode` to `UNIQUE_AUTO_LINK` is one Settings maker-checker step by the authorised people (it is not switched on by default).
2. **QA format acceptance for the OD-E2 annex** — how a native Completed shows planned vs actual Library date. Until then such sheets get no native Completed; analysis continues.
3. **Lab/QA sign-off of the F2 field inventory** (still SEED_UNVERIFIED), including the new F2-03.
4. **OD-R2 S3+ redraw rule** — operational orders beyond S2 stay refused.

## ANC Request + Consent auto-fill preview (Owner 2026-10-18)

The Request (Fm-WI-T-BM17/01) and Consent (/02) previews are filled from recorded data over the unchanged DCC PDFs. They are DRAFT only. See [anc-forms-autofill.md](anc-forms-autofill.md).

- **Ordering doctor:** comes from the Doctor Registry selection on the request; consent preparation is locked to that doctor.
- **OD-06 consumer:** `request_consent.templateVersion` selects the template set.
- **Open items:**
  - DCC approval of electronic fill;
  - item 8 wording and the entitlement source;
  - printed names in the consent;
  - a physical print test;
  - OD-06 channel mode.

## Two Final Result PDF channels (Owner 2026-10-18)

- **Fallback (implemented):** "อัปโหลด PDF ผลตรวจ" on the case page. It checks against the selected round/attempt, refuses identity conflicts, shares the same intake/import/linkage/P5-B path, prevents duplicates across channels, and works while the Worker is down. See [p5-two-pdf-channels.md](p5-two-pdf-channels.md).
- **Primary folder intake:** Settings, Worker scan and P5-A auto-link at import are implemented.
- **Owner final clarification (2026-10-18): the folder scan is on demand only.** Staff press "สแกนไฟล์ PDF", one scan runs, then it stops. Staff preview and press "ยืนยันนำเข้า". The Worker result-folder timer was removed, and `scheduledScanMinutes` is locked at 0. No unattended import is needed.

## Settings operational acceptance (2026-10-18)

Every Settings category was traced to its consumer and proven with the `NIPTY_handover.zip` sample files ([settings-operational-acceptance.md](settings-operational-acceptance.md)). Proven gaps fixed: PET with an empty citizen ID, generic Settings error text, no Worker-in-use evidence. Not fixable without an Owner/DCC decision: global request/consent settings (no consumer, OD-06/DCC); backup is installation-owned.

## Consent workflow: three Owner decisions (2026-10-18), all implemented

Details and tests are in [p2-paper-consent.md](p2-paper-consent.md).

1. **Paper Consent refusal.**
   - ANC has a **ผู้ป่วยไม่ยินยอม (Paper)** button. It records the refusal in one step, with no print, upload, scan, Signature Pad, wait, paper verification or second approval.
   - A refusal is separate from the marker "ใช้ Paper Consent" and blocks Clinical review, Lab gates, result release and HIS release.
   - Choosing Paper again, or switching channel, never erases it. Withdrawal still blocks as before.
2. **DCC Consent PDF and signatures.**
   - The system's signed Digital Consent PDF already shows the registry doctor's stored signature and the patient's Signature Pad signature, with the recorded decision and time. It is kept as is.
   - An unsigned preview stays DRAFT, with no invented signature or date.
   - A Paper marker or refusal creates no digital signature and infers no decision or date.
   - The original DCC forms are never edited, and an auto-filled DCC form is not treated as approved.
3. **Paper marker-only** stays as in `719d56b`: ANC selects Paper Consent, the marker is recorded, and the next step opens at once.

Migration 102 (forward only, synthetic only) adds the refusal rule. Migrations 099–101 are untouched.

## External and physical tests (not Owner questions)

- **Hospital IT / HIS (AL-6):**
  - real share paths and ACLs;
  - HIS acceptance of RES fields, including P[7] DOB form (ZIP sample `1983-02-02`, NIPT-CBH `19830202`);
  - certifier HIS IDs;
  - the round-2 specimen date in RES P[23] (Q-I5);
  - HIS acknowledgment mechanism.
- **Physical (Q-I7 / OD-R1b):** print S1 and S2 labels, including twins `…DR-3`, on the real 50×20 mm printer before clinical go-live.
