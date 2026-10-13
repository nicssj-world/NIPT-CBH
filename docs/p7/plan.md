# P7 final technical validation implementation plan

Authority: Owner session order 2026-10-13; Implementation Plan v6.2.1 SHA256 261acf8cebec7915d255abaccf02e2bb55d76de0a59b26d9c7abc7b0c7703c2e; existing gap/parity/delivery records. Execute only after PR #7 merges and ancestry/post-merge CI are checked. This plan expands the authorized P7 work into bounded implementation and evidence tasks; it does not replace clinical decisions.

## Global constraints
- Local/on-premises architecture; generated synthetic/disposable environments only.
- Keep AL-5/AL-6/AL-8, clinical QC5/HIS/HALOS/CFS release adapters and pending policies HOLD.
- No changed applied migrations, no P7 push/PR/merge or deployment.
- Preserve Owner A14/A23, Q-P5H01(a)/02(b)/03(a)/04(a)/05(a)/06(a), locked label NO BARCODE geometry, 47 HALOS data rows/no Barcode13/no filler.
- Focused red-to-green regressions first; one final complete candidate regression/E2E with independent native fixtures. Reuse previous stress evidence.

## Task 1 (P0 / A): clinical state hardening and integrated currentness
- Files: new migration 080; packages/results/{gates,service}; new shared evidence module; P5 gate labels; tests/db/p4b-p5-integration; tests/unit/p5-gates; native negative test.
- Reject INSERT and entry UPDATE into AnalysisComplete/FinalQcAccepted/Final unconditionally until separately reviewed clinical QC adapter exists. No custom-GUC, role, setting or synthetic acceptance bypass.
- Read exact attempt's current Pool/DNB/sequence, Stop-use/HOLD/supersession and recall evidence; require evidence/currentness for P5 RG06/RG07. Analysis/final acceptance remain false independently of state strings.
- Preserve ordinary P4 state transitions, identity/consent predicates and independent p5_release_authorized=false/release triggers.
- Tests: direct app/owner protected state writes, no-fake-final state gate, stopped/recalled/stale upstream P5 blocking, zero result_release rows, native roles.

## Task 2 (P1 / B): approved result parity and maintenance evidence
- Files: new result query/filter/CSV module and API; result workspace small labelled filter UI; new controlled reparse service/API/evidence migration081; read-only historical integrity maintenance tool; focused unit/DB/browser tests.
- A19: parameterized server-side import-date/risk/state filters before bounded pagination; same query for CSV. Existing report.export permission plus result.review, lab-only synthetic scope, no-store/audited, CSV injection protection/leading-zero retention, no misleading low-risk interpretation for unknown data.
- A21: explicitly requested, reasoned/idempotent controlled parse of immutable bytes creates append-only diagnostic evidence. Never overwrite parsed report/version, clinical linkage, review or release; no automatic promotion. Restrict through current result maintenance permissions and assert active session.
- A22: report historical integrity/provenance without silent GA/match repair. Existing correction path remains authoritative; unresolved policy-dependent edits HOLD.

## Task 3 (P1 / E): backup/recovery and integrity
- Files: deploy/scripts/backup/restore and a shared path/archive validation helper; synthetic native DR test/tools; operations docs.
- Require explicit quiescent source; no new live deployment action. Include P6 sandbox artifacts in backup with manifest and restore to a fresh separate root; never overwrite current sandbox/delivered files.
- Reject path/link/archive escape and occupied destinations before writes; target must be fresh database across application schemas; encrypt/authenticate as current contract. No stored key or credential output.
- Fresh native PG17.11 cluster/new databases; seed representative P2/P4/P5/P5H/P6 evidence through existing helpers; backup/restore actual tools; compare canonical table/lineage/audit/asset/artifact manifests and migration checksums, independent role preparation; negative corruption/wrong-key/unsafe archive/target cases.
- Record measured timings/size and practical bounded query p95; hospital RPO/RTO/load and key escrow remain NOT ACCEPTED.

## Task 4 (P2 / C,D,E): complete candidate verification and human acceptance preparation
- Cross-module functional/security/permission/native suites, no clinical release; full browser registration/task/lab/results/history and new parity tests with real worker/renderer.
- PDF/print: verify actual PDF extraction/page geometry/identity/watermarks and label geometry/ID segregation against locked specifications; HALOS47 existing contract; physical printer/vendor acceptance remains NOT TESTED.
- UI: incumbent Thai-first patterns, validation/error/recovery, keyboard/responsive/axe; fix only proven issues. Impeccable harden + ui-ux-pro-max used for changed results controls, bounded inspection.
- Produce traceability/gap register, UAT scenarios/checklist with task success>=90%, critical errors0, SUS>=70; per-screen manual/NVDA ACR untested clearly separated.
- Reconcile legacy matrices stale P5/P6/P5H rows; no archive re-audit. Document every remaining technical/clinical/operational blocker with root cause, impact, decision and next action.
- Logical local commits, final review and status COMPLETE/PARTIAL/BLOCKED based on actual evidence.

## Interface/overlap review
| Tasks | Shared interface | Ruling |
|---|---|---|
|1/2|result service|Task1 owns gateFor only; Task2 owns query APIs/new maintenance modules; avoid same hunks|
|1/3|migration/roles|080 safety versus081 maintenance; append new grants only, scripts reapply must preserve safety|
|2/3|reparse/table/file evidence|DR restores append-only evidence and immutable assets; diagnostic evidence never authorizes clinical use|
|1/4|old forced-state test|Replace upstream bypass expectation with denial; independent release hold still tested|
|2/4|UI and CSV|One filtered query drives UI+export; browser confirms parity/access/errors|
|3/4|native environments|Owned loopback cluster and fresh separate browser/native DBs; no shared real endpoints|
|1|internal consistency|Closed adapter is a security boundary, not a fabricated QC5 implementation|
|2|internal consistency|Reparse adds diagnostics only, no immutable-report replacement; automatic legacy repair remains held|
|3|internal consistency|Observed DR/performance is technical evidence; no approved RPO/RTO/expected volume invented|
|4|internal consistency|Automation never stands for staff/clinical/manual acceptance|
