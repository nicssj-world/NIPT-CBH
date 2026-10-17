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
| OD-A | Urgent vs FIFO override reason | OPEN — see Q1 | The urgent flag, set with its own reason and audit, waives the separate override reason (Receive Sorting Lock 2026-10-12 #5; `tests/db/p4-sort.test.ts`). Any other overtaking needs a reason, shown before submit. |
| OD-B | Draft PDF preview before Finalize | OPEN — see Q2 | Per-Task PDF exists for finalized Tasks only, marked uncontrolled |
| OD-G | Choose the destination Task | OPEN — see Q3 | Assignment fills the lowest free slot in the order shown on screen |
| OD-E / OD-E2 | Planned vs actual Library date; Completed-document annotation | OPEN — see Q4 | Existing amendment path before execution; no deviation annex |
| OD-S / OD-T | Field mapping (`planned_work_date` = Library Prep; F2-02 = actual Library Prep; new F2-03 = Extraction); when a control ID is "in use" | OPEN — see Q5 | Unchanged generic "work date" fields |
| OD-L | Extra non-blocking date warnings | OPEN — see Q6 | Only hard guards: non-existent date, ISO year ≥ 2400 |
| P5-A | Automatic PDF linkage for a unique exact match | OPEN — see Q7 | Every link = propose + second person (D-18) |
| P5-B | Review / QC5 / certification steps | OPEN — see Q8 | Three steps (review, QC5, certify) as approved in Plan v6.2.1 and OD-04 |

## One decision packet (questions for the Owner)

Each question changes a business rule or a controlled document. Nothing here has been implemented by guessing.

1. **OD-A.** Is a sample marked urgent (with its reason) allowed to go ahead of the queue without a second "overtake" reason (current behaviour)? Or must every overtake, urgent or not, carry its own short reason (your proposal "Urgent ไม่แซง FIFO อัตโนมัติ")?
2. **OD-B.** May staff open an uncontrolled preview PDF, watermarked "DRAFT – ไม่ใช่เอกสารควบคุม", **before** Finalize? It would have no DocID, would not be issued, and would be audited as a preview.
3. **OD-G.** May staff choose which Task (1, 2 or 3) a sample goes into? Slot, control and eligibility rules stay the same.
4. **OD-E / OD-E2.** If the actual Library Preparation date differs from the planned date after work has started, which applies?
   - (a) Keep the control IDs, and record the actual date with a reason and second-person review.
   - (b) Stop and repeat.

   When (a) applies, how should the Completed document show it?
5. **OD-S / OD-T.**
   - Confirm the field meanings: planned work date = planned Library Preparation date (drives control IDs); F2-02 = actual Library Preparation date; add F2-03 = actual Extraction date (information only).
   - Confirm that control IDs become fixed at execution start.
6. **OD-L.** Which non-blocking date warnings do you want? Proposed:
   - collection date after receipt, or in the future;
   - planned date before the batch was created;
   - history date after collection.
7. **P5-A.** Legacy linked a PDF automatically when exactly one order matched the HN within the date cutoff. Should NIPT-CBH link automatically when a single candidate matches on every check (HN, DOB, pregnancy type, collection date, GA, lab number), and keep two-person review only for exceptions?
8. **P5-B.** For a linked, fully matching report, may "review" and "QC5" be completed together with "รับรองและส่งผล" in one confirmation by one authorised person (OD-04 already allows the same person)? The identity, version, consent and QC gates stay unchanged.

## External and physical tests (not Owner questions)

- **Hospital IT / HIS (AL-6):**
  - real share paths and ACLs;
  - HIS acceptance of RES fields;
  - certifier HIS IDs;
  - the round-2 specimen date in RES P[23] (Q-I5);
  - HIS acknowledgment mechanism.
- **Physical (Q-I7 / OD-R1b):** print S1 and S2 labels, including twins `…DR-3`, on the real 50×20 mm printer before clinical go-live.
