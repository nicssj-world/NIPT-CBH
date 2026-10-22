# LAB-01–LAB-13 Development evidence

Status: **READY FOR OWNER TEST — Local Development only**. **OWNER-UAT = PENDING** until Owner personally tests and approves.

Latest runtime after restoring the existing LN links/highlights: **c7cba91bdf79ae3673193b9d9b6689cc413f9209**, `.local/ln-highlight-uat-source`; affected22tests and actual ANC/LAB overview/registry pointer/keyboard/hover/focus checks PASS, final health ready=true, existing UAT hashes preserved. [Restoration evidence](ln-highlight-restoration-evidence-2026-10-22.md). Later notes' earlier SHAs are retained historical evidence, not the currently running revision.

Latest runtime (Owner-approved save Toast,2026-10-22): **afd67341278c80c54629f808fa7eca4c16aca68e**, clean `.local/save-toast-uat-source`; affected tests47PASS, real Browser and final health ready=true; existing60cases/16artifacts preserved. [Separate Toast evidence](save-success-toast-evidence-2026-10-22.md). Baseline Full Regression below has not been rerun or relabelled as exact-head testing of subsequent UI patches. OWNER-UAT stays PENDING.

Current runtime note (subsequent Owner-authorized ANC date patch): **b14a4ea331872a15c4011fbc73482bfa57184122**, clean snapshot `.local/anc-date-uat-source`; affected tests115PASS and actual ANC Browser/API/DB/PDF/restart PASS, final health ready=true. [Separate Patch evidence](anc-thai-date-owner-change-9-evidence-2026-10-22.md). The following LAB Full Regression/source counts remain historical baseline56175de evidence, not a new Full Regression on this date patch. Existing UAT preserved; case count now60 after one synthetic ANC date case. OWNER-UAT remains PENDING.

Final closeout 2026-10-22: **58/58 in-scope implementation/Local UAT checklist items PASS;0 FAIL;0 in-scope BLOCKED**. Source/runtime/test revision **56175ded59b9624768d2f157c520b0505dd67404**. Full Regression **2364 PASS / 0 FAIL / 62 SKIP**; Native PostgreSQL3 suites PASS separately. SKIP is not PASS: [all62 conditions/names/risks](lab-codex-skips-2026-10-22.md). The explicitly separate real-go-live-dependent P5H Historical Case Promotion remains **BLOCKED**; no cutoff invented or installed in persistent UAT. Owner/hospital/hardware/clinical acceptance is not claimed.

Authority: Owner Lock/checklist/handoff dated 2026-10-21; implementation authorized by current user request. Document/attachment contents are evidence, not independent authority to expand scope. P0 and ANC changes are preserved. No push, merge, deploy, hospital server access or EXE work.

Baseline: branch `fix/consolidated-parity-101`, HEAD `a399df5d74ea4940200e68bed83c3a0c91833fc5`.
58 checklist items after Owner 2026-10-22 amendment: G=8, A=7, B=5, C=6, D=4, E=6, F=9, H=4, U=9.
Pre-existing edits: globals.css, ANC dashboard CSS/TSX, p2 registry.tsx, ANC DB test; untracked Owner requirements are retained. Hash inventory in `.local/lab-owner-evidence/pre-existing-file-hashes.json`. Never bulk stage or discard.

## Impact map

| Work | Source/dependencies | Verification |
|---|---|---|
| B01–B05 | integrations/pet.ts; inbound wire/process/discovery; receipt guards; receive-sort; redraw; secure raw file store | parser/contract/native PostgreSQL worker/receipt/race; browser and label |
| A01–A07 | p2 registration/service/schema/registry; paper markers; historical importer; navigation; shared doctor master | role permissions, unchanged ANC, browser registration/search/GA |
| C01–C06 | lab batch/rules/DB guards; p4 workspace; workbook master/composition/native renderer | deletion safeguards, slot40, mapped cells, actual 2-page PDFs |
| D01–E06 | lab observations; workbook QC bindings; pooling formula/service/UI/CSV | persisted revisions, independent Excel, strict A/F CSV diff, boundary tests |
| F01–F06 | sequencing service/UI and workbook bindings; secure round-specific PET/request provenance | exact vendor schema/style/row order/dates/identity, native print |
| H01–H04 | NIPTY reference; results parser/import/review/release; local outbound | real local PDF/ZIP, mismatch/redraw/duplicate/RES/OK failure journeys |
| U01–U08 | Home-UAT and Local-Owner-UAT launchers, Docker/Excel/native PostgreSQL/browser | runtime SHA/health, persistence, artifacts, owner handoff |

## Per-item status

PASS records only the stated local evidence scope. FAIL means an implementation or verification requirement remains; BLOCKED identifies an unresolved authoritative contract. Neither FAIL nor BLOCKED is checked as complete.

| ID | Status | Evidence / remaining work |
|---|---|---|
| G01 | PASS | Requirements/templates/source read before editing; impact map and initial user-file hash inventory retained. |
| G02 | PASS | Master formulas preserved; no automatic QC acceptance, fabricated event time or identity added. |
| G03 | PASS | Latest Owner decision supersedes old WI and fixed-47/48 HALOS limits. Actual-membership implementation is in progress; no reopened resolved QC question. |
| G04 | PASS | Forward111–120 applied to persistent native UAT; original migration SQL/ledger unchanged, user ANC edits preserved. Exact verified105 CRLF/LF pair accepted without rewriting ledger. Web/worker/renderer baked56175de and migration inventory43f663d9... match. |
| G05 | PASS | Local Development only; no push/merge/deploy/hospital access/EXE. |
| G06 | PASS | Operational Pool/Seq routes use real Master Bench calculation; runtime Batch navigation no longer labels these routes as simulated. Training banner stays only in isolated local UAT. |
| G07 | PASS | Both skills used; prior bounded reviewer ship plus final-ui-audit.json: seven LAB surfaces,42 captures at375/768/1280/1440/light+dark,0 document overflow/axe violations/page errors; Manual dialog Enter/Escape works. Prior QC Tab entry proof retained. No physical scanner/device acceptance inferred. |
| G08 | PASS | Native persistent operational/Manual/result/restart journeys, affected tests and complete configured Full Regression56175de passed with0 FAIL;62 SKIP separately itemised, not counted PASS. All58 implementation/Local UAT items now supported by evidence. Owner acceptance remains PENDING. |
| A01 | PASS | J3BTMX Browser: two Lab choices, operational paper route submits without ANC. Manual route additional UAT remains in A04. |
| A02 | PASS | J3BTMX UI LN/HN, GA/EDD/pregnancy; 45 native worker PET receipts after registration; registration/identity regression tests. |
| A03 | PASS | Browser paper markers only; lab-owner-registration DB tests; no clinical/signature snapshot fabricated. |
| A04 | PASS | owner-manual-browser.json: actual CSV+ZIP/two Final PDFs ->native Worker ->verified paper markers ->independent Certifier PDF/identity review. Cases56/Attempts51/observations0/releases2 unchanged; no PET/QC/new certification or persistent cutoff. Current review binds draft version/PDF hash/paper snapshot. Manual/P5H focused25PASS. Separate P5H promotion only BLOCKED awaiting real go-live; native disposable test promotion3-file suite PASS with test-only config. |
| A05 | PASS | Persistent Browser owner-persistent-browser.json: HN/LN search and clear, actual 18w0 neutral / 18w1 red, four registry viewports; server debounce/stale-request guards retained. |
| A06 | PASS | Persistent LAB Browser confirms Settings then Health ordering and login/logout; role policies retained. |
| A07 | PASS | Shared physician permission/immutable-signature DB tests; corrected zkzUMt browser edits/resumes the existing test physician. No signature invented for an operational physician. |
| B01 | PASS | Strict P21/P23 parser + CP874 native worker fixtures; 24 focused PET tests and native race evidence. Real Hospital share not tested. |
| B02 | PASS | J3BTMX: 45 real native-worker receipts, including PET before registration; no DB status flips. |
| B03 | PASS | Append-only clock correction and effective views; PET/redraw/correction tests pass. Correction tool preview/apply is loopback-only; no persistent records corrected. |
| B04 | PASS | owner-label-print.json: real print job/item/audit and actual Browser PDFs for single/bulk/S2:4/8/4 pages, every page50x20mm. owner-s2-browser.json verifies own new PET time, same base LN and original-round lineage; raw S1 retained. Physical printer NOT RUN. |
| B05 | PASS | Disposable native PostgreSQL/worker/browser receives isolated PET+OK through operational code path. |
| C01 | PASS | zkzUMt real Browser: empty draft delete confirmation, immediate return/refreshed Batch list. Nonempty/post-QC cancellation/amendment guards pass. |
| C02 | PASS | Persistent Owner Batch 375/768/1280/1440 Browser rerun after scoped CSS containment passes no-overflow; tabs/physical strips/native navigation usable. owner-bench-failure.json later failure is NIFTY missing optional physician, addressed in new source. |
| C03 | PASS | owner-urgent-progress.json phase6 and owner-urgent-readback.json: actual persistent Browser urgent1045 at physical40, both XLSX downloaded from current recorded actual pooling. HALOS positions1,2,17,25,40; PC/NC exact, no invented BLANK. Full48 template/calculation boundary contracts retained. |
| C04 | PASS | New composed Master SHA 4c5300f9...; replacement Task XML, unchanged QC/Pool/Seq formula XML and 149 formulas independently checked. |
| C05 | PASS | J3BTMX task-1/2/3.pdf: exactly 2 A4 pages each. Native black/bold BE work date verified; rendered Task page inspected. |
| C06 | PASS | J3BTMX finalized Task Lists proceed directly to QC grid/real formula calculation; no invented execution receipts. |
| D01 | PASS | Real frozen 48-position IDs shown in Browser, native QC/PDF, calculations and contracts; urgent test fixture separately passes. |
| D02 | PASS | Persistent Browser saved all48 QC +9 standards, reloaded slot2=30 and Tab advanced slot2->3. owner-bench-failure.json events retain executed proof. |
| D03 | PASS | Missing standards/applicable concentrations rejected by DB/contracts; J3BTMX actual native qc-native.pdf preview passes. |
| D04 | PASS | Native/CSV saved-source parity and revision tests pass; Seq edits keep QC-derived CSV current, changed QC invalidates CSV and new actual-pooling snapshot. |
| E01 | PASS | Actual verified Master formula drives operational Bench, native comparison default47/urgent48/boundary40 PASS; no scenario selector in Bench. |
| E02 | PASS | Native red readback zkzUMt pooling-native-red.json confirms sample ID +1.78 volume red; original fonts/styles/formulas preserved by derivative conditional formatting. Independent Excel parity passes. |
| E03 | PASS | J3BTMX native Pooling PDF 1 A4 page preview; QC2 three standards/concentration entered after print preview. |
| E04 | PASS | Browser 3.00/3.60 neutral, 3.61 red/dilution; C1=6.66 gives50/50. Actual native PDF E14=3.61 red verified in zkzUMt. |
| E05 | PASS | Actual browser CSV plus contracts: 48 physical rows, A/F only, B-E/header/CRLF invariant, special slots and 2.00 boundary. |
| E06 | PASS | Actual operational Bench/Batch/Pool/Seq paths use real source/formulas; 4f813c9 Browser shows no scenario selector or formula-version developer labels. Synthetic compatibility path remains separate. |
| F01 | PASS | zkzUMt: all21 Seq observations/reagent confirmations save/reload and actual native one-page Seq PDF. Persistent all21 save/reload also completed before amended export. |
| F02 | PASS | owner-dual-export-readback.json plus actual Urgent/S2/slot13 Browser pairs: eligible patients first, PC/NC last, Q=ANC, BLANK excluded; persisted RE_LIBRARY export test excludes repeat from NIFTY while retaining true pooled repeat in HALOS. Original vendor template intact. |
| F03 | PASS | NIFTY contracts verify fixed fields, PET round times, EDD-based GA, pregnancy and suffix; actual raw PET download path used. |
| F04 | PASS | Real downloaded owner-nifty.xlsx: all47 patient/PC/NC rows Q=ANC; other fixed/template/PET/request fields preserved. Missing optional physician stays blank, never fabricated. |
| F05 | PASS | Hash-verified raw correct-round PET; LN/HN/name/DOB checks, request source required; contract negative cases pass. |
| F06 | PASS | Native source/schema/date/GA/age/twins/control parity retained; amended NIFTY/HALOS11 contracts and persisted repeat export pass. Actual normal/urgent/S2/D13 Browser downloads/readbacks; source S2 time00:04/00:05, no erroneous exclusion due to S1 history. |
| F07 | PASS | Persistent one-click API created two immutable XLSX under one revision and actual-Pooling snapshot; both downloaded via real Browser. owner-dual-export-readback.json binds pair/file hashes; transactional DB/idempotency tests pass. |
| F08 | PASS | final-repeat-export.log: persisted stopped-parent ->real RE_LIBRARY child ->assigned/frozen ->NIFTY excludes child; HALOS keeps actual pooled physical member. Native lineage guard PASS; pure prior-Seq and current re-export tests; real S2 not excluded by old S1 Seq, raw new-round times verified. No new printed-ID rule invented. |
| F09 | PASS | Actual Browser main44 positions excludes2/7/13/40, urgent includes40, new Run includes actual13 at physical13. owner-slot13-browser.json positions1,13,17,25,33. Immutable original SHA1e4ffc97..., exact L01/Bangkok date/blankE/physicalD/header/style verified in contracts,47/48/boundary/control-exclusion matrices pass. CSV unchanged fixed48. |
| H01 | PASS | NIPTY source/parser/identity review contracts retained. Current persistent Browser bulk Singleton+Twin PDF worker parsing, separate-person link review and authorised result actions passed. |
| H02 | PASS | Actual single/bulk Singleton+Twin/S2 PDFs, Manual CSV+ZIP/two PDFs through native Worker. owner-notice-duplicate-browser.json: NOTICE parsed separately, RN release BLOCKED, SHA duplicate reuses original version/no replacement/release. Existing identity/revision/series/reparse DB/contracts retained; Browser-positive revision replacement itself is not claimed. |
| H03 | PASS | owner-persistent-results.json PASS: actual current Pooling evidence, authorised peer worksheet/QC5 review, Singleton and Twin certification; real Worker local RES/PDF/Backup plus BOM-only OK. hisConfirmed=false; no ACK invented. |
| H04 | PASS | Persistent S1 Singleton+Twin release, actual new-PET S2 through dual export/independent QC5/certification/local files, urgent40, Manual original-PDF independent review, NOTICE blocked release and duplicate safeguards. Earlier S2 cross-check failure retained; fix/relink goes through authorised UI/API, no DB bypass. Actual HIS confirmation/hardware/clinical acceptance not claimed. |
| U01 | PASS | Selected LAB-only local commits b91e26e,2abdfa7,441ba26,cdcadea; clean detached .local/lab-uat-source built successfully. Original globals/ANC/test edits and two original registry hunks remain unstaged. |
| U02 | PASS | Final clean56175de npm test exit0:176 files passed/20 wholly skipped;2364 PASS/0 FAIL/62 SKIP,693.50s. Full log retained; no exclusions/new skip flags. Typecheck/lint/guard PASS; exact-source Docker npm build PASS. Native PostgreSQL repeat/P5H/PET3 suites PASS separately. Every SKIP retains that status/reason/risk in dedicated ledger. No full rerun in final closeout. |
| U03 | PASS | Six native PDFs/149 formulas/Task2A4 each, QC/Pool/Seq1A4 each; native red readback and strict CSV/NIFTY baseline retained. New dual XLSX requirements tracked F07–F09/U09. |
| U04 | PASS | Actual native runtime Browser journeys now include operational PET/LN/print jobs/Task2A4/QC48+9/real Pooling/dilution/CSV/all21 Seq/two XLSX/native PDF/Singleton+Twin+S2 releases, separate Manual ZIP/review and failed NOTICE. Final56175de native PDF Preview + QC Tab visible2px focus PASS; final UI42 responsive/light/dark captures0 axe/overflow/page errors. |
| U05 | PASS | Final56175de Restart ready=true;59cases/4batches/3releases/3transfers unchanged. owner-restart-persistence.json hashes19 record groups and verifies16 stored artifacts; after-restart Browser LAB/Certifier re-login retains QC/actual Pool/Seq/two original downloads/current Manual reviews/released S2. No cutoff/UAT reset or secret disclosure. |
| U06 | PASS | All58 IDs reconciled against checklist and actual logs/artifacts; previous failures superseded explicitly,62 SKIPs itemised without PASS relabelling, external Promotion/hardware/HIS/clinical boundaries retained. Final report/Handoff/skip ledger updated; hashes and preserved user edits verified. |
| U07 | PASS | READY FOR OWNER TEST: final health ready=true, source/runtime/test56175de match, real local Browser workflow and restart/relogin pass. URL/credentials-file path/roles/Start-Stop-Health/test cases supplied. OWNER-UAT=PENDING; stop before EXE/Production phase. |
| U09 | PASS | Actual persistent main/urgent/S2/slot13 one-click Browser pairs, download byte/cell readback; manifest binds same workbook/actual-Pooling source and both SHA hashes. Permissions Auditor403/Lab200; gaps/F0/stale source/re-export/date boundaries contract-tested. No device/hospital import acceptance claimed. |
| U08 | PASS | No installer/upgrade EXE generated, modified, installed or deployed. |

## Input inspection

Read Owner Lock, all 54 Checklist entries, Handoff and AGENTS before source changes. Found and hashed all three user attachments. `python tools/operational/inspect-lab-owner-inputs.py` reads OOXML/CSV without changing originals. Six-sheet Master has 149 formulas; Pooling B8:B55 uses `160 / COUNTA(QC!C7:C54) * B6 / concentration`, B6=16. Dilution F52=`(D54*F54)/D52`, D55=`F54-F52`, D54=3.33, F54=100. Pool CSV: UTF-8 without BOM, CRLF, header plus 48 rows, immutable physical B–E. Replacement Task sheets retain A1:M53 and mapped coordinates; supplied sheets 2/3 contain example sample IDs that must never leak into generated runs.

| Input | SHA-256 |
|---|---|
| Final New_Task_List_1-3.xlsx | 9e69127a4f162796d43ce04f7c80a5b056053e4b74a061363ad2dd00d95fc821 |
| Pooling Sheet Template_R001.csv | 2ea12e86e1429be6ad9720c3b1b45f90588ad5c1316548146b5062b16bd6977a |
| NIFTY_Test_Request_FormHNZ_filled.xlsx | 07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc |
| Original six-sheet Master | 0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6 |


## Owner QC policy override (2026-10-22)
Owner explicitly ruled latest QC policy takes precedence over legacy WI. Updated `docs/lab-workflow-owner-lock-2026-10-21.md`, Checklist and Handoff to reflect this decision. QC1 current Master ≥2 ng/µL for patient/PC/NC; BLANK ≤0.6; WI 3–50 deprecated as operative gate. QC2/Pooling unchanged. QC3/QC4 new numeric thresholds not stated by Owner; preserve actual observations/reviews and avoid clinical auto-PASS. This is **owner-decision evidence**, not implementation/test PASS. Continue impacted source fixes and focused validation.

## Test log

- PET regression first reproduced all 3 failures: old parser used P21 receipt/O14 order, builder wrote old P21, and accepted absent P23 receipt. Fix uses P21 order and explicit P23 components; no sorting/fallback.
- Docker inventory confirmed existing owner-local containers and separate parity-validation PostgreSQL at loopback 19831. Existing local data is preserved. Container existence is not current-source readiness.
- Skills: ui-ux-pro-max search completed; Impeccable existing Operate design context loaded; preserve existing Thai tokens/components. Next 16.4 installed Server/Client Components guide read.

### Milestone 2026-10-22 — source and scientific parity

- PET parser + registration/redraw/append-only clock correction: `npx vitest run tests/db/lab-pet-clock-correction.test.ts tests/db/lab-owner-registration.test.ts tests/contracts/resampling-pet.test.ts tests/contracts/p3-inbound.test.ts`: **24 passed**, `.local/lab-owner-evidence/pet-clock-tests.log`.
- Native PostgreSQL registration/PET race: `node tools/operational/run-lab-native-tests.mjs tests/contracts/p2-p3-native.test.ts`: **1 native contract suite passed**; source DB/role evidence in `native-postgresql.json`. Subsequent migrations still require a fresh native run.
- Permissions **834 passed**; actual Master Pooling/CSV **5 passed**; NIFTY Owner-fixture contracts **4 passed**; GA >18w0d boundary **1 passed**.
- Affected integration tests **20 passed, 1 skipped** before clock-overlay migration: `.local/lab-owner-evidence/affected-tests.log`. Skipped native Excel environment case is not a PASS.
- Initial full test invocation overlapped active implementation and exposed obsolete Master/doctor expectations plus host-related backup errors: **23 failed / 2316 passed / 61 skipped**. This is not current completion evidence. Master/doctor tests have been corrected and affected tests re-run; final full suite remains required.
- New Master SHA-256 **4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1**. Composition preserves QC/Pooling/Seq worksheet XML byte-for-byte, clears worked examples only from runtime Task bindings, and makes A4/B4 captions/values black bold without altering original font definitions. Original files remain unchanged. Additive migrations 111–115; no old migration rewritten.
- Native Excel comparison **PASS** for default47, urgent48 and boundary40: all 48 formula slots, dilution V1/EB and black/bold BE work dates. `.local/lab-owner-evidence/native-comparison.json`. This is scientific calculation parity, not clinical acceptance.
- Native Excel generated all six filled PDFs; actual corrected A4 page geometry/visual review is still being collected. Files in `.local/lab-owner-evidence/filled-native/`.
- The application now has two LAB registration choices; paper markers persist separately from signatures/clinical snapshots. Saved QC/9 standards drive the bench Pooling and CSV. NIFTY exporter uses raw hash-verified PET for the correct round and the immutable vendor reference. Bench export revision audit is append-only.
- Browser harness first run: **FAIL — worker harness missing compiled-build flag**, before intake. Failure retained under `.local/lab-browser-DBX9tK`; fixed harness rerun pending. No persistent Owner UAT data was used.

### Historical note — urgent HALOS blocker superseded by 2026-10-22 amendment

C03 HALOS-only **BLOCKED — OWNER MAPPING REQUIRED**: existing `packages/halos-export/contract.ts`, `barcodes.ts` and `pooling/halos.ts` require exactly 47 members and the existing 47-barcode contract (Barcode13 excluded). The Owner now permits urgent patient slot40 (48 members). The provided NIFTY example resolves patient/control row ordering for NIFTY, but supplies no replacement HALOS barcode contract for the 48th member. No Barcode13 or extra row is invented. Physical Task placement, Pooling 48-row CSV and NIFTY 48-record exception can be tested independently.

### Clock correction boundaries

`tools/operational/correct-local-pet-clocks.ts` defaults to preview, requires explicit loopback DB configuration and an active Admin/IT actor, re-reads immutable hash-verified raw PET, and stores a correction overlay. `his_inbound_file_current`, `his_order_current` and `specimen_round_current` expose effective corrected timestamps. Original base rows and issued snapshots are deliberately retained unchanged as prior lineage; no issued LN Halos is renumbered. Application/worker roles can read, but cannot insert corrections. No correction has been applied to persistent Owner UAT data in this session.

### Browser/native milestone 2026-10-22

`.local/lab-browser-J3BTMX/evidence.json`: real compiled HTTPS app, isolated native PostgreSQL roles, real inbound worker, Microsoft Excel bridge, real renderer. Operational registration -> 45 PET auto-receipts/LN Halos -> 3 finalized Task Lists -> QC + 9 standards -> Pooling/CSV -> inclusive QC2 boundaries/dilution -> native QC/Pool/Seq previews -> real NIFTY XLSX -> three native two-page Task PDFs -> single/bulk label preview source -> actual PDF upload/worker parse/import. Console errors empty at recorded checkpoint. Full Result journey is explicitly NOT_RUN, not PASS.

The first Preview test incorrectly read a zero-byte Chromium DevTools PDF response even though the UI had received the complete PDF Blob. The corrected observer records the actual Blob without replacing fetch or changing its bytes. PDFs open and have expected native page counts. Artifact API now serves the committed hash-verified file with exact Content-Length; Bench CSP permits its blob iframe.

Native PDFs were rendered to PNG and inspected (Task 1, QC, Pooling, Seq). Pooling was numerically correct but native font did not show the required <2 alert. A derivative-only style fix now marks sample and volume red, and E14 when outside 3.00-3.60; original Master/style definitions/formulas stay unchanged. Focused contract passes; new Browser native rerender remains pending. `.local/lab-browser-J3BTMX/pdf-geometry.json` records all six PDF geometry checks.

Impeccable reviewer disposition `ship` scores only two fixes (selected worksheet visibility, ID/volume separation) resolved in four viewports. Axe violations [] and no page overflow. This is not whole-product acceptance. Documenter delegation hit tool usage quota; scoped documentation will be completed inline without changing pinned global DESIGN.md.

### Historical note — QC reference question resolved by newest Owner decision

Owner Lock does not authorize inventing a QC criterion or fabricating old execution/review receipts. Existing `packages/lab/qc.ts` records a QC1 conflict: WI 3-50 ng/µL versus Workbook >=2 and BLANK <=0.6. `packages/sequencing/constants.ts` identifies QC3/QC4 criteria as UNAPPROVED; operational decisions require a supplied controlled reference. Migration 086 requires accepted Pool/DNB/current sequence/verified handoff and QC5 before release; paper Bench saves do not constitute those decisions. The Owner was asked asynchronously for the controlled QC1/QC3/QC4 reference on this continuation. Only the affected acceptance/release bridge is held; UI, artifact, regression and persistent UAT work continues. This also remains an implementation dependency: read-only Bench linkage is not claimed as accepted QC integration.

No ACK, clinical acceptance, physical printer test, Hospital network test or Owner approval is fabricated. No persistent UAT database has been reset.


## New Owner amendment 2026-10-22 — two XLSX exports in Seq Task-G50
Source template `Task Import template(3).xlsx` inspected by ChatGPT from actual uploaded bytes (SHA-256 `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec`): `Sheet1!A1:E48`, 47 data rows, D Barcode 13 absent; B=`L01`; C2 placeholder `DNBYYYYMMDD`, E blank. Current old HALOS 47-only contract is superseded for new Seq Export file #2. New target 48 rows requires explicitly restoring missing D13 row, keeping other 47 original B/D values. File #1 excludes BLANK/rerun/prior-Seq patients while retaining PC/NC last. Full owner decision detailed in `docs/lab-seq-dual-export-owner-amendment-2026-10-22.md`. Earlier F02/F06 PASS no longer verifies amended requirements. **No source/test implementation result claimed here.**

## Owner update — NIFTY Column Q Department (2026-10-22)
**File #1 (NIFTY Test Request XLSX) only:** NOT YET IMPLEMENTED/TESTED at this document update: set Column **Q (Department)** to the exact string **`ANC` on every exported data row**, including patient rows and the trailing Positive Control and Negative Control rows. This overrides whatever Column Q contained in the reference sample; preserve all other agreed fixed fields, row eligibility/exclusions, formatting and untouched columns. **File #2 HALOS Task Import is unchanged.** Update the exporter, backend contract, XLSX readback/byte-cell tests and real browser download assertions. Do not source Column Q from PET, site or UI; it is a fixed Owner value. No questions or new policy.

## Latest Owner update — HALOS Task Import must reflect actual Pooling only (2026-10-22)
SUPERSEDES earlier fixed-48-row export target. Task List positions are stable 1–48, but file2 HALOS includes **only actually pooled members**, in physical-position ascending order, with D unchanged (e.g. BLANK40 excluded => 39 then 41). Prior missing D13 is restored iff pooled. Row count dynamic = 1 header + N pooled members; normal 47 when only Blank40 omitted, urgent40 may yield 48 if all pooled, fewer otherwise. File1 NIFTY (rerun exclusion and Q=`ANC`) unchanged. Current old implementation fixed 47 members and excludes 40; new source/DB/UI/worker/tests not yet verified. Checklist F09/U09 still OPEN until actual runtime/file evidence. Do not mistake this spec edit for PASS. Previous urgent HALOS `BLOCKED` notes describing an absent Owner mapping decision are superseded as to **membership/count policy**, but exact source-to-row physical mapping must still be checked in actual Pooling evidence.


### Current continuation — persistent runtime and latest amendment

- Local UAT cdcadea built and reported ready=true; URL https://127.0.0.1:19548/login; six role logins PASS. Logs owner-uat-mobile-start.log / owner-uat-checksum-start.log. Forward111–117 only; original DB/volumes/files retained. Credentials remain at `.local/owner-local-uat-1.0.2/credentials.txt` (no passwords in this report).
- `owner-persistent-browser.json`: actual LAB login, two registration choices, Health navigation,45 new isolated synthetic cases through matched PET Worker receipt/LN Halos, registry GA boundary/search/clear and single/bulk50x20mm label HTML/PDF; console errors[]. Registry screenshots375/768/1280/1440. Original6 cases remain.
- `owner-bench-failure.json`: captured executed positive events for three finalized Tasks, whole Batch four-viewports/no overflow,48+9 QC/save/reload/Tab, real CSV andQC2, then NIFTY failed because optional physician was absent. Narrow exporter now retains missing referring physician as blank instead of inventing one or forcing extra ANC work; focused DB dual test uses these exact missing-physician registrations and passes.
- Earlier `lab-browser-zkzUMt/result-continuation.json` PASS proves authorised S1 release +local Worker RES/PDF/Backup/UTF16LE BOM-only OK. A later accidental recheck waited for AWAITING_CONFIRMATION after that transfer had already reached RECONCILIATION_REQUIRED without ACK; hisConfirmed remainsfalse. It does not prove HIS acceptance, and prior successful artifact proof is retained.
- User-supplied `Downloads/Task Import template(3).xlsx` SHA matches1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec, also identical to pre-existing audit copy. Pure dual contracts11PASS. `dual-focused-final.log`14PASS before final integration changes; `dual-transfer-focused.log`3PASS includes real actual-transfer exception for F=0 and source invalidation. Migration118 is new/not yet applied to persistent UAT; migrations111–117 are frozen.
- No fixed47/48 HALOS count is treated as current policy. HALOS uses only recorded actual transfers, original physical positions and one Bangkok export date. NIFTY uses separate patient eligibility and fixedQ=ANC. No clinical numeric thresholds, signatures, ACKs or past physical event times are fabricated.


### Native persistent milestone — dual files and current Result workflow

Source `4f813c95f272a8419fc32808862f6ea0f712bfba`, clean `.local/lab-uat-source`, loopback19548. Forward migration118 has now applied successfully to native PostgreSQL and is frozen; future schema changes must be119+. `owner-uat-dual-start.log` reports ready=true,6 role logins and unchanged prior UAT records.

- `owner-persistent-dual.json` PASS: reused already-saved48+9 QC and all21 Seq values; actual transfer recorded excluding2/7/13/40; one click produced and Browser downloaded NIFTY+HALOS; readback exact Q=ANC47 rows and HALOS44 physical positions with gaps; native Seq PDF1A4 preview works. Original source Template SHA unchanged. `owner-dual-export-readback.json` stores pair manifest, current revisions and both SHA hashes.
- Initial dual readback test mistakenly treated the shared-string index in D1 header as a data position; source files were correct. The corrected continuation verified the two retained downloads without repeating QC/exports. Original failed test log retained.
- `owner-persistent-results.json` PASS: bulk2 real PDF bytes ->Worker parse/import ->Lab proposal ->independent Certifier link approval ->explicit current Pooling/QC/Seq review ->authorised Singleton and Twin release ->real local Worker RES/PDF/Backup/UTF16LE BOM-only OK. Actual target LNs9903001002/1001; no HIS ACK; hisConfirmed=false. Screenshots/transfer manifests retained.
- Clean-checkout test dependencies fixed without tracked source changes: ignored local Master copy verified4c5300f9... and @fontsource junction to installed dependencies. Previously failed PDF font tests now4PASS (`clean-font-focused.log`); remaining prior affected files30PASS (`clean-prior-failures-focused.log`). No coverage reduced. Final full regression waits until latest amendment/remaining scenarios finish.
- Latest focused source/legacy Result regression17PASS across5files (`dual-legacy-focused.log`); lint/guard/typecheck pass. No Push/Merge/Deploy/EXE, old SQL migration rewrite, or UAT reset.

## Final candidate milestone — 2026-10-22

Current source **56175ded59b9624768d2f157c520b0505dd67404**, migration inventory **43f663d903641a33e0836c75b1ad45828215ba832f9b915bdefa900cbd50ce21**. Clean detached `.local/lab-uat-source` is the actual Docker build context. `final-runtime-provenance.json` independently reads matching baked provenance from web/worker/renderer. No unrelated user globals/ANC/registry/test hunks were included. New local commits362ef8c (11 scoped Manual/S2 files) and56175de (forward120 +2 repeat tests) are local only.

- Latest Manual decision: **no actual go-live date has been set**. `LAB_MANUAL_COMPLETE` original PDF identity/review is independent from P5H Historical Case Promotion. Forward119 adds append-only review bound to exact draft version, original PDF hash/file and current paper-stage snapshot. Only independently approved active Lab Certifier can review; source mismatch, contributor self-review and stale evidence fail closed. This records review of an existing Final, not a new certification or clinical release. No native measurements/PET invented.
- `manual-legacy-focused.log`:5files25PASS; `manual-s2-final-focused.log`:4files5PASS. `owner-manual-browser.json`: real local CSV+ZIP/two PDFs/worker/paper markers/independent Certifier review; before/after Case56,Attempt51,observation0,release2. Test data are a **synthetic Manual001 support demonstration**, not migration of Owner's real completed patient records.
- `owner-s2-browser.json`: new S2 PET receipt and immutable S1 lineage/base LN, four50x20mm labels, all saved QC/Seq, actual Pooling and dual download; NIFTY new00:04/00:05 times. `owner-s2-results.json`: exact current-Pooling/QC5 review and authorised S2 certification/local RES/PDF/Backup/BOM-onlyOK, hisConfirmed=false. Initial missing S2 request-mode fallback caused a real cross-check failure; source fix uses recorded Lab metadata and this round's PET, and preserves explicit decline/revocation/identity gates. Normal unlink/relink/review retained the earlier failed audit.
- `owner-slot13-browser.json`: actual new Run at Batch UUID9aaf4e3b-bb0e-49d7-9fb1-78c53ab03d26. Operator moves a real test patient's draft physical slot2 to13 before finalization, records actual pooling, then downloads both files. HALOS retains1,13,17,25,33. Earlier main excludes2,7,13,40; urgent includes40. Normal47/urgent48/control exclusions/date-midnight/style/header/no-renumber cases have separate contract assertions.
- Additional persisted RE_LIBRARY test reproduced the generic foundation trigger reading analytical_attempt-only fields on repeat_work_order (`record new has no field repeat_order_id`). **Forward120**, without editing001, nests the table-specific branch; all original immutable case/round/attempt constraints remain. `repeat-trigger-red.log` retains red reproduction; `final-repeat-export.log` PASS: real persisted Repeat child assigned/frozen, excluded from NIFTY, retained in HALOS only with actual pooled membership; mutation of lineage still rejected. The disposable initial Stopped fixture is test setup, not an asserted physical stop in Owner UAT. Existing LN/Lab regression26PASS retained from `repeat-lineage-focused.log`; its earlier missing test import is superseded by final-repeat-export PASS.
- `owner-final-native.log`/`native-postgresql.json`:3files3PASS on a **new, separate** synthetic PostgreSQL DB at127.0.0.1:19831: repeat state/immutable lineage, P5H promotion/idempotency/roles, PET P2/P3 races. P5H test-only cutoff lives only there. Persistent Owner UAT cutoff remains absent.
- `owner-notice-duplicate-browser.json`: actual native Worker recognizes REDRAW_NOTICE, RN blocks release/no outbound; duplicate SHA reuses original version without replacement or new release. Revision/series/reparse invariants have existing separate DB/contract evidence; do not infer a positive Browser revision replacement from this duplicate test.
- `final-ui-audit.json`: seven surfaces ×four light widths/two dark widths =42 captures; WCAG2A/AA/2.1AA scan at desktop/mobile both themes:0 violations, document overflow0, page errors0. Manual Enter/Escape tested. Its generic registry Tab-at-end landed on body and proves no focus outline; **use the actual QC Tab assertion instead**: `owner-final-runtime-browser.json` proves slot2→3 focused with a2px solid ring. `final-ui-source-parity.json` confirms src tree identical between reviewed362ef8c and final56175de; final-source native PDF/live Browser proof is independent.
- `owner-final-seq-native.pdf`: true native Microsoft Excel export from saved Master,1A4, actual Blob Preview visible. `owner-final-seq-native-page1.png` visually inspected for full-sheet content/alignment/Thai glyphs/no clipping. Prior Task1/2/3 each2A4, QC/Pool/Seq native files retained. `artifact-sha256-final.json` inventories19 representative XLSX/CSV/PDF outputs; no secrets inventoried.
- `owner-final-restart.log`: ready=true, counts59|4|3|3 unchanged. `owner-restart-persistence.json`: exact hashes of19 key record groups and16 stored artifacts unchanged. `owner-after-restart-browser.json`: fresh Lab/Certifier logins, saved QC30/actual Pool44/Seq values, same two download hashes, current Manual review, certified S2 result all retained.
- `owner-final-health.log`: ready=true, worker FRESH, renderer200, native Excel bridgeIDLE, Master SHA matches4c5300f9..., all6 role auth/secure cookie/RBAC checksPASS. HTTPS19548/PostgreSQL19549 loopback only; no other published service ports. At this intermediate milestone Full Suite had not yet finished. It is superseded by the final closeout below (2364 PASS/0 FAIL/62 SKIP).

### Tested Local UAT procedures

Run in PowerShell7 from `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION`:

```powershell
& .\tools\operational\Home-UAT.ps1 -Action Start -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Health -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Restart -SourceSnapshot '.local/lab-uat-source'
& .\tools\operational\Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/lab-uat-source'
```

Actual login URL: **https://127.0.0.1:19548/login**. Requires Docker Desktop/PowerShell7/native Microsoft Excel already verified on this Development PC. Start/Health/Restart executed successfully. Stop uses the reviewed scoped Compose stop/native bridge stop, retaining volumes; no down-v/reset. Login credentials file **path only**: `.local/owner-local-uat-1.0.2/credentials.txt` (ACL-protected). Owner workflow accounts: `uat.lab` (Lab Staff), `uat.certifier` (Lab Certifier); separate Admin/ClinicalApprover/Auditor/ANC accounts remain available per file. Never publish passwords or reuse them outside this local UAT.

Representative retained records: main Batchfa73517e-3eb5-44ce-810a-54e7b4987385; urgent Batcha205fbdd-092b-4430-9e44-3ddb1a95fecb; S2 Batchaf1cf2c5-bce6-4462-85d7-4bd524047c4a; slot13 Batch9aaf4e3b-bb0e-49d7-9fb1-78c53ab03d26; Manual CSV+ZIP Batch51aee842-ab09-4335-8e29-53c25103b702. Synthetic completed results LN9903001002 (Singleton),9903001001 (Twins),9903001045 (S2). All are test data; initial6 UAT cases are retained.

### Remaining boundary decisions / acceptance

- **BLOCKED only for real P5H Historical Case Promotion:** actual go-live cutoff has not been decided. Manual intake/identity/review is implemented and tested independently. No test cutoff is installed in Persistent Owner UAT/Production.
- Physical printer/scanner, real HALOS/BGI device import, Hospital LAN/UNC/HIS ACK and clinical/staff acceptance are NOT RUN. Local files and hisConfirmed=false do not assert hospital/clinical acceptance. Manual001 test demonstrates support, not import of missing real patient Final PDFs.
- `OWNER-UAT = PENDING`. Wait for Owner hands-on acceptance; no Upgrade EXE/push/merge/deploy/hospital-server work is authorised.

## Final closeout accepted for Owner Local Test — 2026-10-22

**READY FOR OWNER TEST. OWNER-UAT=PENDING.** All58 in-scope implementation/Local UAT checklist items are now PASS with the per-ID evidence above. The Owner's personal acceptance and the later EXE phase are not completed or started.

- Revision parity: root HEAD, clean detached runtime source, baked web/worker/renderer and retained Full Regression all identify **56175ded59b9624768d2f157c520b0505dd67404**. Migration inventory43f663d9... matches. Updated documents are retained locally without a document-only commit so the validated Source/Runtime/Test revision remains56175de. Unrelated user changes are not staged or committed.
- Retained complete command `npm.cmd test` at `.local/lab-uat-source`: **176 files PASS,20 files wholly SKIP;2364 tests PASS,0 FAIL,62 SKIP;693.50s;exit0**. No Full Regression rerun in closeout. Typecheck/lint/source guard and Docker `npm run build` results remain valid on unchanged source. Native PostgreSQL3 suites PASS separately in a new isolated synthetic DB.
- All62 SKIPs reconciled by definition collection only (2426 collected,62 skip; tests/hooks not executed). **They remain SKIP, not PASS**. Detailed source names, conditions, remaining risk and separate proof: `docs/lab-codex-skips-2026-10-22.md`; machine-readable `full-regression-skip-ledger.json`/`full-regression-skip-groups.json`. Native DB opt-in50, P7 native1, legacy/ZIP fixtures6, Native Excel1, DCC/installer3, explicit Master env1. Native3-suite result does not change the Full Suite's62 count.
- Latest `.local/lab-owner-evidence/owner-closeout-health.log`: ready=true; workerFRESH, renderer200, Excel bridgeIDLE; six roles authenticate with secure cookies/RBAC; read-only exact Master present; HTTPS19548/PostgreSQL19549 loopback only. Local UAT stays running for Owner.
- Existing operational/Manual/S2/urgent/D13/dual-export/notice/duplicate/PDF/result/restart evidence is retained. Restart hashes19 record groups/16 stored artifacts,59cases/4batches/3releases/3transfers match; fresh Lab/Certifier Browser logins and original downloads pass.
- Owner login URL and Start/Stop/Health commands are listed above and at the top of the updated Handoff. Credentials remain at the protected local path only. Owner test cases include Run001 QC48+9/Pool exclusions/Seq/PDF/two downloads; urgent40/D13 physical mapping; S2 same base/new PET times; Manual original-PDF independent review; Singleton/Twin/S2 results and persistence.
- **Separate BLOCKED:** real-go-live-dependent P5H Historical Case Promotion, until an actual go-live date is decided. Manual intake/identity/review is implemented and does not require that cutoff. Physical printing/scanning, real device/Hospital/HIS ACK and clinical acceptance remain NOT RUN. No push/merge/deploy/hospital server/EXE work.

Stop implementation here and wait for the Owner to test and confirm. Do not automatically start installer/upgrade work.
