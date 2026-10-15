# Operational Completion — local delivery, 15 October 2026

Worktree: `D:\Claude workspace\NIPT-CBH-OPERATIONAL`, branch `feat/operational-completion`.
The original worktree and existing P8/HIS work were preserved. No push, remote merge, hospital deployment, or Final Windows Package was performed.

## Completed software

- Continued the integrated P8/HIS baseline and committed resampling/runtime work. No reset, clean, or discard was used.
- Explicit operational runtime, designated database marker, HTTPS, operational identity formats and source-bound P2 clinical review.
- PET-backed expected resampling, immutable S1 receipt history, shared original LN Halos lineage and locked printed suffixes.
- Operational specimen acceptance and current clinical evidence feed the existing Ready gate. QC1 records retain explicit reviewed criteria.
- Accepted Pool snapshots, native HALOS XLSX/readback, observed-import verification, DNB/QC3, sequencing/QC4, report review/QC5 and authorized certification/release use existing services.
- The existing P6 worker consumes committed release events. It freezes the actual report/PET/certifier/settings evidence, uses the existing transfer journal/retry/recovery path and verifies PDF → RES → backup → BOM-only OK. File publication does not set HIS confirmation.
- Operational result-folder intake reuses the existing read-only scanner. It requires a separate `RESULTS` grant in deployment-owned share policy, bound to the OS service account. INBOUND grants do not authorize result folders.
- Native owner workbook derivatives, six-sheet editor, draft/resume, source hash invalidation, immutable export history, XLSX download and native Excel PDF preview. Current placement, library QC, pool QC2, DNB QC3 and sequencing measurements bind from persisted evidence.

## Owner-approved F52 update

The former F52 blocker is RESOLVED by the 2026-10-15 owner-approved master `Final_New_Task_List_Edit_2_F52_Corrected.xlsx`, SHA-256 `2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf`. The former hash remains historical provenance only. That revision used migration 091; the subsequent owner three-sheet composition below uses migration 094. Historical revisions and exports are retained. See `docs/f52-approved-delivery.md` for focused validation.

## Previous workbook evidence and PDF cause

Master: `Final New_Task_List_Edit (2).xlsx`.
SHA-256: `2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722`.
The file remains external to Git. Runtime requires `NIPT_TASK_MASTER_PATH`.

The original Adobe PDF printer configuration was Letter. The workbook's stored DEVMODE contained A4 paper code with stale Letter width/height. Native Excel exported Task Lists 1–3 as three Letter pages. The export pipeline temporarily reconciles the current printer driver to A4 before opening a read-only workbook, exports without saving, and restores the exact PrintTicketXML in nested cleanup protected by a per-session mutex. It never changes workbook PageSetup, margins, scaling, fonts, formulas, anchors or page breaks.

Verified native output for Task Lists 1–3 is **two portrait A4 pages each**, approximately 595.2 × 842.04 points, including populated derivatives. The six-sheet binding matrix contains 314 declared editable bindings and 149 preserved formulas. Archive comparisons preserve all untouched layout/style/media parts. Native recalculation observes 48 QC formulas and 101 Pooling formulas. The source hash was checked again after export; the printer restoration was checked against its pre-export ticket.

Native text uses TH Sarabun New and Calibri. PDF font evidence includes their embedded variants, symbol fallback, and fonts in existing diagrams. No font substitution or workbook font edit was introduced. Page-1/page-2 comparisons against the two actual owner screenshots were generated and visually inspected for table boundaries, logo, diagrams, checklist positions and page division. Raster comparison alone is not a certificate of 100% fidelity.

Local evidence (preserved outside Git):

- `.local/workbook-verification/final/evidence.json` and `field-binding-matrix.json`
- `.local/workbook-verification/final-master/native-manifest.json`
- `.local/workbook-verification/final-filled/native-manifest.json`
- `.local/workbook-verification/font-evidence.json`
- `.local/workbook-verification/golden-comparison-page-1.png` and `golden-comparison-page-2.png`
- Native master/filled PDFs alongside those manifests.

## Current owner master and completed integration

Owner supplied `Scale Final New_Task_List_Edit (2).xlsx`, SHA-256 `f4f4126f42a36adeb58c8ed908a39a7b6f19e8cc57e05a1ceb03fa4b12e157ef`, for QC measurements, Pooling Table and Seq Task-G50 only. Task Lists 1–3 remain locked to the F52-approved six-sheet source. The supplied three-sheet workbook contains 96 broken deleted-sheet references. The deterministic OPC composer imports its formatting, dimensions, images and printer settings, restoring only those references from the locked formula inventory. Every original formula, including F52/D55, is identical to the approved source; all 149 formulas remain. Task List worksheet XML, existing drawings, media and printer settings remain byte-identical; original style definitions remain intact. Imported styles and shared strings are remapped without changing their meaning.

Runtime master: `C:\Users\User\Downloads\NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx`.
SHA-256: `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`.
Set `NIPT_TASK_MASTER_PATH` to that combined file, rather than the three-sheet source. Reproduce it with `tools/operational/compose-owner-master.ts` and the two immutable source files. Migration 094 retains historical master revisions and requires the combined master for new revisions. No shared or Production migration was applied.

- Native Master XLSX/PDF artifacts now connect to existing F2/F3/F4/F5 issue, preview, completed, supersede, amendment, stop-use, recall and copy ledgers. Original reprints preserve original bytes; working/status copies carry visible copy provenance and status. Database guards bind artifacts, scope and immutable revision. Accepted Pool measurement immutability remains enforced; completed document issuance is permitted after acceptance.
- PRE_WORK refuses actual execution values instead of clearing drafts. Pool and DNB preview hashes include manual workbook values, so edits require a new preview. Document bookkeeping does not invalidate its own source snapshot.
- All 314 original bindings remain, plus two observed cell inputs (Seq B26 chip confirmation and Pool C20 filename), for 316 verified mappings. Each binding independently passes write/readback/locality and merged-anchor checks. Draft/resume/export reuse the existing editor and immutable revision history. Printed instrument-diagram squares remain immutable artwork; no invented cell overlays were added.
- Filled text can use a cloned shrink-to-fit alignment, preserving source fonts and original styles. Actual native export of an overlength HALOS ID fits its cell. Static instruction rich text is preserved.
- Native master and populated output pass page counts **2/2/2/1/1/1**, all portrait A4. Excel must select one tab before export, because retained tab selection can export multiple sheets together. Inverse printer coordinates are restored to physical A4 using observed native coordinate scales 0.69/0.62/0.57 for the last three sheets; no worksheet Scale, margins or PageSetup is changed. Pool's stored Zoom remains 66. Unknown media or extra pages fail closed.
- All nine native pages preserve table borders, images/anchors and common text font/size/position. The three imported sheets also match the actual owner-source native PDFs for table borders and 92/73/175 static text spans. The rendered master/filled contact sheet was visually inspected. Formal owner Print Preview acceptance remains external.
- Positive testing exposed HN truncation in the report parser and HN slash rejection in the RES serializer. Both now preserve the same PET-supported identifier, including leading zeros and `/`. Paper DOB/EDD are bound to current verified Paper evidence, with no fallback to an obsolete electronic request.
- Worker release reservation uses its existing LN lock without UPDATE privilege on result releases; final publication uses a narrowly granted SECURITY DEFINER release-lock function. The resumed actual background Worker reached AWAITING_CONFIRMATION with `hisConfirmed=false` on the previous released local test fixture. This is local file publication, not hospital acknowledgement.

Current evidence: `.local/owner-master-focused-v2.log` (7 passed, 1 opt-in native test skipped), `.local/owner-native-db-094.log` (2 passed), `.local/res-hn-green.log` (2 passed), `.local/owner-combined-binding-native.log`, `.local/workbook-binding-fidelity/{master,filled}-native-evidence.json`, `native-fidelity-evidence.json`, `.local/owner-source-visual-evidence.json`. Typecheck, lint, source guard and production build pass in `.local/owner-{typecheck,lint,guard,build}.log`.

## Remaining software gaps

The fresh complete Browser + Worker + native document journey PASS is recorded in `.local/operational-positive-BT0dZK/evidence.json`. It includes 45 cases, actual background PET ingestion, S2 resampling, F2–F5 PRE_WORK/COMPLETED linked artifacts, all 316 Draft/Resume/XLSX/six native PDF bindings, background report parsing, QC5/certification and P6 PDF/RES/backup/BOM-only OK publication. The transfer remains AWAITING_CONFIRMATION with hisConfirmed=false. Loaded Result and S2 browser views pass separately with no page errors in `loaded-browser-evidence.json`; those checks reuse this same completed database. D52=10/20 native Save/Resume/XLSX/PDF recalculation passes in `.local/owner-d52-native-export.log` (F52 33.3/16.65; D55 66.7/83.35). Final regression PASS: 89 files passed, 16 files skipped; 1,938 tests passed and 50 skipped (1,988 total), in `.local/owner-final-regression.log`. A stale P7 parser-version assertion was corrected and its 8 focused tests pass. The opt-in native D52 test skipped in the standard suite was run separately and passes. Final typecheck, lint and guard pass in `.local/owner-final-{typecheck,lint,guard}.log`; production build passes in `.local/owner-build.log`. The browser journey uses actual UI login and authenticated browser requests for stage transitions, with actual Worker, isolated PostgreSQL and native Excel. It does not claim every form was exercised through mouse/keyboard, nor physical HALOS or HIS acceptance. Existing P1–P8, HIS and Resampling implementation is retained. No known remaining software gap was observed in the requested local operational paths. This closes local software completion; hospital/clinical acceptance and Windows packaging remain outside this result.

## External tests not run

- Hospital LAN/UNC/SMB, service-account deployment ACLs and actual HIS/CFS ingestion or acknowledgement.
- Physical HALOS import and sequencer/device acceptance using real laboratory runs.
- Physical printer output, installed-renderer/service-account Excel behavior, and formal owner visual acceptance.
- Clinical/DPO/DCC/UAT acceptance with authorized hospital data.
- Final Windows installer, signing, upgrade/recovery on an installed candidate. Packaging remains outside this task.

## Local commits

- `9cafd45` — deployment configuration template.
- `99b9dd9` — database guards and evidence storage.
- `a93f703` — locked workbook/native Excel export.
- `bbad62c` — operational Lab/QC/result-release services.
- `7e077ec` — released-result P6 integration and authorized result folders.

Runtime/resampling commits `43148dd` and `2d10a8d` from the preceding work remain intact. Verification tools and this delivery report follow in a separate local commit. No push or merge was performed.

Local software completion commit: `8523198`. The separate verification/report commit contains the positive journey harness and this updated delivery report; its SHA is available in the immediate local Git log. Both are descendants of `978bea8`. The working sources and all pre-existing uncommitted task changes were preserved and committed. No push or merge was performed.

## Owner correction: 50 x 20 mm tube labels (2026-10-15)

The active tube print path now uses 50 x 20 mm pages/stickers and 25 x 20 mm halves in NIPT and Genomic. This supersedes the previous 60 mm tube specification; historical fixtures remain evidence only. The separate Genomic box-label path is unchanged. Four stickers/eight halves retain the dashed cut, issued base LN Halos, HIS LN, composition suffixes and 32 vertical base-sequence marks. Long HIS LN text shrinks without dropping leading zeros. No run R/DR suffix is substituted for the issued tube-label base.

Genomic local commit: `57de674602da8ac5e43d302047fad064d291304f` (6 label tests and targeted lint passed). NIPT focused checks: 9 passed, including real Chromium geometry and 16 PDF pages for normal/twin/resampling contexts. `.local/label-50mm-glSqZH` contains HTML, PDF, preview and real two-repository parity evidence. `tools/operational/verify-label-print.ts` regenerates artifacts with exact source revisions. Physical printer calibration and owner print acceptance remain NOT RUN. Operational recovery and exact final-candidate verification below are still in progress; historical completion statements above do not certify these newly changed paths.

## Final software fixes and pre-merge verification continuation (2026-10-15)

This section supersedes the earlier broad completion statement for newly changed recovery, health and label paths. The locked combined master remains `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`; no workbook bytes or formulas were changed. Runtime loader configuration and missing/obsolete/valid master checks are implemented. Genomic label HEAD is now `978f282` (10 focused tests and targeted lint passed), with the actual 50 mm layout introduced at `57de674`. NIPT label geometry, HTML parity, print audit/reprint contracts and PDF text checks use 50 x 20 mm pages and 25 x 20 mm halves. Only the separate box-label path and historical evidence retain the old dimensions.

Local operational changes are `f9017bc` (streaming encrypted recovery, operator policy/service identity, private directory ACL, database/file/P6/master inventory, fresh quarantined restore, source fencing and actual runtime probes), `2191b18` (initial share outages now enter scan history) and `bd5bea1` (runtime master regression). Migration 095 is forward-only; previous migration bytes remain unchanged. Restore preserves database ACLs and runtime users cannot clear quarantine. Recovery policy must include all historical frozen outbound destinations. Deployment must provision roles, backup keys and hospital-share ACLs before recovery; no key is included in the archive. Synthetic formats and guards remain available.

Observed diagnostics, before the exact final candidate run:

| Check | Evidence status |
|---|---|
| Labels | PASS: 10 NIPT focused tests; 10 Genomic focused tests; real two-repository HTML parity and Chromium PDF. Physical printing NOT RUN. |
| Master runtime | PASS: valid combined master, obsolete master, missing path/file and wrong bytes checked. |
| Populated P8 upgrade | PASS: historical migration bytes, existing Case/Round/Audit/Asset, forward migration/reapply and synthetic backup/restore verified in disposable native PostgreSQL. |
| Native safety | P6 33 and P7 1 passed in diagnostic run. General native P3 exposed an initial-open outage recording defect; focused database 9 tests and actual native P3 pass after its fix. Final complete native run is recorded separately. |
| Positive ANC S1/S2 | Browser/API, DB and actual Worker reached two certified releases and two PDF/RES/backup/BOM-only OK publications. HIS confirmation remains false. A forced-stop test-harness race correctly blocked backup; harness now uses the existing Worker graceful lifecycle through test-only IPC. Final recovery completion must be established by the exact candidate evidence. |
| Full regression | The diagnostic suite intentionally captured the new outage regression before its fix (1 failed, 1948 passed, 51 skipped). This is not final passing evidence. |
| Runtime recovery/health and final build | Final acceptance is determined by the generated exact-candidate report below; source presence alone is not evidence. |

The authoritative final readiness report is generated by `tools/operational/verify-final-candidate.ts` on a clean committed candidate. `.local/final-candidate-latest.json` points to its `readiness.md`, `readiness.json`, individual command logs, JSON regression inventory and command provenance. Every entry includes exact HEAD, source tree, migration inventory SHA-256, command, runtime mode and timestamps. No final PASS should be inferred unless those actual checks return zero. The native runner separately provisions its own PostgreSQL cluster, enables the previously skipped general/P6/P7 suites and repeats the populated P8 upgrade/recovery. Full regression enables the native Windows Excel concentration/export test. The positive journey includes ANC S1 and S2, new PET P[21], 316 draft/resume mappings, all six exports, label print/reprint and actual restored Worker restart. Generated evidence is local and synthetic/test-identity only.

Pre-merge ancestry: P8 `7967cd5`, HIS `7942477` and former Main `53482f0` are already ancestors. The observed newer Main `07adc05` contains five label files; their 50 mm corrections are represented in this branch, with the additional measured text-fit correction shared with Genomic. Main was not merged. Exact merged integration HEAD and GitHub CI remain NOT VERIFIED until the owner authorizes integration. CI now enables dedicated P6 and P7 native database fixtures rather than silently skipping them. Windows Excel/Fonts and physical printing remain separate from Linux CI.

External tests remain Hospital LAN/UNC/SMB and deployed service ACLs, actual HIS acknowledgement, HALOS/sequencer hardware, physical 50 mm printer calibration, formal owner golden visual acceptance and clinical/UAT acceptance. Windows Installer remains NOT STARTED. No push, merge or deployment was performed.
