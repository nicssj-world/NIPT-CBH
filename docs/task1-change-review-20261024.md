# Task1 changed-file scope review — Owner resolution 2026-10-24

Existing working tree preserved on `fix/consolidated-parity-101`, HEAD `1a4055ac8136f10684e8a818e458b4341b22a439`. No commit, reset, revert, push, merge, deployment, Production/UAT migration or EXE. Latest user decisions explicitly supersede the original documents only for early/further Re-Sampling and the existing-format external No Call contract.

The two former HOLD paths are implemented. This review maps every current changed/untracked file to Task1 or a necessary tested dependency. Production/Hospital, physical printer, vendor instrument and Owner hands-on acceptance remain separate.

| Changed file | Git | Approved scope / purpose |
|---|---|---|
| `packages/db/roles.sql` | ` M` | Necessary permission dependency: execute only the two guarded No Call evidence readers for existing app_rw; no certification grants. |
| `packages/inbound/process.ts` | ` M` | Requirement 5 + Owner decision 1: expected requested redraw PET at any round, same LN/HN/time protections. |
| `packages/lab/batch.ts` | ` M` | 3,4: exact draft placement, locked slots and six permitted metadata fields |
| `packages/lab/bench.ts` | ` M` | 2,5: bench patient lineage and sequencing export provenance |
| `packages/lab/core.ts` | ` M` | 2,5: case/round/attempt ordinal, approved identifiers and facts |
| `packages/lab/intake.ts` | ` M` | Requirements 2/5/6 + Owner decision 1: early/further redraw and resampled repeat numbering; no LAB4-before-S3/round cap; preserve shared S1 repeat quota and No Call waiting. |
| `packages/lab/rules.ts` | ` M` | Requirement 2 + Owner decision 1: single persistent R, specimen first -1/repeat -2 before global5, all global5+ R-1. |
| `packages/lab/seq-export.ts` | ` M` | 2,5: bench patient lineage and sequencing export provenance |
| `packages/lab/worklist.ts` | ` M` | Requirements 2/5/6: current lineage, exceptional styling and deliberate failure/No Call waiting states. |
| `packages/p6/released-result.ts` | ` M` | Necessary decision-2 delivery dependency: map explicit No Call outcome from the certified immutable external report into existing RES serializer. |
| `packages/p6/res.ts` | ` M` | Necessary decision-2 delivery dependency: No Call text in existing full/short RES value, retain fixed-profile policy, fields/encoding/OK and legacy byte goldens. |
| `packages/results/gates.ts` | ` M` | Owner decision 2: reviewed failed No Call disposition, preserving all identity/current round/hold/consent/reviewer/certifier predicates. |
| `packages/results/parser.ts` | ` M` | Owner decision 2: explicit Result = No Call in existing normal template; retain raw QC/findings and block ambiguous Result anchors. |
| `packages/results/service.ts` | ` M` | Requirements 6 + Owner decision 2: complete safe candidate search, same import/link/review/certify path, exact PDF/event binding; retain failed QC state. |
| `packages/security/policy.ts` | ` M` | 5,6: narrowly authorize LAB_STAFF redraw and No Call selection; no certification grant |
| `packages/sequencing/owner-export.ts` | ` M` | 2,5: per-template suffixes, repeats, duplicate guards and immutable lineage mapping |
| `packages/sequencing/owner-task-import.ts` | ` M` | 2,5: per-template suffixes, repeats, duplicate guards and immutable lineage mapping |
| `packages/workbook/master.ts` | ` M` | 2,4,8: derivative red font and metadata fitting/live binding; original Master untouched |
| `packages/workbook/service.ts` | ` M` | 2,4,8: derivative red font and metadata fitting/live binding; original Master untouched |
| `packages/workbook/text-fit.ts` | ` M` | 2,4,8: derivative red font and metadata fitting/live binding; original Master untouched |
| `src/app/(protected)/lab/page.tsx` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/app/api/p4/batches/[id]/route.ts` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/app/api/p4/worklist/route.ts` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p4/batch-workspace.css` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p4/batch-workspace.tsx` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p4/lab-bench.css` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p4/lab-bench.tsx` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p4/worklist.tsx` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/components/p5/result-review.tsx` | ` M` | Owner decision 2: display actual Result, same three existing confirmations, avoid false successful-bench attestation for No Call. |
| `src/components/p5/result-workspace.tsx` | ` M` | Owner decision 2: display parsed No Call instead of suggesting absent findings are normal. |
| `src/server/p4-data.ts` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `src/server/p4.ts` | ` M` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `tests/contracts/lab-owner-nifty.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/contracts/lab-owner-task-import.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/contracts/p6-res.test.ts` | ` M` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/contracts/resampling-pet-labels.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/contracts/resampling-pet.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/lab-owner-bench.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/lab-repeat-export.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/native-controlled-documents.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/p4-lab.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/p4b-pooling.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/workbook-metadata-source.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/workflow-correction.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/p4-lab.spec.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/p4-task-list.spec.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/p4b-pooling.spec.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/p4c-sequencing.spec.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/p5-case-upload.spec.ts` | ` M` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/e2e/p5-results.spec.ts` | ` M` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/helpers/pre-102.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/unit/p4-parity.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/unit/p5-gates.test.ts` | ` M` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/unit/specimen-display-code.test.ts` | ` M` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tools/his-simulator/result-pdf.ts` | ` M` | Requirement 8 + decision 2: synthetic-only existing normal-layout fixture with explicit No Call; never a production clinical PDF generator. |
| `tools/operational/verify-binding-fidelity.ts` | ` M` | 8: isolated local browser/restart/export/binding verification; no deployment/EXE action |
| `db/migrations/123_task1_attempt_identity_s3.sql` | `??` | 2,5,6: forward-only ordinal/display-ID/failure/PET guards; no old migration edit |
| `db/migrations/124_task1_early_resampling.sql` | `??` | Owner 2026-10-24 decision 1: remove fixed round ceiling while preserving current requested redraw, PET identity/time and original LN guards; forward-only. |
| `db/migrations/125_task1_external_no_call.sql` | `??` | Owner decision 2: immutable No Call event/PDF/review evidence in existing QC5 table and existing release/delivery guards, no successful QC or new role. |
| `docs/task1-change-review-20261024.md` | `??` | 9: per-file scope review and final Git/diff evidence index |
| `docs/task1-export-validation-20261023.md` | `??` | 9: validation and evidence report |
| `docs/task1-owner-validation-20261023.md` | `??` | 9: validation and evidence report |
| `packages/workbook/exceptional-highlights.ts` | `??` | 2,4,8: derivative red font and metadata fitting/live binding; original Master untouched |
| `src/components/p4/worklist.css` | `??` | 3,4,5,6: scoped Task/LAB UI/API and server permissions, QC2 local layout; no unrelated module edits |
| `tests/contracts/task1-no-call-native.test.ts` | `??` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/db/task1-external-no-call.test.ts` | `??` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/db/task1-failure-no-call.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/task1-lineage.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/task1-placement-metadata.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/task1-upgrade.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/db/task1-workbook-native-metadata.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/e2e/task1-ui.spec.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/helpers/browser-auth.ts` | `??` | 8: real CSRF/login session setup for scoped LAB tests, explicit synthetic/loopback target; application authentication unchanged |
| `tests/helpers/task1-no-call.ts` | `??` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/unit/task1-exceptional-highlight.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/unit/task1-identifiers.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tests/unit/task1-no-call-parser.test.ts` | `??` | Requirement 8 + Owner 2026-10-24: focused synthetic safety, parser/PDF, DB/native-role, permission or browser regression; preserve identity/integrity assertions. |
| `tests/unit/task1-result-correlation.test.ts` | `??` | 8: corresponding synthetic regression/contract/browser evidence; old expectations updated only for explicit Owner changes or precise status selectors |
| `tools/operational/task1-export-evidence.ts` | `??` | 8: isolated local browser/restart/export/binding verification; no deployment/EXE action |
| `tools/task1-browser.ts` | `??` | 8: isolated local browser/restart/export/binding verification; no deployment/EXE action |
| `tools/task1-native-persistence.ts` | `??` | 8: isolated local browser/restart/export/binding verification; no deployment/EXE action |

Total: **81 files**, 56 modified tracked, 25 untracked. All unstaged. No original Master/vendor binary or already-applied migration before123 is changed.

Forward migrations123/124/125 are local candidates, applied only to disposable test DBs. Migration125 retains the existing approved certifier role and adds no independent approval workflow. Clinical normal-result predicates remain; No Call carries exact externally reported failed outcome evidence without creating FinalQcAccepted. P6 dependency is confined to the result value and evidence eligibility in the unchanged existing transport.

Evidence and test outcomes: [validation report](task1-owner-validation-20261023.md). Full Git status, tracked patch and changed-file SHA manifest: `.local/task1-owner-resolution-20261024/{git-status-final.txt,tracked-working-tree.patch,changed-files-final.json}`. Previous report snapshots and all previous execution evidence are retained, including `.local/task1-owner-20261023/`; test updates are restricted to approved new rules, actual current PDF preview behavior, and precise inline status assertions.

## RC1 / T1-31 closeout (2026-10-24)

- RC1 Task List 1–3 Planned Metadata Isolation was **not a product bug** in the tested browser path: the authenticated regression saved/reloaded per-Task values and passed `1/1`; the full Task List Browser Regression passed `10/10`. The only RC1 test adjustment was increasing save-status waits to tolerate cold-route compilation timing. No assertion or isolation guard was weakened.
- T1-31 exposed a **product bug** in `src/components/p4/lab-bench.tsx`: the shared field-change handler always cleared calculated Pooling, even when editing QC2 fields that are not part of the pool calculation source. The handler now clears Pooling only for source QC fields (`slot.*.libraryQc` and QC1/QC3/QC4 inputs); QC2 edits preserve the current calculation. Existing upstream invalidation behavior remains.
- The first XLSX browser attempt's 409 was a **test fixture defect**, not a product rejection: the synthetic fixture lacked the required P2/PET request provenance. The fixture in `tests/e2e/p4-task-list.spec.ts` now creates synthetic identity and actual PET receipt evidence using the existing parser/identity protections. No validation was bypassed.
- Regression evidence: `.local/task1-browser-lF0lKh/playwright.log` reports 10 passed/0 failed, including RC1 and T1-31. T1-31 produced revision-3 NIFTY/HALOS XLSX files with ZIP/readback, identifiers, revision binding and SHA-256 checks. The latest scoped typecheck and eslint passed. The separate component/native-contract run reports 4 browser and 5 native contract passes.
- Local UAT: the existing isolated compose project rebuilt/recreated only `web`; health is HTTP 200 and Home-UAT authenticated all six configured accounts. Full parity is **not verified**: Home-UAT Health reports worker/renderer source and migration inventory mismatch, applied ledger mismatch and `FEATURE_MISSING:qc_pooling_seq`. No further migration was applied (in particular, Task 2 migration 126 was not run). The backup SHA still matches; the existing 64-case/7-batch/3-release count remains in conflict with the retained 64/6/3 snapshot and is unattributed. Do not resolve either gate by deleting or rewriting data.
- No Task 2 source, asset, dependency, or migration was changed during this closeout. No commit, push, merge, deployment, Production migration, or Update EXE was performed.

Current closeout Git inventory (2026-10-24): `git status --short` reports 62 modified tracked files and 32 untracked files (94 total). This is the complete pre-existing dirty working tree plus the explicitly described Task 1 QC2 invalidation/test-fixture correction and report updates. Pre-existing Task 2/sample-storage changes remain present and were not edited in this closeout; no asset or dependency was changed. All work remains unstaged/uncommitted.

## Remaining-blockers-only closeout (2026-10-24)

No product source changes. Existing RC1/T1-31/10-test regression/typecheck/eslint passes retained. Authenticated Operational legacy browser on an isolated database/file-store clone passed18 Task/state views (six existing states × three Tasks), removed legacy controls absent, PDF/QC path available. Evidence `.local/task1-closeout-remaining/legacy-browser.json`. Owner UAT read-only functional QC/Pooling/Sequencing smoke also passed.

Read-only Run007 attribution: uat.lab, creation20:41:24.943929Z after old snapshot20:28:42Z, event72/audit35736 matching; later cancellation event73/audit36313. Baseline64/7/3 accepted; no deletion or repair. Raw records `.local/task1-run007-audit-20261024.jsonl`.

Worker/renderer stale images rebuilt/recreated without migrate/seed/DB volume recreation. Final all-service image fingerprints and restart/content-hash persistence evidence retained under `.local/task1-closeout-remaining/`. Original native Excel bridge restarted with prior PID/stop evidence backed up and new log filenames.

Full launcher gate remains BLOCKED by its clean-Git requirement and requirement that source migration126 (Task2) be applied; both conflict with explicit Owner scope. Gate remains unchanged. Source/image content comparisons are reported separately; no claim of full gate PASS. No commit/push/deploy/EXE, no migration or Task2/Task1.5/asset/dependency change.

Post-restart: servicesReady=true; native bridge IDLE, worker fresh, renderer200, six accounts pass login/secure-cookie/RBAC. Eight ordered core-table row hashes match. Ledger checksums valid; only126 absent. First combined rebuild differed from host only at concurrently changed Task2 test `tools/sample-storage-e2e/e2e.ts`, which this closeout did not edit. Final all-service rebuild and exact comparisons are retained in `.local/task1-closeout-remaining/runtime-fingerprints.json`; full launcher gate remains unchanged/BLOCKED.

## Owner-authorized isolated Task1 candidate delivery

Latest instruction supersedes all earlier shared-tree NOT READY verdicts. Only this candidate branch permits local checkpoint commits. Candidate ownership/allowlist is documented in task1-candidate-ownership.md; no126, typed Storage/Task1.5, asset or package-version diff included. Shared tree/HEAD and Task2 runtime were not altered.

Actual candidate results: full source-parity delivery gate PASS with readyForOwnerTest=true; TaskList10/10 incl RC1/T1-31; component4/4; native PostgreSQL5/5; focused32/32 after supplying missing native Master fixture; permissions843/843; gate-unit2/2; typecheck/production build PASS. Operational browser generated and downloaded new NIFTY/HALOS and native Task/Seq PDFs with readback/hash. Candidate restart preserved10table content hashes and exact volume. Final docs-only checkpoint is rebuilt/re-gated and recorded in .local/evidence/gate-final.json plus final-acceptance.json. Owner testing URL19568 is independent of shared UAT19548.

Preserved initial aborted/failing environment attempts: missing Master paths, serialized CSRF setup, stale iframe test selector (actual component renders canvas), and stalled npm prune. Fixes were confined to candidate fixture configuration/test harness and deterministic worker build. Product rules, safety assertions and clinical gates were not relaxed. Full gate logic only gains project/database targeting; Task1 feature-manifest scope has no exclusions and requires real evidence for each feature. Source comparison still includes every candidate source file.
