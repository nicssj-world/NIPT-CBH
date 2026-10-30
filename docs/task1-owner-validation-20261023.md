# NIPT-CBH Task1 — Owner validation, updated 2026-10-24

**Historical subsystem verification only.** The former HOLD items are resolved by the explicit Owner decisions, but the mandatory T1-01–T1-56 acceptance gate has a separate current verdict of **NOT READY**. See [the final acceptance checklist](TASK1-FINAL-ACCEPTANCE-CHECKLIST-20261024.md); it records the remaining locally testable gaps and the observed Local UAT batch-count discrepancy. This report does not assert Production/Hospital/clinical acceptance.

Work continued in the existing dirty working tree, branch `fix/consolidated-parity-101`, HEAD `1a4055ac8136f10684e8a818e458b4341b22a439`. All prior valid work and evidence were preserved. No commit, push, merge, deploy, Production/UAT migration, production container restart or Update EXE was performed. Test migrations and transport writes used disposable synthetic databases and local temporary directories only.

## Authoritative requirements and resolved paths

The two original 2026-10-23 specification/prompt documents were read and compared with source/schema/permissions/tests. The Owner's 2026-10-24 message explicitly supersedes their prior S4 boundary, early-redraw ambiguity and absent No Call format contract. No other rule was expanded.

1. **Early/further Re-Sampling:** no two-attempt prerequisite or LAB4-before-S3 restriction, and no numerical redraw-round ceiling. Each new specimen retains the original base plus one persistent R and restarts at -1. Re-Library/Re-Extraction on a resampled specimen prints -2 before global LAB5, including repeated pre5 attempts after early redraw. Global LAB5 onward always prints R-1 red regardless of specimen round. Unique attempt UUIDs, specimen UUIDs, actual global ordinal, same HIS LN and genuine newer PET lineage remain. The original shared S1 repeat quota remains; the new decision removes Re-Sampling limits, not that original shared repeat rule.
2. **External No Call:** the same existing SINGLETON/TWIN PDF structure, with an explicit anchored `Result = No Call`. No new template, certifier privilege or operator workflow. Existing import/matching/review/certification/release/PDF+RES+OK delivery is reused. The existing QC5 review binds the exact failed current attempt's No Call selection, exact external PDF hash and current authorized review. Its attempt stays `QcFailed`; no successful analysis, FinalQcAccepted or QC PASS is invented. Actual external QC remains unchanged. Identity, consent, active round/attempt, duplicate/revision, hold, certification confirmation and approved LAB_CERTIFIER authority still apply.

The PDF generator changed only under `tools/his-simulator/` to create clearly labelled synthetic test fixtures. The application does not generate a clinical No Call PDF. Duplicate/conflicting Result anchors are an unreadable blocker even if the normal risk table is otherwise complete.

## Requirement evidence matrix

| In-scope requirement | Actual evidence / disposition |
|---|---|
| Manual/Urgent/Repeat exact-slot fill; FIFO; controls1/25; Blank40; locked placement | Prior passing DB/browser evidence retained; current Task1 draft UI regression passes. No placement behavior changed in the two-path resolution. |
| S1 -1 / shared repeat -2; persistent R; specimen suffix reset; LAB5+ red R-1 | Identifier/PET/lineage tests pass; real worker-role PET cycles through S6 retain one original base and distinct internal identities. Native Task output includes early S3 global3 R-1 black, S3 repeat global4 R-2 black, global5/6 R-1 red. |
| Genuine PET, new receipt, patient identity, idempotency, no manual operational receipt | Current PET/failure/upgrade suite19 PASS; native P3/repeat contracts PASS; prior wrong-HN and manual-S3 refusal assertions retained. |
| QC Measurements/Pooling/Sequencing and deliberate failed-stage handling | Current failure tests cover QC1/QC2/QC3/QC4/SEQUENCING. Normal operational results and paper-Master release regressions pass; no formula/threshold changes. |
| Select No Call waits, creates no result/release/HIS job | Current failed-stage/No Call tests PASS; LAB_STAFF can select, cannot certify. |
| Actual external No Call PDF → reviewed release → existing transport | PGlite6 PASS; native app_rw/worker_rw test PASS; exact external PDF bytes, No Call RES and OK written/read from disposable local folder; state remains QcFailed; hisConfirmed=false. |
| Wrong identity, absent selection/QC, normal PDF against failed intent, unauthorized user, hold | Negative DB/native tests PASS; post-release hold/consent revocation/newer attempt invalidate delivery eligibility. |
| Same existing UI confirmations, actual parsed Result/QC shown | Task1 Browser No Call component passes with real PDF extraction and explicit API fixture; no false successful-bench attestation. Actual backend release is proven separately above. |
| Post-lock six metadata fields, immutable placements/history | Prior native DB/PDF/XLSX metadata proof retained; no metadata implementation change in this resolution. |
| QC2 desktop alignment / helper below / mobile | Current Browser4 suite: actual component measurements1440/1280/768/375px, equal tops/heights on desktop, long Thai label, mobile no overflow. Synthetic API fixture is rendering evidence, not clinical execution. |
| Original masters, 149 formulas, PDF geometry, vendor transforms | Fresh actual Excel generation/readback: six sheets149 unchanged formulas; PDF pages2/2/2/1/1/1; NIFTY/HALOS original hashes unchanged; current derivative files inspected. |
| Restart/persistence and historic compatibility | Existing native stop/start app/worker/renderer and disk DB upgrade evidence retained; current upgrade regression passes with migrations through125. No claim that Hospital/Production or new No Call release was restart-tested. |

## Current executed checks

New evidence root: `.local/task1-owner-resolution-20261024/`. Counts below describe separate commands; overlapping suites are not added into an artificial total.

| Command / exact scope | Latest actual result and log |
|---|---|
| `npm.cmd run typecheck` | PASS `typecheck-final.log`; subsequent touched browser tests checked by `tsc --noEmit --pretty false` in `typecheck-browser-final.log` and final closeout log. |
| `npm.cmd run lint` | PASS `lint-final.log`; touched tests/tools also scoped ESLint PASS. |
| `npm.cmd run test:permissions` | **843 PASS**,2 files,0 skips; `permissions-final.log`. Rerun because No Call evidence-function grants were added; no result-certification grants. |
| `npm.cmd exec vitest run tests/unit/task1-no-call-parser.test.ts tests/unit/p5-parser.test.ts tests/unit/p5-gates.test.ts tests/unit/p7-result-query.test.ts tests/unit/task1-identifiers.test.ts tests/unit/task1-exceptional-highlight.test.ts tests/unit/task1-result-correlation.test.ts tests/contracts/p6-res.test.ts` | **563 PASS**,8 files,0 skips; `unit-contract-final.log`. Includes actual PDF extraction and pinned legacy RES byte goldens. |
| `npm.cmd exec vitest run tests/contracts/p6-res.test.ts tests/unit/p5-gates.test.ts tests/db/operational-results.test.ts tests/db/p5-case-upload.test.ts tests/db/p6-workflow.test.ts` | **556 PASS**,5 files,0 skips; `results-regression.log`. Normal clinical/identity/disclosure/release/HIS regressions. |
| `npm.cmd exec vitest run tests/contracts/p6-res.test.ts tests/unit/p5-gates.test.ts tests/db/lab-owner-qc-release.test.ts` | **538 PASS**,3 files,0 skips; `affected-results.log`. Existing paper-Master normal-result release remains guarded. |
| `npm.cmd exec vitest run tests/db/task1-external-no-call.test.ts tests/contracts/task1-no-call-native.test.ts` without native URL | **6 PASS /1 skipped**,1 passed file/1 skipped file; `no-call-db.log`. Native skip is independently closed by the next run, not counted as pass here. |
| Native runner: `NIPT_OPERATIONAL_TEST_PG_BIN=C:\Program Files\pgsql\bin`, `NIPT_TASK1_NATIVE_CONTRACTS=yes`; `node --import tsx tools/task1-browser.ts tests/e2e/task1-ui.spec.ts` | **5 native contracts PASS**,0 skips: lab-repeat-native/p4-native/p3-native/p5a-auto-link-native/task1-no-call-native. `.local/task1-browser-LDr02j/native-contracts.log`; manifest exit0. Real PostgreSQL roles used. |
| Same native runner's Task1 Browser suite | **4 PASS**,0 skips11.5s; `.local/task1-browser-LDr02j/playwright.log`. Real auth/API for draft; explicit fixtures for component/QC2/No Call action rendering. |
| `npm.cmd exec vitest run tests/db/task1-lineage.test.ts tests/db/workflow-correction.test.ts tests/db/task1-upgrade.test.ts tests/db/task1-failure-no-call.test.ts tests/contracts/resampling-pet.test.ts tests/contracts/resampling-pet-labels.test.ts` | **19 PASS**,6 files,0 skips; `pet-failure-upgrade-final.log`,30.98s. Rechecked after the forward migration bundle was complete. |
| Existing P5 folder workflow | **1 PASS**18.5s in `.local/task1-browser-OaES2N/playwright.log`; upload failed separately in that run and is not represented as a passing aggregate. |
| `node --import tsx tools/task1-browser.ts tests/e2e/p5-case-upload.spec.ts` | **1 PASS**15.8s; `.local/task1-browser-heaDgg/playwright.log`. Wrong-patient rejection, actual PDF canvas+authenticated exact-byte readback, duplicate, second person, no premature release and ANC denial all retained. |
| `NIPT_TASK1_EXPORT_EVIDENCE_DIR=.local/task1-owner-resolution-20261024/exports; node --import tsx tools/operational/task1-export-evidence.ts` | PASS actual Microsoft Excel XLSX/PDF generation; `native-export.log`, `exports/manifest.json`, `pdf-readback.json`. Local elevation only for renderer printer configuration; no physical print. |
| `git diff --check` | PASS; `diff-check.log` (Git line-ending notices only). |

Browser failure investigation: initial P5 run048kMI used obsolete iframe assertions and ambiguous inline-status/toast selector. Test-only assertions now open the existing PDF canvas dialog and select the exact saved status. In OaES2N Chromium trace captured an empty response body despite HTTP200/bodySize1396; readback now uses the same authenticated PDF URL, compares exact bytes, and still asserts the actual canvas and patient HN. The failed upload alone reran successfully in heaDgg. No product authentication, preview behavior, security, clinical assertion or HOLD was weakened. Failure logs/traces remain preserved. Parser conflict and gate regression tests were observed failing before their implementation fixes (`ambiguous-result-red.log`, `gates-red.log`).

## Retained broad-suite and earlier browser evidence

The last full suite logs remain `.local/task1-owner-20261023/`: DB **415 PASS /8 skipped**, Contracts **704 PASS /51 skipped**, Unit **452 PASS /4 skipped**, Permissions **843 PASS**. These are the prior full-suite snapshot, not a claim that all broad suites were rerun on today's changed source. Current affected tests and renewed permission/typecheck/lint evidence are listed above; unaffected passing suites were not repeated unnecessarily.

Twenty distinct earlier LAB browser scenarios passed across n1nuXn/T8XANw/l5GEht/fHUjLF, including real native Task PDF download/readback. Prior native restart proof is `.local/task1-browser-OCRwnJ/evidence/native-{before,after}-restart.json`. Prior post-lock metadata XLSX/PDF/source-hash proof remains `.local/task1-owner-20261023/exports/service-latest-metadata.{xlsx,pdf,json}`. Earlier report snapshots are retained under the new evidence root as `before-resolution-*.md`. Their former two HOLD findings are historical and explicitly superseded by this report.

## Real output and preservation

Fresh artifacts: `exports/task1-generated.xlsx`, `task-1.pdf`…`task-6.pdf`, `nifty-exceptional.xlsx`, `halos-exceptional.xlsx`, `manifest.json`, `pdf-readback.json`, `task1-owner-resolution.png`; current QC2 measurements/screens and No Call review screenshot under `browser-ui/`. The Task PDF was visually inspected with Thai layout and red/black IDs; synthetic external No Call PDF also rendered/inspected.

Native No Call: `native-no-call.{pdf,res}`, `native-no-call-evidence.json`; PGlite synthetic fixture: `synthetic-external-no-call.pdf`, `synthetic-no-call.res`, `no-call-release-evidence.json`. These are synthetic test evidence only. Native evidence verifies exact PDF byte preservation and temporary RES/PDF/OK output, not HIS receipt.

| Original file | Fresh SHA256, unchanged |
|---|---|
| six-sheet Master149 formulas | `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1` |
| NIFTY master | `07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc` |
| HALOS Task Import master | `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec` |

## Migrations, Git and remaining limitations

Forward-only candidates:123 immutable actual ordinal/nonunique display IDs/failure events/allowed metadata/S3;124 removes redraw ceiling with PET safeguards retained;125 adds exact No Call evidence to existing review/release/delivery. No old migration or historical rows/releases were rewritten. Applied only in disposable tests. A down-migration restoring globally unique printed IDs is unsafe after valid duplicate R-1; no automatic destructive rollback was created or executed.

At the time this subsystem report was written, no implementation blocker remained for the two resolved paths. The stricter final acceptance checklist now records locally testable requirements still needing explicit evidence and a Local UAT data-count discrepancy. External limitations remain: no actual hospital external PDF sample was supplied for hospital template/PIC acceptance; no live HIS/UNC/SMB/hospital acknowledgement, vendor HALOS/NIFTY machine import, physical label printer or Owner hands-on acceptance was executed. Test fixture PDFs exercise the Owner-confirmed same-structure contract. Vendor styles/columns remain preserved; exceptional red is proven on Task UI/XLSX/PDF, while strict vendor XLSX and plain-text/CSV color remain the previously reported format limitation. These do not establish Production readiness.

Git remains **56 modified tracked +25 untracked =81 files**, all unstaged, same branch/HEAD. Every file is mapped in [changed-file review](task1-change-review-20261024.md). Final Git status, tracked patch and per-file SHA manifest are in the new evidence root. All original evidence and valid work are preserved.
