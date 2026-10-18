# HIS reception and result delivery — Owner Lock

**Status:** Owner Lock, recorded 2026-10-18 under the Master Owner Directive. It applies to every future change, by any person or AI session.

**NIPT-CBH PET Reception and Result Delivery Workflow MUST reference `NIPTY.zip` and `NIPTY_handover.zip`.**

Do not change the workflow below without written Owner approval. Do not design a new PET, RES or OK protocol from assumptions.

## 1. Reference sources

| Source | Where | Identity |
|---|---|---|
| `NIPTY.zip` | Owner's immutable audit folder `NIPT-Audit` (outside every repository) | 275,673,797 bytes, SHA-256 `ec54193058f43540180fe1b006d286a6a8bfa17b9d99580329fa9b164fae99e8` |
| `NIPTY_handover.zip` (v1.4.3) | same folder | 5,483,650 bytes, SHA-256 `332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c` |
| Hash register | [source-register.md](source-register.md) | — |
| Legacy → NIPT-CBH module mapping | [legacy-mapping.md](legacy-mapping.md) | — |
| RES / PDF / OK wire contract (read from the ZIP source) | [p6/contract-review.md](p6/contract-review.md) | — |
| HIS outbound Owner decision (one NIPT-owned system, editable paths, no ACK claimed from a file copy) | `NIPT_CBH_P0_HIS_Outbound_File_Transfer_and_Settings_2026-10-11.md` in the same audit folder | — |
| Result review/certification Owner decision OD-04 | `NIPT_CBH_P0_OD04_Result_Certification_Owner_Decision_2026-10-11.md` in the same audit folder | — |
| Receive-date sorting Owner Lock | `NIPT_CBH_P4_Receive_Date_Sorting_Owner_Lock_2026-10-12.md` in the same audit folder | — |

**How to read the ZIPs:**
- Read them in place and read-only. List the central directory first.
- Never extract them into a repository. Never run the legacy application.
- Never commit patient-like samples, credentials or hospital paths from them.
- Inside the handover ZIP, the relevant legacy sources are:
  - `source/app/services/pet_parser.py`, `pet_scanner.py`, `pet_autoimport.py`
  - `pdf_parser.py`, `matcher.py`
  - `res_generator.py`, `result_text.py`, `pdf_exporter.py`
  - `source/app/routes/export_routes.py`
  - `handover/HANDOVER.html` §3 (flows)

## 2. Rules

### 2.1 PET reception
1. A physician ordering NIPT in HIS does **not** create a reception. A PET exists only after staff press receive in HIS. HIS then writes `{LN}-7.pet` plus the `.ok` sentinel into its day folder.
2. NIPT-CBH reads the share **read-only**: it never moves, writes or deletes there. A `.pet` is read only when its `.ok` exists. Content is deduplicated by SHA-256.
3. The PET is the source of truth for reception. The receive time is the immutable P[21]; the HIS collection date is P[23] (kept beside, never over, the ANC-entered date).
4. The specimen is **not received a second time** in NIPT-CBH, and PET data is not typed in again. The lab's tube-condition check, rejection and label printing are laboratory steps, not a second reception.
5. LN, HN and patient identity are matched before anything is applied. A mismatch opens an issue for a second person, and the sample never links to another patient.
6. Re-reading the same file is a duplicate, not a new receipt. A changed file for an already received LN is an integrity event, not an overwrite.
   - **Deliberate difference:** legacy overwrote unlocked orders. NIPT-CBH opens an integrity event instead.

### 2.2 Redraw / resampling
1. A redraw (S2) arrives as a **new PET from HIS**, with the **same HIS LN** and a new receive time. It becomes a new specimen round linked to S1.
2. The LN Halos base stays the S1 base, with no new monthly number. S2 appends `R`; twins append `D` before `R` (`BASE`, `BASER`, `BASED`, `BASEDR`). Tube labels show the code of their own round.
3. Re-Library and analytical attempt numbering are separate from the tube-label suffix.
4. S3+ has no approved rule (OD-R2). Until it is decided, operational mode refuses an S3+ redraw order, so that no round is left that can never be received.

### 2.3 External result PDF
1. **NIPT-CBH is not the NIPT analysis program.** The external program analyses the sample and produces the final report PDF.
2. NIPT-CBH imports the PDF, matches it to LN, patient, round and attempt, shows it, and handles exceptions (unmatched, conflicting, duplicate, superseded).
3. Owner P5-B (2026-10-18): one authorised person gives one confirmation, "ตรวจรับ PDF และยืนยันส่งผล", which records the review, QC5 and certification together. It is confirmation of the right report for the right patient, **not a second clinical analysis**. The release predicate (RG-01…13) is unchanged.
   - Owner P5-A: a unique, conflict-free match is proposed automatically; it never sends to HIS by itself.
4. Identity checks, the choice of the correct (latest, non-superseded) report version, and release permissions must never be removed.

### 2.4 HIS result delivery
1. Delivery is: released report → RES (UTF-16LE with BOM, H/P/O/R/L records, CR separators) + the original PDF + an `.ok` that is only `ff fe`. All of it follows [p6/contract-review.md](p6/contract-review.md).
2. NIPT-CBH verifies the PDF, then the RES, then the backup, and only then writes the `.ok`. A collision is rejected; nothing is overwritten. A retry reuses the frozen transfer.
3. A file copy is **never** reported as "HIS accepted". Without an authoritative HIS acknowledgment, the status stays "delivered — HIS processing not verified" (`AWAITING_CONFIRMATION` / `PICKED_UP_UNCONFIRMED`).

## 3. Verification against the current code (2026-10-18, branch `feat/task-list-parity-p0`)

| Step | ZIP / Owner requirement | Current code | Status | Fix |
|---|---|---|---|---|
| PET discovery | Read-only; `-7.pet` + `.ok`; test code 70096 | `packages/inbound/discovery.ts` `discoverInbound`, `packages/integrations/pet.ts` `parsePet` (CP874, field counts, O[18]=7, 70096) | CORRECT | — |
| Identity match / registry | Match LN, HN and patient; never mis-link | `packages/inbound/process.ts` `processInboundFile` → `compareRegistrant`, `applyS1`; conflicts → `his_intake_issue` | CORRECT | — |
| Receive timestamp | HIS receipt time | `applyS1` sets `received_at`=P[21], `received_source='HIS_PET_RECEIPT'` | CORRECT | — |
| Duplicate / changed PET | No double receipt | sha256 unique; `DuplicateSameContent`; `S1_INTEGRITY_EVENT` / `LN_REUSED_*` | CORRECT (stricter than legacy, by design) | — |
| Second S1 reception in NIPT | Not allowed | `receiveRedraw` refuses S1 (`S1_RECEIVED_IN_HIS_ONLY`); the worklist states S1 is received in HIS only | CORRECT | — |
| Specimen-condition step (BG-02) | Allowed lab check, not a reception | `acceptSpecimen`; UI labelled "ตรวจรับสิ่งส่งตรวจ", and "พบปัญหา" was stored as REJECTED | INCORRECT (wording) | Fixed: "ตรวจสภาพสิ่งส่งตรวจ (หลังรับใน HIS)", accept/reject labels |
| Redraw receipt | New PET, same LN, round 2 | `processInboundFile` → `APPLIED_REDRAW` (requested, Expected, later P[21]) | CORRECT | — |
| Redraw UI | No manual receive | "รับตัวอย่างเจาะซ้ำ" shown in operational mode (server always refused); help said no `.pet` needed | INCORRECT | Fixed: operational rows show "รอ PET ใหม่จาก HIS" |
| S2 LN Halos / labels | Same base + R, D before R | `085` issuer, `specimenDisplayCode`, migration 099 | CORRECT | — |
| S3+ | No silent stuck round | Ordered freely, never receivable | INCOMPLETE | Interim operational block (`REDRAW_BEYOND_S2_PENDING_OD_R2`); rule is OD-R2 |
| PDF import / parse | Hash dedup, preview, confirm | `packages/results/intake.ts`, `service.ts` `confirmImport` (`Duplicate`) | CORRECT | — |
| PDF matching | Legacy: unique HN match within date cutoff links automatically | `autoMatchCandidate` + `proposeAutoMatch`: unique clean match proposed in one click; second person approves (DB rule) | INCOMPLETE (P5-A approved) | Full auto-link needs a migration (separate approval) |
| Review → QC5 → certify | Confirm the correct report; OD-04 lets one authorised person review and certify | `acceptAndRelease`: one "ตรวจรับ PDF และยืนยันส่งผล" (P5-B approved 2026-10-18) running the same services and RG gates | CORRECT (fixed) | — |
| Superseded / wrong-patient report | Never delivered | RG-04 cross-check, RG-05 current attempt, RG-12 latest version, revision supersedes | CORRECT | — |
| Release → outbound | Automatic, released only | `job_outbox` `result_release_completed` → `reserveReleasedResult` (eligibility re-checked) | CORRECT | — |
| RES / PDF / OK | ZIP contract | `packages/p6/res.ts`, `transfer.ts`, `worker.ts`; legacy goldens in `tests/fixtures/p6` | CORRECT (wire); order PDF→RES→backup→OK is a Plan §10 safety change | — |
| HIS confirmation | No claim from a file copy | `AWAITING_CONFIRMATION`, `PICKED_UP_UNCONFIRMED`, `hisConfirmed:false` | CORRECT | — |
| Paths / settings | Editable, NIPT-owned | `his_outbound` settings (maker-checker), connection test | CORRECT | Real share and ACL test is IT (AL-6) |
| Round-2 specimen date in RES P[23] | Not defined by legacy (legacy had no S2) | `round2SpecimenDatePolicy` must be set or reservation stops | UNVERIFIED | IT/HIS decision Q-I5 |

**Not provable from the ZIPs:**
- whether the real HIS accepts each RES field;
- receiver ACK;
- certifier HIS IDs;
- round-2 P[23];
- the real share's ACLs.

These stay with Hospital IT / HIS acceptance (AL-6). A HIS simulator pass is not HIS acceptance.
