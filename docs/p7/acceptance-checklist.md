# P7 staff/clinical/operations acceptance checklist

Status: PREPARED, NOT RUN, NOT SIGNED. Synthetic automation is separate evidence. Use an approved hospital synthetic dataset only; no clinical release/HIS writes without separate authorization. Owner-locked workflows and policies control over these scenarios.

## Test record
Build SHA: ___; dataset authorization/reference: ___; tester/role/unit: ___; browser/device/printer: ___; date: ___; actual result/evidence: ___; PASS/FAIL/NOT TESTED: ___; issue/retest: ___; witness/signature: ___. Record actual dates and counters; leave blank when not observed.

| ID | Staff task and expected result | Acceptance owner |
|---|---|---|
|UAT01|ANC registers synthetic LN with leading zeros, correct unit/identity and Request/Consent mode; existing LN returns the same case, no duplicate specimen or LN Halos before receipt|ANC + Lab|
|UAT02|Lab Direct registration uses the shared registry, permitted Request controls and original HIS LN; no duplicate ANC registration or second HIS receipt step|Lab|
|UAT03|Request five-category dialog autosaves/reopens latest facts, conditional validation links to correct field, category change preserves reachable title/close, transient error recovers without silent data loss|ANC|
|UAT04|Paper verification records only relevant paper portions; independent verification and discrepancy block unsafe progression|Lab certifier|
|UAT05|Patient signing handover freezes staff session, no default decisions, twelve acknowledgments and actual patient/representative signing under approved policy; preparer returns only after reauthentication|ANC / DPO|
|UAT06|Identity mismatch/withdrawn consent remain visibly HOLD throughout task list, Lab workflow and results; admin/ANC cross-unit access stays scoped; no PHI appears in URL/browser storage/logs|Clinical / DPO|
|UAT07|S1 HIS receipt issues one base LN Halos, label reprint issues no new number; S2 redraw keeps HIS LN and receives locally; repeat creates a new attempt on the same specimen|Lab|
|UAT08|Print one and multiple samples: four 50x20mm stickers/eight 25x20mm halves each, correct LN/Halos (redraw S2: BASE[D]R per OD-R1a), exact suffix ordering, no graphic barcode per Owner lock, no sample mix; operator confirms scale/cuts/stock|Lab + printer operator Q-I7|
|UAT09|Task List placement/controls/empty slots, actual execution, paper reconciliation and independent review remain clear; blocked gates explain required recovery action|Lab|
|UAT10|Pooling/QC2/DNB/QC3/Sequencing/QC4 use approved criteria only; missing QC5 or stale/stopped/recalled source never yields clinical FinalQcAccepted; synthetic evidence stays labelled HOLD|Lab QA / Clinical|
|UAT11|HALOS contract: 47 real data rows, no Barcode13/filler/Row49, Blank40 handling and LN fields match approved mapping; actual vendor import requires witnessed acceptance|Lab + HALOS owner|
|UAT12|Results folder Test Path/Scan/Preview/Confirm and upload operate with real worker; changed bytes/name conflict warn, explicit selection required; matching is round/attempt-aware and second-person approved|Lab|
|UAT13|Results date/state/risk filters and CSV show the same bounded page with visible scope; unknown is not low risk; leading zeros/Thai text retained; unauthorized export denied|Lab / DPO|
|UAT14|Controlled reparse records separate evidence/reason/actor/parser version, original bytes/report/link/review/release stay unchanged; repeated same key is idempotent and changed-key content collision is refused|Lab certifier|
|UAT15|Historical 47-row CSV+PDF/ZIP import surfaces each problem, corrections preserve provenance, every row attested by independent verifier, partial outcomes visible; failed eligibility goes NotEligible; no historical HIS path|Historical verifier|
|UAT16|PDF original/preview/reprint hashes and identity match, every page has synthetic/nonclinical status, Thai long text readable; F2-F6/approved forms reviewed against signed inventory before clinical use|DCC / Lab|
|UAT17|Worker restart/recovery resumes same immutable artifact identity; delivered/ambiguous OK requires reconciliation and never blind resend; pickup is not HIS confirmed|Operations / HIS|
|UAT18|Encrypted backup taken after quiescence, restore into new database and separate stores verifies lineage/audit/file/P6 hashes; key escrow, host/NAS/WAL and measured hospital RPO/RTO witnessed|Operations Q-I6|

## Accessibility and usability record

Test all operational screens at 375/768/1280 plus 320 CSS px/400% zoom, text spacing, keyboard only, visible/non-obscured focus, semantic labels/errors/status, no keyboard trap, native PDF viewer, actual Thai NVDA and actual signing/printing devices. For each applicable WCAG2.2 A/AA criterion record applicability, PASS/FAIL/NOT TESTED and evidence as in docs/accessibility.md. Axe silence is not manual conformance.

Recruit actual ANC 2–3 staff and Lab 2 staff per locked UQ-11. Record task time/clicks, completion/errors and SUS responses; required success >=90%, critical wrong-patient/wrong-mode/wrong-round errors=0, SUS>=70. No result is entered until observed. Failed task requires defect/retest; no inferred acceptance from automated E2E.

## Clinical/operational gates before P8

- Approved Clinical/QC rules, QC5 and exact accepted-evidence adapter, final acceptance locking, signed validation/method criteria (including real Pooling method validation); AL-4/4b/5 remain closed meanwhile.
- OD-04 Clinical Governance sign-off, OD-05 confirmation, OD-07 PIC/report/notice templates and channels, OD-08/09/10/16/17, signed form inventory/report layouts.
- AL-3/6 actual HIS/HALOS/CFS/LAN with signed transfer/pickup/confirmation/retry/second-result same-LN evidence; no live endpoints exercised by this checklist.
- OD-18 Anchor + go_live_cutoff, OD-19/20/21/23/26/27 and Q-G7; retain answered Q-P5H options and no historical HIS send.
- Q-I6 hospital load, approved p95 thresholds/RPO/RTO/WAL/NAS/key escrow/monitoring; Q-I7 physical printer; Q-I11 cutover/paper fallback and one issuer/publisher.
- Staff UAT, manual ACR, approved training, signed AL-7 validation and pilot/cutover authorization.

No P8 Pilot readiness is asserted by preparation of this checklist.
