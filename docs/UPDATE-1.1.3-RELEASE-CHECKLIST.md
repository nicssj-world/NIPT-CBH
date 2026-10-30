# v1.1.3 release checklist

Status is evidence-based: PASS requires verification of the whole item; PARTIAL means local implementation or evidence is incomplete; BLOCKED is reserved for an explicitly authorized real-system acceptance. Historical results in the handoff are not independent verification in this session.

## P0 — HIS settings
- [ ] PARTIAL — Admin-only atomic changed-path save, exact worker identity and write/read/delete probes; unchanged inaccessible paths do not block. Verify native PostgreSQL, concurrent revisions and live browser. Handoff reports 40 focused tests; not independently rerun.
- [ ] BLOCKED — Actual hospital Windows worker identity and UNC/SMB permissions require Owner authorization.

## P1 — worker queue
- [ ] PARTIAL — Complete redacted Admin visibility of outbox, receipts, archive and all pg-boss states/classes, including scheduled/retry; pagination and counts accurate.
- [ ] PARTIAL — Safe retry, clear selected and clear all, including concurrent workers, retries and idempotency; preserve immutable clinical/HIS evidence.
- [ ] PARTIAL — Dispatched/in-flight HIS must not be represented as confirmed cancelled; reconcile external effects and receipts. Dispatched now retains its state and remains visible as requiring reconciliation; worker may still execute and full reconciliation remains unimplemented.
- [ ] PARTIAL — Archive publication/cancellation and expired claims reconciled without falsely describing a published or possibly published file as cancelled.
- [ ] PARTIAL — Least privilege for app_rw/worker_rw, abuse and audit tests on native PostgreSQL. Direct archive state update grant removed; bounded functions and their identity trust boundary need further review.

## P2 — PWA
- [ ] PARTIAL — Installable in Chrome/Edge over trusted HTTPS, with no PHI offline cache/storage; browser and installability verification pending.
- [ ] BLOCKED — Hospital HTTPS/client acceptance requires Owner authorization.

## P3 — PET gate
- [ ] PARTIAL — Patient current-round actual verified PET required for auto/manual/urgent/move/replace/finalize, including direct database writes and races; no LAB_DIRECT, paper or old-round bypass. Handoff reports focused tests; independently verify all pathways and native roles.
- [ ] PARTIAL — PET-less EQA exception only with immutable verified organizer proof, including old imports and concurrent change checks.

## P4 — EQA
- [ ] PARTIAL — Organizer-verified distinct EQA and genuine workflow through ReadyGen/NIFTY/HALOS and all QC/certifier controls; real patient cannot be reclassified after receipt.
- [ ] PARTIAL — Signed existing PDF uses only verified supplied patient-style fields, no EQA mark or inferred DOB/EDD, correct collection timezone; real PDF evidence and review required.
- [ ] PARTIAL — No HIS/RES/CFS in initial, direct transfer, forged payload, scheduled, replay, withdrawal, repeat and no-call flows; test all alternatives alongside normal patient release.

## P5 — quality control
- [ ] PARTIAL — Annual internal EQA register and IQC positive/negative use actual approved workbook schema, keys and revisions with appropriate role visibility; no fabricated thresholds.

## P6 — PET scan history and retention
- [ ] PARTIAL — Display failures and meaningful scans; compact only successful interval 0/0 over 24 hours into Bangkok daily summaries, preserve artifacts, meaningful/failure rows and medical audit; verify counts, idempotency and concurrency on native PostgreSQL.
- [ ] PARTIAL — Audit SECURITY DEFINER search_path, permissions, controlled trigger and privilege abuse.

## Cross-cutting release gates
- [ ] PASS — `npm run typecheck`, current worktree, 2026-10-30.
- [ ] PARTIAL — Unit, integration, permissions, full database/contracts, native PostgreSQL migrations and restricted roles; record exact results and failures.
- [ ] PARTIAL — Browser role/workflow regression and real Word PDF; distinguish synthetic from clinical acceptance.
- [ ] PARTIAL — Review Next.js build filesystem tracing warnings and Windows package contents.
- [ ] PARTIAL — Verify installed v1.1.2 manifest and source; rehearse update-only upgrade, rollback and preservation of real-shaped synthetic data; record hashes. No release package until local gates pass.
- [ ] PARTIAL — Local Git checkpoint: diagnose index permission narrowly without resetting ACL or other worktrees.
- [ ] BLOCKED — Hospital, real UNC, production and Owner acceptance require separate authorization; no push or deploy.

## Evidence log
- 2026-10-30: `git status --short --branch`, `git diff --stat`, `git diff --cached --stat`, and `git log -1 --oneline`: branch `feat/update-113-owner-scope`, HEAD `1ad1f34`, extensive pre-existing modified and untracked files, no staged changes.
- 2026-10-30: `npm run typecheck` PASS.
- 2026-10-30: `npm run test -- tests/db/worker-clear-113.test.ts` PASS 2/2 on PGlite. This test expects Dispatched to become Cancelled and therefore does not establish in-flight safety.
- 2026-10-30: changed the above test to require unchanged Dispatched state and visibility; confirmed failure before the fix. Focused worker tests PASS 5/5 after the fix; this does not prove cancellation, pg-boss coverage or external reconciliation.
- 2026-10-30: `npm run lint` PASS; `npm run typecheck` PASS after worker change; `git diff --check` PASS for tracked files.
- 2026-10-30: PET gate, EQA registration/pipeline and compaction focused PGlite tests PASS 4/4; native PostgreSQL and full scenarios remain outstanding.
- 2026-10-30: unit suite with default TEMP: 528 passed, 3 failed, 4 skipped. Two failures reported EPERM resolving `C:\Users\User`; rerunning both affected backup files with TEMP/TMP in this worktree passed 6/6. This does not establish that the entire suite passes with the alternate TEMP.
- 2026-10-30: full unit suite with worktree TEMP/TMP PASS 531, SKIP 4, FAIL 0 (110 files); permissions suite PASS 857/857 (3 files). The four skips remain unverified.
- 2026-10-30: added an empty-count-object retention regression; it failed because migration 164 compacted a record with no proof of 0/0. Migration 166 requires numeric zero `stored` and `parseError` and zero values throughout; focused PGlite test PASS 1/1 after the change. Native PostgreSQL security, concurrency and full retention gate remain pending.
- 2026-10-30: isolated PostgreSQL 17.11 started on loopback 25483 with a new worktree-local cluster and disposable synthetic database. Native archive test exposed app_rw's direct state update permission. Migrations 167/168 revoke the direct grant and provide bounded functions; native test verifies direct update denied, non-admin UUID refused and authenticated service call clears a failed archive job. Function actor UUID is application-supplied, so independent database identity binding remains a security limitation for review.
- 2026-10-30: native archive race test demonstrated a clear during failed publication was reported CANCELLED. Worker now records FAILED / ARCHIVE_RECONCILIATION_REQUIRED for that case and keeps the requested item visible; native archive and unit archive tests PASS 5/5. Claim expiry and truly concurrent connections/external publication reconciliation remain unverified.
- 2026-10-30: full contracts run was interrupted after multiple failures; it included protected real-source tests outside the synthetic-only execution boundary. No full-suite result claimed. Full DB suite started before migrations 166–168 were added and cannot establish exact-current-source results.
- 2026-10-30: in an isolated native PostgreSQL transaction under worker_rw, one qualifying 0/0 scan compacted, the second run compacted zero, an empty-object interval and a manual scan remained, and app_rw read summary count 1; transaction rolled back. Concurrency and privilege abuse remain open.
- 2026-10-30: P0 focused suite 40/40 PASS (PGlite and local filesystem); operational results 3/3 PASS (PGlite). Synthetic EQA and patient Word/PDF contracts 2/2 PASS outside the sandbox after the sandbox run failed to open Word COM with Windows error 80070520. These do not establish native PostgreSQL/browser or real-system acceptance.
- 2026-10-30: native PostgreSQL restricted-role P4 concurrency contract PASS 1/1 in a separate synthetic database. This does not cover all new PET-gate races.
- 2026-10-30: history test first failed because old missing/unknown counts were hidden; the history filter now hides only proven compaction candidates. History and compaction PGlite tests PASS 2/2. Current policy conservatively retains scans with any nonzero counter, including day-folder count; effectiveness on real scan distributions remains open.
- 2026-10-30: build PASS, five Turbopack dynamic filesystem tracing warnings remain; configuration excludes several sensitive trees, but standalone contents and final Windows payload have not yet been audited. Typecheck/lint PASS after archive changes.
- 2026-10-30: native PostgreSQL Admin archive browser contract PASS 1/1 with a new synthetic database and app_rw web role. Initial attempt failed after the first temporary PostgreSQL cluster entered a checkpoint recovery loop due to mixed Windows ownership; a fresh worktree-local cluster initialized and started under one identity resolved that issue. An elevated browser attempt also failed to overwrite sandbox-owned build assets; the successful run used the sandbox with a fresh synthetic database. This is archive browser coverage, not P0 or PWA coverage.
- 2026-10-30: in native PostgreSQL, a test first showed an archive with an uncertain publication could be queued for retry. Both the admin retry request and worker probe recovery now exclude jobs with a cancellation request; native archive and unit worker tests PASS 5/5. External reconciliation and claim-expiry handling remain open.
- 2026-10-30: actual local workbook master, synthetic PC/NC values through workbook revision and IQC query: `tests/db/operational-workbook.test.ts` PASS 2/2 on PGlite, including ANC permission denial. Broader workbook data, other roles, EQA register and browser validation remain open.
- 2026-10-30: repeat `npm run typecheck`, `npm run lint` and tracked `git diff --check` PASS after archive changes. The second full DB suite was interrupted and ran while source was changing; no result is claimed. Native test server `pg113-native-owned` stopped cleanly; its synthetic data and prior failed cluster are preserved.

## Resume
Continue in this worktree, preserving all uncommitted files and both local PostgreSQL cluster directories. Start the `pg113-native-owned` cluster under its owning Windows user on loopback port 25483 if needed. First finish P1 pg-boss coverage, retry/clear and archive claim-expiry reconciliation, then follow all remaining unchecked requirements above. Re-run full suites on stable source, review every skip, and do not package or commit as release-ready until the gates actually pass. The current `p6_release_eligible` function predates EQA; explicitly test its EQA behavior and every direct, replay, repeat and No Call route while retaining normal patient behavior.

- 2026-10-30 (07:58 ICT), independently reran `npm run typecheck` PASS, `npm run lint` PASS, and `npm run test -- tests/db/pg-boss-overview-113.test.ts tests/db/worker-clear-113.test.ts tests/db/patient-pet-gate-113.test.ts` **5/5 PASS**. All three suites are focused tests only; pg-boss mutation, HIS in-flight reconciliation, native PostgreSQL, full browser and Windows update rehearsals remain PARTIAL, not release approved.
