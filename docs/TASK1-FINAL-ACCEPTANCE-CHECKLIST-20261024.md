# NIPT-CBH Task 1 — Final Acceptance Checklist (2026-10-24)

## Verdict: NOT READY

The existing Local UAT is running and available at **https://127.0.0.1:19548**. Health returned HTTP 200 and the Local UAT Health check authenticated all six configured roles, including `LAB_STAFF`. The acceptance gate is **not complete**: launcher source parity failed after only the web service was rebuilt, the batch count discrepancy remains unattributed, and legacy-state browser assertions remain unverified.

This report distinguishes the user-authorized requirements from the two prior implementation HOLDs resolved by the Owner on 2026-10-24. No new clinical or operational rules were inferred. The earlier subsystem report's “READY FOR OWNER TEST” language is superseded by this stricter acceptance verdict.

## Runtime and data evidence

- Browser URL: `https://127.0.0.1:19548/lab/batches/9ccd4f07-4dbe-404d-9859-084c33f9f2cd?task=1` (Run007/2026, Task List 1, Draft). Chrome was reloaded against this URL during final verification and remains on it. Authenticated identity displayed by the application: `LAB_STAFF`.
- Live health request: `curl.exe -sk https://127.0.0.1:19548/api/health` returned `{"status":"ok","mode":"operational"}`, HTTP 200.
- Current Docker project: `nipt-cbh-owner-local-102-20261020`. Only `web` was rebuilt/recreated from current working-tree source; image ID `sha256:3733ff0bd54ed8f61947987e9d3276eea40e82b8bc6a9b44e3cd0713a34131bf`, embedded revision `1a4055ac8136f10684e8a818e458b4341b22a439`, migration inventory `09329330033d40a996e552bcbbb6408d4f3104056bc71f9347e0f1c127e73c62`. DB and renderer healthy; worker and proxy running, but worker/renderer remain on prior images. Post-rebuild Home-UAT Health reports `servicesReady=false`, `ready=false`, parity failures `SNAPSHOT_DIRTY`, worker/renderer source and migration mismatch, `APPLIED_MIGRATION_LEDGER_MISMATCH`, and `FEATURE_MISSING:qc_pooling_seq`. No additional migration was run. The launcher clean-Git gate is not passed.
- Current read-only PostgreSQL query returned `nipt_case=64`, `lab_batch=7`, `result_release=3`. The retained post-migration runtime snapshot `.local/task1-owner-resolution-20261024/local-uat/runtime-proof.json` records `64|6|3` at 2026-10-23T20:28:42Z. Run007 is visible in the current browser and was created later than that snapshot; available evidence does not identify who created it. No batch was created, edited or deleted by the final verification actions. The seven-versus-six mismatch is therefore **unattributed**, not explained away.
- The pre-migration backup remains at `.local/task1-owner-resolution-20261024/local-uat/nipt_operational_integrated_owner_uat-before-123-125.dump`, 6,317,739 bytes. Recorded SHA-256: `ad81d11186b100b0e51f7f90763489bc60d4c17184303fa77ff05f428030ae74`; prior `pg_restore -l` verification passed, and the current file SHA-256 still matches. Read-only ledger verification returned exactly `123_task1_attempt_identity_s3.sql`, `124_task1_early_resampling.sql`, and `125_task1_external_no_call.sql`; migration 126 is absent. This closeout applied no migration. No production migration was run.
- The strict Home-UAT launcher was not run because it requires clean Git. The existing Compose project safely rebuilt/recreated only its web container. This does not constitute a complete runtime rebuild or Launcher clean-Git PASS.
- Live AX/DOM observation on Run007 showed Task List 1–3 tabs; Manual Add, Urgent Fill and Repeat / Re-Sampling Fill; exact slot choices 2–16 with PC at slot 1; QC Measurements, Pooling/QC2, DNB/Sequencing and workbook links; and no legacy F2/F3/document issue controls. The tab remains on this page for Owner testing. Screenshot artifact from the prior verified export/browser run: `.local/task1-owner-resolution-20261024/exports/task1-owner-resolution.png`; current final CUA screenshot was inspected in-session but was not saved as a separate file.

## Checklist T1-01–T1-56

`PASS` means direct evidence exists for the stated behavior. `NOT VERIFIED` means it cannot count as accepted under the user’s gate. Any such row makes the verdict NOT READY.

| ID | Status | Evidence / remaining verification |
|---|---|---|
| T1-01 | PASS | Live Run007 Task List page shows Task List 1–3 and positions 1–16; earlier authenticated LAB scenarios are retained in `docs/task1-owner-validation-20261023.md`. |
| T1-02 | PASS | Native Task workbook/PDF readback and unchanged six-sheet/149-formula Master evidence in `.local/task1-owner-resolution-20261024/exports/manifest.json` and `pdf-readback.json`; control/slot semantics covered by affected Task tests. |
| T1-03 | PASS | Authenticated browser test moved an Urgent case into slot 40, verified the displaced Ready attempt and generated/read back Task PDF; `.local/task1-browser-lF0lKh/playwright.log`, `task1-urgent-slot40.pdf`, and displacement JSON. |
| T1-04 | PASS | Authenticated browser regression exercised Manual exact-slot UI and current backend; `.local/task1-browser-lF0lKh/playwright.log` (10/10). |
| T1-05 | PASS | Authenticated browser regression exercised Urgent Fill; responsive task UI also measured at four viewports; `.local/task1-browser-lF0lKh/playwright.log`. |
| T1-06 | PASS | Browser regression verified slot-40 replacement and returned displaced sample/lineage before readable Task PDF; `.local/task1-browser-lF0lKh/playwright.log` and `task1-urgent-displacement.json`. |
| T1-07 | PASS | Analytical ID rules covered by `tests/unit/task1-identifiers.test.ts`, `tests/db/task1-lineage.test.ts` and PET/label contracts; relevant suites pass as recorded in owner validation. |
| T1-08 | PASS | FIFO/urgent/repeat assignment gate behavior covered by existing Task/assignment tests and server-side worklist eligibility; no live patient was assigned during final smoke. |
| T1-09 | PASS | Authenticated browser test paginated 55 synthetic Ready attempts and searched/selected from the next page; `.local/task1-browser-lF0lKh/playwright.log` and `task1-pagination-55.json`. |
| T1-10 | PASS | Placement/finalization and post-lock metadata behavior covered by DB tests and prior native persistence/PDF evidence; Run007 is intentionally still Draft. |
| T1-11 | PASS | Task-scoped evidence and metadata cases are covered by `tests/db/task1-placement-metadata.test.ts` and native workbook metadata tests; no cross-Task evidence was written to UAT. |
| T1-12 | PASS | Reloaded live Operational Task page contains no F2/F3 or legacy document issuance controls. Earlier post-build Run005 inspection is recorded in owner validation. |
| T1-13 | PASS | Authenticated Operational browser on isolated DB/file-store clone exercised Tasks 1–3 across PlacementFinalized, PreWorkIssued, InExecution, ExecutionRecorded, ExecutionVerified and CompletedIssued (18 views). Backend returned operational=true; PDF controls present and legacy controls absent. `.local/task1-closeout-remaining/legacy-browser.json`. |
| T1-14 | PASS | Prior full regression P0-5 finalized all three Tasks through real APIs, downloaded/read back native PDFs and navigated to QC Measurements. New authenticated Operational clone regression confirms PDF controls and QC/Pooling/Sequencing navigation for legacy states. |
| T1-15 | PASS | Live page provides links to QC Measurements, Pooling/QC2 and Sequencing; route destinations are present in AX tree. |
| T1-16 | PASS | Exactly the allowed six post-lock metadata fields are covered by native DB/XLSX/PDF metadata evidence retained in `.local/task1-owner-20261023/exports/` and owner validation. |
| T1-17 | PASS | Immutable placement/snapshot/history regression is covered by native database tests; the current UAT was only queried and viewed. |
| T1-18 | PASS | Metadata PDF/XLSX readback and stale-version/source binding evidence are recorded in prior owner validation artifacts. |
| T1-19 | PASS | S1 `-1` / shared repeat `-2` identifier contracts pass in `tests/unit/task1-identifiers.test.ts` and affected DB/export tests. |
| T1-20 | PASS | Owner-locked early re-sampling behavior and S3 PET progression are exercised in `tests/db/task1-lineage.test.ts`, `tests/contracts/resampling-pet.test.ts` and native P3 contracts. |
| T1-21 | PASS | Early resampling repeat suffix `R-2` before global attempt 5 and no invented suffixes are included in lineage/identifier tests and native Task output readback. |
| T1-22 | PASS | Global LAB5+ red `R-1`, distinct attempt/specimen identities and ordinals are covered by lineage tests and actual Task PDF/XLSX output inspection. |
| T1-23 | PASS | Twin `D`/`R` ordering and unchanged HIS LN are covered by `tests/contracts/resampling-pet-labels.test.ts` and label/PET evidence. |
| T1-24 | PASS | Genuine PET identity, receipt provenance and idempotency guards are covered by native P3/repeat contracts and wrong-HN rejection tests. |
| T1-25 | PASS | QC1–QC4 and Sequencing failure/repeat paths and permission checks are covered by `tests/db/task1-failure-no-call.test.ts`, PET/failure regression (19 PASS) and permission suite (843 PASS). |
| T1-26 | PASS | Authenticated browser test read all 48 identity/control positions, saved synthetic measurements, and verified persisted readback; `.local/task1-browser-lF0lKh/playwright.log` and `task1-qc-48-readback.json`. This used isolated synthetic DB, not the persistent Local UAT. |
| T1-27 | PASS | Existing Owner-approved QC rules, normal result gates and negative fabricated-PASS assertions remain covered by the focused DB/unit/contract regressions; no threshold was changed. |
| T1-28 | PASS | Approved pooling formula and under-2µL highlighting are covered by pooling tests and actual native XLSX readback; no UAT pooling values were changed. |
| T1-29 | PASS | Browser4 responsive measurements reported at 1440/1280/768/375px with aligned desktop input tops/heights and no mobile overflow; evidence is summarized in owner validation. |
| T1-30 | PASS | Pool CSV field/position semantics including `F=0` are covered by `tests/db/p4b-pooling.test.ts` and export contract regression. |
| T1-31 | PASS | Authenticated Task-G50 UI saved revision 3, calculated Pooling, edited QC2, recorded actual pooling, downloaded both XLSX files, and verified ZIP structure, expected patient/sample IDs, revision and SHA-256. Files: `.local/task1-browser-lF0lKh/p4-pdf-evidence/task1-nifty-revision-3.xlsx` (SHA `73cccb47863a6bab5ad50cbb488b02177796ddfefa405d8ea14715ae865cff2d`) and `task1-halos-revision-3.xlsx` (SHA `01dfc132adfd5e58606e4c4f8792b52c9fc2fa9718fd19ae4520ab2d5b443b4d`); manifest `task1-seq-task-g50-pair.json`. |
| T1-32 | PASS | Readback verifies six sheets, 149 formulas and unchanged Master SHA-256 `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1`. |
| T1-33 | PASS | Actual native PDF readback reports pages 2/2/2/1/1/1 and workbook readback; artifacts under `.local/task1-owner-resolution-20261024/exports/`. |
| T1-34 | PASS | Exceptional red IDs were inspected in Task UI/XLSX/PDF; vendor master hashes and schemas remain unchanged. CSV/plain text cannot carry font color and remains a format limitation. |
| T1-35 | PASS | Synthetic label outputs preserve 4 stickers/8 halves, 50×20mm, LN and D-before-R semantics in prior label evidence; physical printer acceptance remains external and unverified. |
| T1-36 | PASS | NIFTY output transformation and original master hash `07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc` are documented in export evidence. |
| T1-37 | PASS | HALOS Task Import readback and unchanged original master hash `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec` are documented. |
| T1-38 | PASS | Correlation/duplicate-display-ID and immutable attempt lineage negative tests pass in `tests/unit/task1-result-correlation.test.ts` and lineage/No Call DB contracts. |
| T1-39 | PASS | Attempt-4 “await consideration” state and no automatic No Call choice covered by failed-stage/result-gate tests. |
| T1-40 | PASS | LAB_STAFF No Call selection without certification privilege covered by No Call Browser/native permission tests; permission suite reports 843 PASS. |
| T1-41 | PASS | No Call pending state creates no clinical result/release/HIS job or fabricated QC PASS in `tests/db/task1-failure-no-call.test.ts` and native No Call contract. |
| T1-42 | PASS | Same-structure synthetic external PDF with explicit `Result = No Call` was parsed, rendered and exact-byte checked; `.local/task1-owner-resolution-20261024/synthetic-external-no-call.pdf` and parser tests. This is not a hospital-supplied PDF. |
| T1-43 | PASS | Native `app_rw`/`worker_rw` test exercised existing review/release/RES/PDF/OK workflow with No Call and preserved failed attempt state; see `native-no-call-evidence.json`. |
| T1-44 | PASS | Wrong identity, ambiguous/duplicate result, stale attempt, missing consent/review, hold and unauthorized release negative assertions pass in DB/native result regressions. |
| T1-45 | PASS | After the current source/test changes, `npm.cmd run typecheck` passed and `npx.cmd eslint src/components/p4/lab-bench.tsx tests/e2e/p4-task-list.spec.ts` passed (exit 0). |
| T1-46 | PASS | Affected focused tests pass: Unit/Contract 563; No Call native 5 contracts; DB PET/failure/upgrade 19; placement/p4-lab 25; Permissions 843. Full-suite historical snapshot DB 415+8 skipped, Contracts 704+51 skipped, Unit 452+4 skipped is retained but was not rerun on the final diff. |
| T1-47 | PASS | Affected normal-result/HIS regressions pass: result regression 556; existing QC release 538; P5 PDF/auth upload 1 PASS; PET/label regressions included above. Logs in `.local/task1-owner-resolution-20261024/`. |
| T1-48 | PASS — synthetic technical scope | Full authenticated browser regression against isolated PostgreSQL passed 10/10, covering Task metadata/reload, PDF, pagination, Urgent replacement, QC/48 positions, Pooling/QC2, Task-G50 dual XLSX, responsive fill UI, FIFO override and draft-fill/PDF. T1 component UI regression passed 4/4 plus five native contracts. These are local synthetic technical checks, not hospital/clinical acceptance. |
| T1-49 | PASS | Operational authenticated legacy matrix asserts no F2/F3, Issued Original, pre-work issuance or legacy execution controls in 18 Task/state views. `.local/task1-closeout-remaining/legacy-browser.json`. |
| T1-50 | PASS — synthetic browser | Current Task List UI was measured at 1440/1280/768/375: Manual/Urgent/Repeat controls stay within the viewport and the lightning icon/title remain aligned. Evidence: `.local/task1-browser-lF0lKh/p4-pdf-evidence/task1-responsive.json` and `playwright.log`. Persistent Local UAT web was rebuilt after the QC2 fix; full runtime parity remains NOT VERIFIED under T1-54. |
| T1-51 | PASS | Actual Excel/PDF files were generated by Microsoft Excel/read back and verified, including formula count, six sheet outputs, PDF page counts, and vendor master hashes; exact file and hash manifest is `exports/manifest.json` plus `pdf-readback.json`. |
| T1-52 | PASS | Restarted existing DB/web/worker/renderer/proxy without volume recreation. Ordered row-content hashes match before/after for cases, batches, sheets, specimens, attempts, releases, ledger and batch events. `.local/task1-closeout-remaining/persistence-{before,after}.txt`. |
| T1-53 | PASS | Run007 ID 9ccd4f07-4dbe-404d-9859-084c33f9f2cd was created by uat.lab at 2026-10-23T20:41:24.943929Z, after snapshot20:28:42Z. BATCH_CREATED event72 and LAB_BATCH_CREATED audit35736 agree; cancellation event73/audit36313 record cancellation21:12:05Z. New baseline64/7/3 accepted. `.local/task1-run007-audit-20261024.jsonl`. |
| T1-54 | BLOCKED — full gate | All services healthy, six-role real login/secure-cookie/RBAC smoke PASS; Excel bridge IDLE; functional QC/Pooling/Sequencing browser PASS. All three images rebuilt together. Full launcher still rejects dirty Git and requires forbidden Task2 migration126. Latest source/image comparisons are in runtime-fingerprints.json; source drift is reported without hiding it. |
| T1-55 | PASS | Current editable Run007 Task List 1 is live and rendered. Run005 was inspected after the rebuild in the retained browser evidence; the current page shows Manual, Urgent and Repeat areas and no F2/F3 UI. |
| T1-56 | PASS | Branch/HEAD preserved; no reset/revert/discard/commit/push/merge/deploy/Production migration/EXE. Current Git status is included below. |

## Defect closure D01–D06

| Defect | Status | Evidence / limitation |
|---|---|---|
| D01 Legacy F2/F3 UI | PASS on current editable Run007 | Live Operational DOM has no listed legacy document/F2/F3 controls. Dedicated multiple-legacy-state regression remains T1-13/T1-49 NOT VERIFIED. |
| D02 Urgent Fill lightning alignment | PASS — synthetic browser | Exact Task List source was rendered/authenticated and measured across 1440/1280/768/375; icon alignment and overflow assertions pass. Persistent Local UAT web uses the latest source; whole-runtime parity remains NOT VERIFIED (T1-54). |
| D03 Urgent visibility and locked placement | PASS by source and prior Run005 browser inspection | Current implementation provides locked-task guidance and does not unlock placements. A fresh saved screenshot of locked Run005 was not captured in the final session. |
| D04 Repeat/Re-Sampling filtering and pagination | PASS — synthetic browser | T1-09 exercised 55 eligible Ready attempts, next-page search and selection in the authenticated browser; the persistent Local UAT and real HIS inputs were not used. |
| D05 Target-Task replacement | PASS | `tests/db/task1-placement-metadata.test.ts` verifies QC in a different Task does not block an eligible target while evidence at the target slot does; command pass recorded below. |
| D06 Source/runtime mismatch | PASS | Existing UAT web/worker were rebuilt; current provenance revision is `1a4055ac…`; working-tree fingerprint and runtime fingerprint are `568d1be8…`; live authenticated route and health respond. Launcher clean-Git gate remains not passed. |

## Test execution actually evidenced

Evidence timestamps are local 2026-10-24 unless the file records UTC. Passing suites are not repeated just to refresh counts. The full suite figures below are retained prior snapshot evidence and are **not** represented as rerun against the final diff.

| Command or verification | Result |
|---|---|
| `npm.cmd run typecheck` | PASS after the T1-31 fix and fixture changes; run exit code 0, route type generation and `tsc --noEmit` passed. |
| `npx.cmd eslint src/components/p4/lab-bench.tsx tests/e2e/p4-task-list.spec.ts` | PASS after the T1-31 fix and fixture changes; exit code 0. |
| `npm.cmd run test:permissions` | 843 passed, 0 skipped; `permissions-final.log`. |
| Focused Unit + Contract command in `task1-owner-validation-20261023.md` | 563 passed, 0 skipped; `unit-contract-final.log`. |
| `tests/db/task1-lineage.test.ts`, workflow correction, upgrade, failed No Call plus PET/label contracts | 19 passed, 0 skipped; `pet-failure-upgrade-final.log`. |
| `tests/db/task1-placement-metadata.test.ts tests/db/p4-lab.test.ts` | 25 passed, 0 failed, 3 skipped across two files; rerun after fixing the new test fixture to use the current Master revision. |
| Task List browser regression `node --import tsx tools/task1-browser.ts tests/e2e/p4-task-list.spec.ts` | 10 passed, 0 failed; `.local/task1-browser-lF0lKh/playwright.log`; authenticated UI and isolated synthetic PostgreSQL. RC1 and P0-2 pass in the full run. |
| T1 component browser + native contracts `node --import tsx tools/task1-browser.ts tests/e2e/task1-ui.spec.ts` with native contracts enabled | 4 browser tests passed; 5 native contract files/tests passed, 0 skipped; `.local/task1-browser-LSJXBK/playwright.log` and `native-contracts.log`. |
| Native result/normal workflow regressions | 556 passed and 538 passed in separate overlapping commands; `results-regression.log`, `affected-results.log`. |
| `node --import tsx tools/task1-browser.ts tests/e2e/p5-case-upload.spec.ts` | 1 passed; `p5-upload-final.log`; identity rejection and exact PDF-byte readback. |
| `node --import tsx tools/operational/task1-export-evidence.ts` | PASS; actual XLSX/PDF output and readback. Artifacts: `.local/task1-owner-resolution-20261024/exports/`. |
| RC1 metadata isolation + Task List regression | 10 passed, 0 failed, including RC1 1/1; `.local/task1-browser-lF0lKh/playwright.log`. RC1 showed no product leak; waits were adjusted for cold-route timing. |
| Local UAT runtime | Partial: HTTP 200 `{"status":"ok","mode":"operational"}`; Home-UAT authenticated all six configured roles. Full source parity fails as detailed above; only web was rebuilt. Read-only batch count discrepancy remains. |
| Full prior suites | DB 415 passed / 8 skipped; Contracts 704 passed / 51 skipped; Unit 452 passed / 4 skipped; Permissions 843 passed. Logs `.local/task1-owner-20261023/`; historical baseline only. |
| `git diff --check` | PASS; `diff-check.log`; line-ending warnings only. |

No test result above implies physical print, vendor instrument, live HIS delivery/acknowledgment, hospital PDF acceptance or clinical acceptance.

## Real output and source files

Native artifacts and integrity details are retained in `.local/task1-owner-resolution-20261024/exports/`: `task1-generated.xlsx`, Task PDFs 1–6, NIFTY/HALOS derivatives, `manifest.json`, `pdf-readback.json`. Master SHA-256: `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1`; NIFTY master `07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc`; HALOS master `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec`. The synthetic No Call PDF/RES and native temporary transport evidence are under the same evidence root; none is a hospital-supplied result.

The 81 previously changed source, migration, test and evidence-index files are enumerated with per-file rationale in [the change review](task1-change-review-20261024.md); these remain preserved, unstaged, and uncommitted. This final acceptance report adds one untracked file. The prior validation report was updated to explicitly defer to this stricter verdict. No unrelated source edits were made during final closeout.

## Remaining blockers and external acceptance

1. **CLOSED T1-53:** matching Run007 creation event/audit after snapshot establishes normal application activity by uat.lab; new baseline64/7/3. No deletion/repair.
2. **BLOCKED T1-54 full gate:** existing gate requires clean Git and applies an all-source migration count check including Task2 migration126. Neither prohibited commit/discard nor apply126 was performed. See latest per-service source fingerprints, full Health result and runtime browser proof in `.local/task1-closeout-remaining/`.
3. **CLOSED T1-13/T1-14/T1-49:** authenticated Operational legacy matrix18/18 PASS on isolated clone; finalized native PDF/readback→QC prior full regression retained.
4. **External acceptance (separate; NOT VERIFIED):** hospital vendor No Call PDF sample; real HIS PET/RES/PDF/OK acknowledgment; physical HALOS/NIFTY import; physical label size/barcode/alignment; Owner hands-on acceptance. These are not local synthetic evidence and do not establish Production readiness.

## Git and safety status

- Branch `fix/consolidated-parity-101`; HEAD `1a4055ac8136f10684e8a818e458b4341b22a439`.
- Current `git status --short`: 62 modified tracked files and 32 untracked files (94 total), all preserved; this includes pre-existing Task 2/sample-storage work in the dirty tree. The closeout changed only the Task 1 lab UI, its Task List test fixture, and Task 1 evidence reports. No reset, revert, discard or commit.
- No push, merge, deploy, Production access/migration, or Update EXE. No Local UAT migration was applied in this closeout; read-only ledger query confirmed 123–125 present and 126 absent.
- Preserve the exact Local UAT database and backup while investigating the count discrepancy. The app is currently available for Owner review at `https://127.0.0.1:19548`, but this does **not** change the final verdict: **NOT READY** under the mandatory all-local-checks acceptance gate.

## Remaining-blockers closeout — 2026-10-24

This section supersedes earlier runtime observations and unattributed-count statements. No product source was changed. RC1 1/1, full Task List Browser Regression10/10, T1-31 native dual-XLSX/readback/hash, QC2 fix, typecheck and eslint remain valid.

Worker/renderer were rebuilt/recreated through the existing Compose project using the repository project-directory and --no-deps; migrate/seed were not run. Because documentation is included in source fingerprints, all three images are rebuilt together after these final reports; final image IDs and inventory comparisons are retained under `.local/task1-closeout-remaining/`.

FEATURE_MISSING:qc_pooling_seq was a source-hash mismatch in old images. A fresh authenticated Owner UAT browser loaded QC, calculated/loaded Pooling with actual-transfer checkboxes and opened Sequencing (`runtime-browser.json`). Prior T1-31 supplies save/export/native readback evidence. No feature flag or Health text was changed.

The unchanged launcher rejects uncommitted work (SNAPSHOT_DIRTY/UNCOMMITTED) and requires every source migration in the applied ledger. Task2 migration126 is present in source and deliberately absent from the DB. Committing/discarding existing work or applying126 is prohibited. Thus its full gate remains BLOCKED even after image content parity is restored. No gate was disabled, weakened or bypassed.

Legacy checks used a separately named database nipt_task1_legacy_uat, copied file store and loopback test proxy19558. Existing state guards remained enabled across six schema-supported states. No Owner UAT Batch state was altered. Temporary clone containers are stopped after testing and their evidence retained.

Run007 creation follows the normal application path, attributed to account uat.lab with matching BATCH_CREATED event72 and LAB_BATCH_CREATED audit35736 at20:41:24.943929Z, 12m42.944s after the old snapshot. Later cancellation is independently recorded. The person using that account is not inferred. Baseline is64 cases/7 batches/3 releases.

Core table ordered content hashes before and after restart are retained in persistence-before.txt and persistence-after.txt. Migrations123–125 remain applied,126 remains absent; no migration was executed. Original DB volumes and data remain intact. No Task2/Task1.5, asset or dependency edit was made.

Final observed restart checks: servicesReady=true, webHealth=ok|operational, workerHeartbeat=FRESH, rendererHealth=200, Excel bridge=IDLE. Six configured accounts authenticated with secure cookie/RBAC checks. Eight core-table content hashes matched. Applied ledger checksums all match approved inventory; the sole absent source migration is126, intentionally prohibited here.

During the first all-service build, the Task2 test file `tools/sample-storage-e2e/e2e.ts` changed outside this closeout. All three images matched each other but differed from the host only at that Task2 test file. It was not edited or reverted. A final rebuild captures the current source; if concurrent source drift persists, runtime-fingerprints.json records exact differences rather than passing the gate. No Task1 product function was changed, so prior RC1/T1-31/full regression remains valid. The full launcher gate is NOT READY for the explicit conflicting clean-Git/all-migrations conditions described above.
