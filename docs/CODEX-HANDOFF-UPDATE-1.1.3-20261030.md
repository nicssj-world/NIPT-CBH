# CODEX HANDOFF — NIPT-CBH Windows Update v1.1.3 (2026-10-30)
**Owner instruction:** Take over end-to-end implementation, stabilization and verification. Do not ask owner to repeat decisions. Existing uncommitted work in this exact isolated worktree is the starting point, NOT disposable. Stop relying on ChatGPT to hand-edit source; Codex owns fixes going forward.

## Environment / safety / source
- Worktree: `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION\.local\claude-update-113`
- Branch: `feat/update-113-owner-scope`
- Dev MCP project: `NIPT-CBH-UPDATE-113`.
- Hospital currently uses v1.1.2; v1.1.3 is an **update-only Windows EXE** targeting installed v1.1.2. Source base checkout commit `1ad1f340bde071549f004b091de498c10fb5beb8`; production v1.1.2 EXE source revision `d914a0a8a95a261b3d02f16a4458f986e924ebfa`. Verify exact installed release manifest in actual package builder rather than assuming these interchange.
- Parent repository has unrelated clinical changes. **Never edit parent worktree or frozen UPDATE-112 worktree.** Do not push, deploy, install, alter real hospital server/NAS, reset Git/ACL, or build a production installer without all gates + explicit Owner authorization.
- Preserve existing uncommitted edits (many modified + new files). Do NOT reset, clean, rebase, overwrite or start from a blank branch. Inspect `git status --short` first.
- `docs/UPDATE-1.1.3-IMPLEMENTATION-LEDGER.md` is **stale after its P0 update**: it still says P1/P3/P4/P5/P6 not implemented, but substantial new code now exists. Update ledger accurately after review.
- No production EXE built, no commit/push/deploy. Previous Git index writes via Dev MCP failed (`unable to write new index file`, index owner BUILTIN\\Administrators); diagnose narrowly without broad ACL reset.

## Owner-locked scope P0–P6
**P0 HIS Settings:** Admin save only changed PET / RES / CFS / backup paths with actual Windows worker identity, permission probe and atomic revision; unrelated inaccessible existing path must not block saving a changed path. No second approver. Real hospital share probe acceptance only when authorized.
**P1 Worker Queue:** Admin visibility across job_outbox/integration receipts, pdf_archive_job, pg-boss; safe Retry, Clear Selected, Clear All for pending/running/failed/completed; do not delete immutable clinical/HIS receipts or falsely claim an in-flight HIS transmission was cancelled. Must reconcile external side effects, state, and audit; test concurrency.
**P2 PWA:** Installable Chrome/Edge experience over trusted hospital HTTPS; no PHI/cache/offline patient storage.
**P3 strict PET Gate:** **patient** specimen requires verified round-specific actual HIS PET before any Task List auto/manual/urgent/move/replace/finalize; LAB_DIRECT, paper consent and old S1 PET cannot bypass. EQA exception only with immutable organizer proof, never fictitious PET.
**P4 EQA:** Distinct organizer-verified EQA sample without HIS PET. Uses normal analytical/ReadyGen/NIFTY/HALOS workflow, existing signed PDF template with verified organizer-supplied patient-style fields and no visible EQA mark on PDF, but **never** creates HIS/RES/CFS outbound on initial, replay, withdrawal, repeat or no-call flow. All NIPT QC/certifier controls preserved. EQA may not coerce a real patient record into EQA after receipt.
**P5 Quality Control:** Internal year-wise EQA register and IQC Positive/Negative real workbook data; no fabricated numeric thresholds.
**P6 PET scan history/retention:** Display meaningful PET scans including failures; compact only successful *interval* 0/0 scans older than 24h into daily Bangkok-date summaries; no deletion of PET artifacts, failure/meaningful scan records or medical audit.

## Work carried out in this worktree since ledger — actual current source
- New migrations `161_pet_gate_eqa_case.sql`, `162_eqa_receipt_and_his_block.sql`, `163_worker_queue_clear.sql`, `164_pet_scan_empty_compaction.sql`, `165_eqa_certification_guard.sql`. Review critically for production PostgreSQL rights, migrations/replay/idempotency, races, existing data, and evolving schema.
- P3: `packages/lab/gate.ts`, `packages/lab/core.ts`, `packages/lab/batch.ts`: round-specific PET/EQA eligibility; SQL trigger guards slot assignment; rechecks moved slot.
- P4: `packages/p2/service.ts`, `packages/eqa/service.ts`, `src/app/api/eqa/register/route.ts`, `src/app/api/eqa/year/route.ts`, `src/components/p2/lab-registration.tsx`, `packages/lab/bench.ts`, `packages/readygen/reports.ts`, `packages/results/service.ts`, `packages/results/gates.ts`, `packages/p6/released-result.ts`, migrations 161/162/165. Immutable organizer evidence; PET-less EQA receive & genuine LN Halos; vendor export; internal signed PDF; suppress HIS outbox and block direct transfer. Check every alternative outbound code path, hidden EQA marking/PHI, and clinical gates.
- P5: `src/app/(protected)/quality-control/page.tsx`, navigation, `packages/eqa/service.ts`: annual EQA + PC/NC. Verify workbook schema/query and user roles/visibility.
- P1: `packages/jobs/admin-center.ts`, `packages/jobs/admin-clear.ts`, `src/app/(protected)/settings/worker-queue/page.tsx`, `src/components/worker-queue-actions.tsx`, `src/app/api/settings/worker-queue/route.ts`, `packages/results/archive-worker.ts`, migration 163. **Known incomplete:** pg-boss job classes missing, Retry controls missing, Running external side effects not robustly reconciled, and archive cancellation race needs proof. A UI labelled "Clear All" does not establish that all actual worker classes are safely cleared.
- P6: `packages/inbound/queue.ts`, `src/app/(protected)/inbound/page.tsx`, `packages/jobs/worker.ts`, migration 164: 24h successful 0/0 interval scan daily compaction. Validate strict allowlist and retained audit/row counts on native PG.
- P2 and P0 changes are described in existing ledger; verify production browser and native PG.
- `packages/db/roles.sql` has appended grants for new tables/functions; compare role privileges against least privilege.
- `tests/helpers/task3.ts` extended for synthetic EQA fixture, copied ignored synthetic test assets from read-only UPDATE-112 checkout into UPDATE-113. Test-only script `tests/unit/v113-local-assets-diagnostic.test.ts` copies locally approved fixtures with SHA check; evaluate whether to retain as a setup utility instead of shipping an active test that implicitly depends on another worktree.

## Verified checkpoints as of 2026-10-29 evening, after most recent edits
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build` (Next.js 16.4.3): PASS, **with dynamic filesystem tracing warnings** that require review before production packaging.
- `npm run test -- tests/unit`: **531 passed / 4 skipped / 0 failed** across 110 test files.
- `npm run test -- tests/permissions`: **857 passed / 0 failed**.
- `tests/contracts/eqa-native-report-113.test.ts`: PASS **real Word-rendered signed EQA PDF and CertifiedReleased**, no HIS release-completed outbox/transfer; check PDF contains organizer-provided name and no EQA label.
- `tests/contracts/task3-native-pathway.test.ts`: PASS **normal patient Word PDF / CertifiedReleased / HIS outbound** in the same two-test run.
- `tests/db/eqa-readygen-pipeline-113.test.ts`: PASS **no PET -> Task List 1–3 -> NIFTY/HALOS -> HALOS import -> report preparation**.
- `tests/db/eqa-register-receive-113.test.ts`: PASS organizer EQA with real LN Halos and gate; no fabricated HIS order.
- `tests/db/patient-pet-gate-113.test.ts`: PASS patient S2 local receipt without S2 PET refused both API placement and direct DB INSERT.
- `tests/db/task1-lineage.test.ts`: PASS 4/4 for re-sampling S2–S6 and real PET worker.
- `tests/db/pet-compaction-113.test.ts`: PASS strict aggregate retention with idempotent rerun and meaningful row preservation.
- `tests/db/worker-clear-113.test.ts`: PASS (2 tests) Pending/Dispatched/receipt and repeated clear cases; **not sufficient** to prove multi-worker races/pg-boss.
- Other P0/P2/P6 focused tests had passed in prior ledger.
- **NOT YET RUN / NOT GATED:** full DB/contracts suite on new worktree, native PostgreSQL with app_rw/worker_rw, full browser E2E/real Admin UX, mixed production-like user scenarios, Windows fresh update rehearsal 1.1.2→1.1.3 with data preservation/rollback, real UNC SMB acceptance, installer manifest/release hashes.

## Specific engineering hazards requiring Codex review, not blindly trust previous edits
1. **P1: Clear currently changes `job_outbox.state='Cancelled'` for Dispatched even though a physical HIS send may already be in flight**. It writes RECONCILIATION_REQUIRED to a shadow event and hides the job, but must **not** imply a confirmed cancellation. Fully reconcile with pg-boss worker and external receipt state and safe retries, or fail closed.
2. P1 archive worker checks `cancellation_requested_at` before publishing, but can race with Admin cancellation during NAS publication. Handle already-published files honestly; archive state must never be falsified; handle TTL claim expiry.
3. P1 DB grant `app_rw UPDATE(state,cancellation_requested_at,updated_at) ON pdf_archive_job` is broad for a clinical system; reduce privilege via validated function or documented safe capability and test role abuse.
4. EQA acceptance originally failed because overwriting `p5_operational_release_guard()` erased worksheet/no-call/internal guards. Migration 165 was corrected to **prepend a specific EQA guard to the existing composed trigger**, then RETURN NEW only for verified EQA; patient native pathway and EQA native pathway both PASS. Preserve this composition; don't revert to a generic replacement.
5. `nipt_round_pet_or_eqa_ok` must remain strict for same specimen/current round and not misclassify historical imports. Probe race conditions and older records.
6. Exports/readback should use organizer-provided identity/dates only, never infer missing DOB/EDD, no fake PET. `collectionAt` from organizer is needed for NIFTY; verify timezone handling.
7. Ensure EQA cannot enter HIS via `p6_release_eligible`, any scheduled jobs, legacy replay/RES, and CFS. The current isolated test primarily checks no job enqueued and no transfer, not all forged payload paths.
8. UI year EQA and PC/NC query is proof-of-concept; confirm IQC field keys and revisions vs actual approved master.
9. Existing ledger remains stale and needs a new evidence-backed release-gates report, not optimistic status edits.
10. P6 migration 164 uses SECURITY DEFINER `compact_pet_empty_scans` plus controlled trigger GUC. Audit PostgreSQL privilege escalation, search_path and concurrent compaction, including retention during clinical activity.

## Codex work order and release contract
1. Read this file, ledger, real schema, `git diff`, complete repo tree. Preserve all current source, do not assume green build means safe.
2. Create/update one durable checklist with every P0–P6 requirement and explicit tests, mark PASS/PARTIAL/BLOCKED and log exact evidence. No fake PASS.
3. Prioritize P1 safety (pg-boss, cancellation/reconciliation, role/claim races, Retry) and EQA no-HIS proof; correct PET gate/move/slot concurrency. Add cases for replay/no-call/repeat.
4. Complete P5 and P6 actual data/retention acceptance. Test P0/P2 browser/role handling.
5. Run static checks, focused tests, full suite, native PostgreSQL (roles + migration), real Word PDF smoke, browser E2E; fix all failures and introduced warnings relevant to Windows packaging.
6. Resolve local Git index permission narrowly; commit checkpoint when possible, no parent changes, no push. Prepare **update-only** Windows installer only if all code/native/rehearsal gates PASS; manifest SHA256, installed-version checks, rollback/backup, test upgrade with preserved data first.
7. Real hospital server and UNC SMB acceptance require explicit Owner approval; never mark production READY merely from sandbox test.
8. At end return one compact factual report: completed, tests with counts, blockers, updated files, commit/package hashes (if created), exact Owner action needed. Keep working until all locally actionable gates pass; don't repeatedly stop to request permission already granted for local work.

## Start command for Codex
Open Codex in the worktree above and send:
> Read `docs/CODEX-HANDOFF-UPDATE-1.1.3-20261030.md` and `docs/UPDATE-1.1.3-IMPLEMENTATION-LEDGER.md`. Take over all v1.1.3 remaining engineering and release validation in THIS worktree without resetting current edits or touching other worktrees/hospital. Create a checklist, resolve known P1 pg-boss/in-flight safety, EQA/PET Gate, P5/P6 verification, then run all tests and native/browser/installer rehearsals. Work continuously on authorized local tasks, fix failures, and report exact PASS/PARTIAL/BLOCKED. No deploy/push/production install without separate approval.
