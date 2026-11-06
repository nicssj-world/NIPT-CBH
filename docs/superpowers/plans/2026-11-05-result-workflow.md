# Result workflow implementation plan

Approved consolidated scope: reuse P5/P6 and ReadyGen, simplify the two result journeys, keep legacy RES/OK filenames unchanged. Development and synthetic validation never access real HIS/CFS paths. Production deployment is separately gated and requires current Owner authorization.

## Requirements
- Lab work ends at sequencing; result release reuses the current accepted sequencing evidence (verified HALOS handoff and QC4 review) without asking for a second Owner worksheet/Pooling review. Existing revision-bound Owner review remains usable for paper-only legacy runs. Never fabricate checks or waive sequencing, QC, identity, or certification gates.
- External Final PDF: scan/upload, inspect patient matching, select ready rows, one confirmation imports/links/releases through existing services. Conflicts remain actionable; preserve original PDF bytes.
- HALOS: existing adapter/interpreter/export linkage, selected-patient batch preview, signer defaults/overrides, one confirmation renders/registers/releases each ready patient. Keep partial outcomes and idempotency.
- Durable generation with status/resume after refresh; use existing outbox/worker and report ledger, not a second result system.
- PDF download and CFS name default `run042569_HN_LN.pdf` for run 004 in BE 2569. Editable settings; preserve HN/LN zeros and source Run. RES/OK naming/encoding remain exactly legacy. No overwrite of differing files.
- Editable RES profile and fixed operator setting; existing settings revisions reused. Existing frozen transfers retain names/payload; preserve cancellation for revoked authority and explicit rerouting safety.
- Shared truthful HIS badge in result lists and patient view, separate from report availability. Include outbox waiting, retry/error, delivered-unconfirmed and user attestation; no inferred HIS ACK.
- Hide routine inbound scan history; no growing logs/audit for unchanged empty automatic scans. Maintain summary/heartbeat/backoff and meaningful immutable events; no historical deletion.
- Thai-first operational UX consistent with DESIGN.md, keyboard/touch accessible, light/dark; apply UI/UX Pro Max and Impeccable from official sources.

## Tasks
1. Extend existing filename/profile settings and P6 consumers without changing RES/OK wire contract.
2. Add inbound current-state summary and event-only interval scan history; adapt consumers/UI.
3. Add durable result batch orchestration over existing P5/P6 services with previews, per-item results and reconnect status.
4. Consolidate result UI, batch preview/signers, patient HIS badge; reuse accepted HALOS handoff and QC4 evidence already recorded by the sequencing workflow. Do not add a Lab completion action.
5. Focused unit/DB/browser checks, dev:verify, independent review and corrections. Record BLOCKED checks honestly.

## Existing functionality retained
HALOS classification/interpretation, DOCX masters/native Word verification, signer authority, P5 matching/version/release, ANC viewer, P6 outbox/journal/retry/backup/RES/OK, settings maker-checker, immutable audit and historical/EQA outbound barriers.

## Validation
Tests first for naming/settings compatibility, empty scan summaries and backoff, batch idempotency/partial results/stale evidence, one-confirm external journey, accurate HIS outcome mapping and recovery. Native Word/owner assets and real UI checks require their actual prerequisites; no full release/package/deploy for development validation.

## Execution ledger
- Started 2026-11-05; branch feat/result-workflow-20261105. Existing unrelated untracked deployment-status document retained.
- Baseline targeted checks from preceding audit: 545 RES/transfer plus 10 case-upload/operational result tests passed.
- Ruling: work in this checkout on a feature branch, following repository Fast Development Pipeline; no extra worktree or dependency reinstall.

## Implementation status — 2026-11-06
- Reused the existing result release/P6 queues, ReadyGen parser, HALOS interpreter and Owner DOCX masters. Added exact Run/HN/LN PDF naming; legacy `.res`/`.ok` names and wire format remain unchanged.
- Added durable selected-row HALOS report jobs with preview, signer defaults/overrides, per-row holds/results, resume after refresh and parent ZIP. External ReadyGen PDFs now preview patient/round matching and can complete in one action when the acting role satisfies the configured linkage authority; otherwise they remain available in the existing linkage queue. No linkage policy was weakened.
- Added editable HIS profile/operator settings, shared truthful HIS status badges, frozen transfer naming/authority handling and compact inbound scan status instead of accumulating unchanged empty-scan history.
- Added migration 200 to grant the new runtime tables on upgrade, repeated narrow grants in `roles.sql` for fresh installs, limited inbound-state writes to the scan worker, and scoped durable-batch insert/update columns. Upgrade and fresh-install privilege paths were checked against the loopback synthetic PostgreSQL in rollback transactions.
- Result preparation and release consume current accepted sequencing evidence already in the system (verified HALOS handoff and QC4). There is no additional worksheet/Pooling confirmation in the Lab UI; legacy paper-only evidence remains handled by the existing result-review path.
- P5 reuses an in-system sequencing attempt with accepted HALOS handoff and QC4, without asking the reviewer to repeat Lab work. The accepted sequencing/QC gates remain active; legacy paper-only review remains available where no sequencing attempt exists.
- Responsive browser review: 18 screenshots across 375/768/1440 px and light/dark modes; no horizontal overflow or serious/critical Axe findings. Impeccable detector returned no findings.
- Verification: `npm run dev:verify` via the deployment toolchain's Node 24 passed typecheck, lint, deployment contracts, migration rehearsal and inventory. The 126-file focused run had 1,057 tests pass, 57 skipped, and one failure because `docs/p5-settings-coverage.md` had not been regenerated after its matrix changed; regenerated it with `tools/settings-coverage.ts` and reran the affected test file successfully (6/6). The earlier 582-test focused run across 13 files also passed. Migration 200 and fresh-install grants were checked on the loopback synthetic DB inside rollback transactions. After updating the EQA test fixture to include sequencing review, the three affected result test files passed (4/4), and `npm run dev:verify` passed.
- Operational release status is determined from the exact-commit preflight report and the per-run record under `deploy/history/<environment>/<run>/record.json`; do not infer it from this implementation note.
