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

## Workbook evidence and PDF cause

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

## Remaining software/source constraints

1. **Locked-master formula defect remains unchanged.** `Pooling Table!F52` is `(D54*F54)/D53`, while `D52:D53` is merged and the entered C1 value belongs to anchor D52. Native Excel reads D53 as empty and produces `#DIV/0!`; D55 (`F54-F52`) inherits the error. This occurs in both the original and a derivative with every declared input populated. Repair requires changing a locked formula or writing into a merged subordinate cell, both outside the permitted change scope. PDF export records native formula errors and the editor warns when the selected sheet contains them. Preservation of 149 formulas does not mean all 149 calculate successfully.
2. **100% visual fidelity is not certified.** Task-list page count/A4 and structural preservation pass, and actual owner screenshot comparisons exist. Formal acceptance against interactive Excel Print Preview for the other three sheets is still open. Their native Adobe exports retain the master's 69%, 66%, 57% zoom behavior and produce QC/Pooling/Sequencing page counts 1/2/1, with non-A4 PDF media boxes. A Microsoft Print to PDF experiment changed pagination, so it was not silently substituted.
3. **Binding exhaustiveness remains a verification gap.** All 314 declared cell bindings across six sheets were populated and exported, and automatic upstream bindings were integration-tested. This does not prove that every possible dynamic field embedded in instrument-diagram images is covered. Those images remain intact; no guessed cell mapping or overlay was added.
4. **Legacy controlled-document issuance is not yet fully connected to the native Master export.** The operational workbook editor exports the locked Master, but the older F2/F3 issuance/working-copy ports still use the existing renderer; F4/F5 simulation document history also remains. Connecting native Master artifacts to the complete issue/supersede/working-copy/recalled-copy lifecycle must be completed and tested before treating those legacy buttons as operational Master issuance. This delivery does not claim that a separate workbook download closes that integration gap.
5. The positive Pool-to-release-to-P6 chain was exercised through persisted database services and actual isolated files. The native PostgreSQL/browser exercise covers registration/PET/clinical/acceptance/resampling and workbook export. A single browser-driven positive operational journey through every lab screen, with the actual background worker publishing that release, is not yet independently demonstrated.

These constraints prevent claiming Operational Completion closed or starting Final Windows Package on the strength of this delivery.

## Validation

- Typecheck, lint, source guard and production webpack build: passed.
- Full regression after the last source changes: **1,926 passed, 49 skipped, 0 failed**; `.local/operational-final-regression.log`.
- Browser regression: **69 passed, 1 skipped**, `.local/browser-regression-RyZWhN/playwright.log`. The skipped test requires an installed Windows candidate.
- Focused operational chain and workbook-source checks: passed; `.local/operational-workbook-source-focused.log`.
- Native PostgreSQL/HTTPS/browser evidence: `.local/operational-native-built-final.log`, artifact directory `.local/operational-native-guk2gC`. Uses temporary loopback databases and test identities, starts the compiled app/worker with restricted database roles, checks migration reapply/checksum idempotence, and stops its owned processes. Includes actual browser draft/resume/native PDF preview through restricted app-role connections.
- Migrations 001–083 remain unchanged from integrated baseline `5adc107`. New migrations 084–090 were tested on disposable databases. No shared/Production migration was applied.

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
