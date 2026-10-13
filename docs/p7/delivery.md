# P7 technical delivery — 2026-10-13

**Status: PARTIAL.** Authorized safe implementation across P7-A–E is delivered locally; the unresolved HIGH development dependency and external acceptance gates below prevent an unconditional P7 Technical COMPLETE claim. No clinical acceptance, real-data validation, deployment or P8 authorization is implied.

## Integration and source

- [P6/P5H PR #7](https://github.com/nicssj-world/NIPT-CBH/pull/7) merged after both exact-head checks passed. Corrected integration SHA: `63829809d736c79c911afe419186b3a470c88333`; main merge: `ad66ab401b0565ed0bd88fb73096ef6f0456a1ef`. Original previous main `bd50f160dfd09654a348062f8aed0e488a609361` and integration HEAD are ancestors.
- [Post-merge CI](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38406327318): SUCCESS. The integration-only defect was a browser fixture fallback port3600 versus CI3000; corrected with focused real app/worker/renderer evidence before rechecking and merging.
- P7: `feat/p7-final-validation`, `D:\Claude workspace\NIPT-CBH-P7`, based on that exact merge. Commit sequence: `ab45d58` plan/UAT, `a76e995` safety, `96027ab` recovery, `572efa8` maintenance/print/performance, `5447fbf` parity; subsequent packaging and final evidence commits are discoverable in branch history. Final delivery HEAD is reported with `git rev-parse HEAD` outside this self-referential file.
- P7 is local only: no push, PR, merge or deploy. All databases/files are generated disposable synthetic targets. Existing migrations001–070 and dependency manifest/lockfile bytes remain unchanged;080/081 are new forward migrations, applied only to disposable test databases.
- Owned web/renderer/worker processes and the dedicated native PostgreSQL55450 cluster are stopped after verification; no listeners remain on3000/3001/55450. Ignored synthetic evidence/databases are retained, not silently deleted.

## Implemented workstreams

| Workstream | Delivered and verified scope | Evidence |
|---|---|---|
| A / safety | Unconditional protected clinical-state entry rejection; exact-attempt Pool/DNB/sequence currentness, recall/Stop-use/HOLD/supersession consumed by P5; existing consent/identity/RBAC/SoD/release guards preserved | [Safety](safety-evidence.md) |
| B / parity | Reported/imported dates, literal private POST search, gender/QC/risk/state before bounded pagination; same-page parsed CSV with export evidence; session-bound immutable diagnostic reparse; read-only historical integrity | [Parity](parity-evidence.md), [maintenance](maintenance-print-performance.md) |
| C / PDFs and printing | Actual label PDF page size/identity/suffix isolation; existing Thai forms/PDF/hash/reprint and HALOS47 contracts; Owner NO BARCODE tube lock retained | [Print evidence](maintenance-print-performance.md) |
| D / workflow and UX | Full synthetic registration/consent/task/lab/results/history browser flows; responsive/axe/error/keyboard checks; private search and diagnostic UI; prepared18 staff scenarios, checklist and Thai operator guide | [Checklist](acceptance-checklist.md), [guide](operator-guide.md) |
| E / reliability | Coherent encrypted DB/files/P6 backup and isolated fresh restore, strict archive/path/link/budget checks, exact audit/lineage/hash comparison; worker/idempotency regressions; bounded native performance | [Recovery](recovery-evidence.md), [performance](maintenance-print-performance.md) |

## Verification and retained artifacts

Ignored `.local` artifacts are retained locally for review and are not shipped as source or credentials.

| Check | Actual result / artifact |
|---|---|
| Initial full Vitest |1898 passed /2 optional legacy skips; includes33 P6 native cases; `.local/p7/candidate-0e84234085744b2f8a4195f947222f61/full-vitest.log` |
| Expanded final native/backend candidate |1867 passed /35 skips,79 files passed /3 skipped,346.58s; `.local/p7/candidate-46eb3e4ab3cc4c9fa0d8e8831a8084ff/full-vitest.log`. The33 unchanged P6 native cases reuse the initial passing run; remaining2 are optional legacy comparisons. The expanded suite adds2 A19 tests; this is not a claim of1902 newly executed passes |
| Browser correction evidence | Initial65 pass /3 failures: two ambiguous status test locators and real relocated PDF.js worker. Focused corrected actual web3/3 passed19.5s. Actual standalone then exposed missing Playwright registry/fonts; known-failed run intentionally terminated after diagnosis, not counted as a pass |
| Final actual standalone E2E |68/68 passed in3.0min, actual standalone web + separate renderer/worker with native nipt_web/nipt_worker logins; clinical authority false/releases0. `.local/p7/candidate-8fc670eef253465198b9d9b035ee799f/{full-playwright.log,result.json}` |
| Build / types / lint / guard | Final standalone build, `npx tsc --noEmit`, whole-repo ESLint and source guard475files passed. Exact hashes of PDF.js worker, Playwright registry and all4 fonts match installed sources; standalone excludes data/.local/.env.local/backups |
| Native recovery |113 public tables /168 rows,3 assets /7 P6 files, exact table/ledger/lineage/audit/file digests;12 tool negatives,5 focused regressions and original pre-P6 V1 positive. Backup358ms, restore812ms,607232 encrypted bytes; `.local/p7-ops/drill-2b68d8e159224b87b5d62244c226036a/report.json` |
| Final practical performance |500 actual imported synthetic reports /500 source PDFs; query30samples median8.95ms,p95 11.22ms; scan5samples median309.33ms,p95 325.16ms; zero releases. `.local/p7-performance/257a7275fe60453ebb503f1a4abc05aa/{metrics,query-plan}.json` |
| Independent review | Task1 reviewed independently by parity agent; recovery/maintenance by controller and ops agent; final integrated authority/migration/backup/parity review found no Critical/Important finding. Standalone packaging separately reproduced/fixed and application-tested |
| Dependency audit | Production-only audit0; full audit5HIGH development-chain findings,0critical. Local JSON retained at `.local/p7/{production-audit,full-audit}.json` |

Final Results screenshots at1280/768/375px and document-overflow checks are retained at `.local/p7/browser`. Controller visually inspected1280/375px: labelled controls and scope/HOLD messages remain readable, mobile controls stack, and wide tabular evidence stays in its incumbent contained scroll region. Automated axe/keyboard/overflow evidence is not manual WCAG/NVDA acceptance.

No P7 GitHub CI is claimed because P7 push is unauthorized. Local candidate checks are reported separately from the verified main CI.

## Remaining gaps and required decisions

The [gap register](gap-register.md) maps each remaining issue to root cause, impact, authority and next action, including original GC01–12/A19/A21/A22 and AL gates.

- **Technical upstream blocker:** eslint-config-next→fast-glob/micromatch/braces has5HIGH findings. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects braces<=3.0.3 and lists no patched version, checked2026-10-13. No compatible fix was published; no forced Next14 downgrade, fabricated waiver or dependency change. Resolve with a compatible patched chain or separately reviewed toolchain replacement.
- **Clinical acceptance HOLD:** approved QC5/clinical adapter evidence, methods/templates/PIC/confirmation, consent/governance/DPO/DCC and signed AL-4/5 acceptance are absent. Structural currentness and synthetic diagnostics never confer clinical acceptance. `p5_release_authorized()` stays false; no clinical releases created.
- **Actual systems/operations HOLD:** authorized HIS/HALOS/CFS/LAN identity/ACL/receiver/ACK and witnessed transport evidence; hospital forecast/x5 load/p95/RPO/RTO,512MiB backup capacity, schedules/retention/WAL/NAS/key escrow; Q-I6/Q-I7/Q-I11 remain unaccepted. Local DR/timings and PDF geometry cannot substitute for them.
- **Historical adoption HOLD:** OD18/19/20/21/23/26/27,Q-G7 and actual cutoff/anchor/completeness/revision governance; answered Q-P5H decisions are preserved. No automatic GA/match repair or historical HIS path.
- **Human acceptance NOT RUN/SIGNED:** staff success>=90%,0critical errors,SUS>=70; manual all-SC WCAG/NVDA ACR, physical printer/signing devices, training and signed validation/cutover. Scenarios are prepared; staff results are not invented.

Ready for authorized **synthetic staff-UAT execution/preparation** using the checklist, subject to the visible technical blocker and acceptance scope. **Clinical UAT with real data and P8 Pilot are NOT READY.** No remaining independent safe implementation item is being replaced by a handoff; outstanding work depends on an upstream fix, approved policy, external systems, actual devices or human acceptance.
