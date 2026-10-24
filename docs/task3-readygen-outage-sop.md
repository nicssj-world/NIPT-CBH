# SOP — ReadyGen fallback during a NIPT-CBH outage (Task 3, pathway B)

Status: **technical draft for Owner/hospital approval**. This SOP describes what the software supports. It is not hospital-approved yet: formal adoption, roles and media rules are a later human gate.

## 1. Before any outage: keep the inputs outside NIPT-CBH

- Take the package as part of the normal sequencing step, right after "ส่งออก NIFTY + HALOS".
  - On the bench page (`/lab/batches/<id>/bench`), press **3. ชุดสำรองสำหรับ ReadyGen**.
  - The ZIP contains:
    - `NIFTY-vendor.xlsx` — the exact vendor export;
    - `NIFTY-readygen-input.xlsx` — a copy in which only columns J (HN) and O (HIS LN) are swapped, to match ReadyGen's alias table;
    - `HALOS-Task-Import.xlsx`;
    - `manifest.json` with SHA-256 for every file;
    - `Verify-Package.ps1`;
    - a Thai/English README.
- **Custody.** The package contains PHI.
  - Store it only on hospital-encrypted, access-controlled media designated by the laboratory, such as a BitLocker-protected drive in the laboratory.
  - Never send it by e-mail or chat, and never put it in a personal cloud folder.
  - Every download is audited (`READYGEN_FALLBACK_PACKAGE_DOWNLOADED`, plus case PHI-access entries).
- **Owner decision required.** NIPT-CBH's vendor NIFTY file follows Owner lock LAB-13 F04 (J = HIS LN, O = HN). ReadyGen's own configuration (`enrich_alias.txt`) prints column J as "HN" and names files by column O. The Owner's ReadyGen-processed Run 2 file and the 45 real reference PDFs follow the ReadyGen arrangement. The ReadyGen copy therefore swaps the two columns. Owner confirmation is required before this copy is used operationally.

## 2. During the outage

1. Check the package offline: open PowerShell in the folder and run `.\Verify-Package.ps1`. Continue only on `PACKAGE VERIFIED`.
2. On the authorised, licensed ReadyGen workstation, load `NIFTY-readygen-input.xlsx` and the HALOS "Sample analysis data" workbook for that chip.
3. Generate the reports with the approved Word masters installed in ReadyGen. Review and sign them under the laboratory's existing ReadyGen procedure.
4. Keep a paper or electronic outage log: an outage reference such as the IT incident number, start time, which LN were reported, who signed, and whether each result was entered in HIS manually.
5. If HIS is also unavailable, follow the hospital's existing HIS downtime procedure for result delivery. NIPT-CBH does not send anything while it is down.

## 3. When NIPT-CBH is back: return and reconciliation

1. Import every ReadyGen PDF unchanged:
   - per patient, through the case page panel "อัปโหลด PDF ผลตรวจ";
   - or as a batch, through the Results page "นำเข้า PDF ผลจาก ReadyGen / ภายนอก".
2. The system preserves the original bytes and SHA-256 and checks identity, round and attempt (HN, DOB, pregnancy, collection date, GA, lab number). A duplicate file is reported as a duplicate, never imported twice.
3. On the result page, under "ที่มาของรายงาน", record the outage reference. This step is optional, and it is never required in order to import.
4. If the result is already in HIS (entered manually during the outage), tick **"มีผลใน HIS แล้ว"** before or after confirming the result.
   - This records who stated it and when, and stops NIPT-CBH from sending the result again.
   - It is the user's statement, not an automatic HIS check.
   - If a transfer has already started, the checkbox is refused; reconcile through HIS ขาออก instead.
5. Then use the normal **ตรวจรับ PDF และยืนยันส่งผล** step. All Gate, QC5 and certification rules apply, as for any external PDF.
6. If the HALOS file for the same chip is later imported, a report already released for a round is never generated a second time: the native pathway holds with "รอบนี้ส่งผลแล้ว".
7. If HIS state is uncertain (no attestation, delivery state UNKNOWN), use the existing HIS reconciliation. Never re-send by assumption.

## 4. Limitations (stated, not hidden)

- An actual offline ReadyGen run was **not executed** in Task 3 technical testing:
  - no trusted, licensed ReadyGen installation exists on the development PC;
  - the bundled `ReadyGen.exe` is unsigned and was not run, as instructed.
- The roundtrip was verified with a synthetic external PDF through the same import, link, release and ANC path.
- The package carries the NIPT-CBH-side inputs only. ReadyGen itself, its licence, its configuration and the HALOS workbook from the sequencer remain hospital-controlled dependencies.
