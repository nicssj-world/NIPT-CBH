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
| P5-A | Auto-match a unique, clean PDF | **APPROVED — partly implemented; migration needed for the rest** | Unique, conflict-free candidate (HN, DOB, pregnancy, collection date, GA, lab number; current round, latest live attempt; no name conflict or open revision) is shown as "ระบบจับคู่ได้ชัดเจน 1 รายการ" and proposed in one click. Never sends to HIS. A fully automatic link without a second person is blocked by migration-050 constraints (`link_mode<>'AUTO_PIC'`, `result_link_event.mode='MANUAL_REVIEWED'`, two-person trigger) and needs a new migration — not created (separate approval). |
| P5-B | One confirmation for review/QC5/certification | **APPROVED — implemented (operational mode)** | "ตรวจรับ PDF และยืนยันส่งผล": one authorised person confirms external-final, identity/values, disclosure (+ abnormal ack); one transaction records review, QC5 and certification through the existing services; all RG gates, identity, version and consent checks unchanged; any failure rolls back. Synthetic mode keeps the separate steps. |

## Owner approvals recorded 2026-10-18

All eight questions of the earlier packet were approved by the Owner on 2026-10-18 (see the rows above). G07 "เติมตัวอย่างจากคิว" is implemented: preview, then fill of the selected Task's empty patient slots (max 15) from the eligible FIFO queue through the normal Assignment Gate; controls 1/25/40 untouched; refused when the proposal changed or the Task is finalized; never triggered by PET receipt.

## Still needing a decision or acceptance

1. **Migration approval for P5-A full auto-link** — relax the two migration-050 CHECKs and the link trigger for a system match mode. Without it, the second person still approves each link.
2. **QA format acceptance for the OD-E2 annex** — how a native Completed shows planned vs actual Library date. Until then such sheets get no native Completed; analysis continues.
3. **Lab/QA sign-off of the F2 field inventory** (still SEED_UNVERIFIED), including the new F2-03.
4. **OD-R2 S3+ redraw rule** — operational orders beyond S2 stay refused.

## External and physical tests (not Owner questions)

- **Hospital IT / HIS (AL-6):**
  - real share paths and ACLs;
  - HIS acceptance of RES fields;
  - certifier HIS IDs;
  - the round-2 specimen date in RES P[23] (Q-I5);
  - HIS acknowledgment mechanism.
- **Physical (Q-I7 / OD-R1b):** print S1 and S2 labels, including twins `…DR-3`, on the real 50×20 mm printer before clinical go-live.
