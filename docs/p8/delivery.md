# P7 finalization and P8 local technical candidate delivery

Report date: 2026-10-14 Asia/Bangkok. **P7 merge complete. P8 PARTIAL: local synthetic technical candidate delivered; hospital infrastructure/operational acceptance and upstream dependency constraints remain. Clinical Pilot/Go-live NOT PASS / HOLD.** No P8 push/PR/merge or Production deployment is authorized or performed.

## P7 finalization

- [PR #8](https://github.com/nicssj-world/NIPT-CBH/pull/8), title `P7 Final Validation — Clinical Safety, Functional Parity and Operational Readiness`, merged as `7c63a2a6b557d4cac9e325a22f50319ee9241e7d`.
- Exact P7 head `34059e288c1f1f87fdd27a646ddc8b82fbdbf236`: [push CI38437963540](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38437963540) and [PR CI38438056458](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38438056458) both SUCCESS before merge. No branch protection/ruleset existed; the Owner's all-checks condition was enforced manually without bypass.
- [Post-merge CI38440548956](https://github.com/nicssj-world/NIPT-CBH/actions/runs/38440548956): SUCCESS. Merge parents are prior main `ad66ab4…` and exact P7 head; ancestry verified. No duplicate P7 PR or P7 implementation/full local-suite rerun.

## Recovery of interrupted P8 work

Existing worktree `D:\Claude workspace\NIPT-CBH-P8`, branch `feat/p8-technical-readiness`, was preserved. Original local commits and uncommitted deployment/health work were recovered in place; no reset/clean/discard, database recreation or unrelated process termination. Dedicated PostgreSQL17.11 cluster on127.0.0.1:55461 was verified before continuing. Native worker/renderer processes were already stopped; retained successful and failed UUID databases/artifacts were not deleted.

The initial UAT statement means **seven users and three foundation cases**, not seven patients. Original native UAT database remains. Its generated64-byte name was implicitly truncated by PostgreSQL; actual identity was read back into `verified-database-identity.json`, and future names were fixed to stay within63 bytes. Existing data/config were preserved.

## Implemented workstreams

| Workstream | Delivered scope / actual evidence |
|---|---|
|A|Trusted signed offline installer; immutable bootstrap image; explicit runtime/project/loopback port; clean-source and actual baked migration provenance; fresh destinations; startup ordering; lock-protected upgrade; bound verified backup; clean worker drain; compatible app-only rollback including failed-upgrade recovery/schema uncertainty|
|B|Real Linux Docker-volume fresh installation, actual forward upgrade and app rollback; TLS browser registration/worklists/Results HOLD/session-bound Thai PDF; real worker PDF and isolated P6 transport CLI. Unchanged P7 lab/result/history68/68 browser evidence reused|
|C|Actual owned-worker termination and durable retry/pending recovery, receipt idempotency, migration drift/transaction rollback, encrypted native and installed DB/files/P6 restore; runbooks for scheduling, restart, failure/rollback/DR|
|D|Retained17-group native cutover rehearsal through existing services: frozen synthetic list/hash, strict cutoff boundary, invalid anchor/in-flight HOLD, identity/LN conflicts, independent partial confirmation, atomic rollback/retry/replay and outbound barrier|
|E|Seven synthetic roles/accounts, cases, credential-file references, ready local environment and18 unsigned NOT_RUN records; existing P7 checklist/operator guide; physical device checklist|
|F|Least-privilege actual logins/groups, secret-free JSON health with real worker lock and independent P6 failures, Linux secret ownership/modes, private networks/loopback ingress, bounded egress/performance and dependency tracking|

Code candidate `d5f2d5d3a5ab33572ee28440c52d965b07e6578e` includes both independent-review fixes. Subsequent changes are the corrected smoke-test LN fixture and delivery documentation. Final bundle/image source SHA and immutable IDs are recorded outside this self-referential report in the signed manifest and `.local/p8/build-delivery-candidate.json`; exact local Git HEAD/status are reported by the controller after final documentation commits. No application workflow, applied migration or dependency manifest was changed in P8.

## Deployment and rehearsal artifacts

- Initial signed image/bundle source `77f26089e7af2f74f4b7b0548d8bfaa3b02a09af`; reviewed code candidate signed bundle `p8-d5f2d5d3a5ab`. Three application images plus pinned PostgreSQL/Caddy archives; migration inventory SHA256 `205b049a8814ffb35e786a4d5732b5ef857a6950e73f9f1623c5b07138326d58` across24 migrations. Each signed image's baked record/content was checked before export.
- Actual isolated Linux storage: volume `nipt-p8-installer-c7c53c016370`, runtime `/var/lib/docker/volumes/nipt-p8-installer-c7c53c016370/_data/runtime`, project `nipt-synthetic-p8-c7c53c016370`, HTTPS localhost18443. Runtime files are on Linux volume storage, not a Windows bind; only media/trusted tools use the workspace mount. No hospital host or existing deployment changed.
- Linux controller used existing Node/Docker CLI capabilities with networking disabled and its own Docker project. Docker Desktop CLI binaries were read from its installed CLI ISO; WSL integration/global settings were not changed. At initial daemon startup, existing restart-enabled containers resumed automatically; no commands changed those containers.
- `.local/p8/{install-initial,upgrade-code-candidate,rollback-code-candidate}.log`: actual orchestration SUCCESS/STARTED_NOT_ACCEPTED; rollback preserves database/migrator topology and records a persistent three-service override. Startup status is not acceptance.
- `.local/p8/installed-smoke-778c1824f2484d9d97d3da18f6faf124/report.json` and screenshot: authenticated leading-zero registration, Lab/Task List/Results/health pages, visible HOLD, actual PDF byte reuse/hash and cross-session403. One smoke test passed4.4s. Initial failure used invalid synthetic LN prefix; system correctly rejected it. Failure trace retained, fixture corrected, affected test passed; no runtime workaround.
- `.local/p8/installed-p6-*`: real packaged fixture enrollment/worker/publication/backup/OK/history and SYNTHETIC_CONFIRMED with `hisConfirmed:false`. A successful ordinary PDF still yields readiness false while P6 pending1; confirmation clears only the synthetic barrier. No clinical publisher/real receiver was created.
- `.local/p8/linux-secret-permissions.json`: generated key/secret files UID/GID1000, mode0440; source directories0750. Application containers run nonroot with capability drops/read-only filesystems as configured. `.local/p8/installed-egress-probe.log` records blocked TEST-NET access; this bounded probe/config inspection is not hospital LAN acceptance or a complete egress audit.

## Recovery, cutover and performance

- [Native operations evidence](operations-evidence.md): actual owned-worker kill, durable retry/pending recovery,3 receipts, no duplicate/lost committed receipts; startup700ms, recovery5405ms, encrypted backup1568ms, restore683ms. Restored DB has no worker lock and correctly reports readiness false. Failed checksum/DDL migrations are rejected/rolled back;6 actual login release/audit/DDL denials.
- `.local/p8/installed-dr-final.json`:126 public+pgboss tables /158 rows,3 file assets /7 P6 files,2 committed job receipts, encrypted773632 bytes. All table and file/P6 digests match fresh restore. Measured backup402.60ms /restore517.31ms; lost committed receipts0. Initial pre-upgrade DR separately verified126 tables/77 rows/1 asset/1 receipt. These are tiny quiescent synthetic snapshots, not accepted hospital RPO/RTO.
- `.local/p8/installed-protected-state-inserts.log`: actual owner and app role denied INSERT into AnalysisComplete/FinalQcAccepted/Final (six attempts), authority false/releases0/clinical states0. Initial UPDATE probe lacked an analytical-attempt fixture and is retained as NOT TESTED; existing P7 native UPDATE denial evidence is reused, not fabricated.
- [Cutover evidence](cutover-evidence.md):17 check groups,3 historical records,10 evaluations,12 sources, valid audit/integrity, zero transfers/releases; frozen in-flight post-cutoff completion remains NotEligible/HOLD. Synthetic cutoff2026-01-01 is not actual go-live cutoff.
- `.local/p8/health-performance-final.json`:30 final P6-aware read-only native probes, median8.38ms/p95 10.76ms; absent worker remains not ready. P7's500-report query/scanner performance is retained; hospital forecast/x5 load and thresholds remain Q-I6.

## Verification and honest limits

- Final focused integration: **42 Vitest tests /7 files passed**, **13 Node deployment tests passed**, whole TypeScript/lint/source guard498 files passed. Packaged browser smoke **1 passed** after one corrected fixture failure. Native cutover17 groups and native recovery evidence are additional scenario evidence, not added to automated test totals. No skipped tests in the selected local regression; P8 installed smoke is deliberately opt-in in ordinary CI.
- Independent review found two Important bugs: P6 could be masked by PDF success; runtime/backup could be stale before locking. Fixed with realistic migrated P6 service regressions and deterministic intervening-marker regression. Scoped re-review found no remaining Critical/Important blocker. Real packaged P6 health behavior also verified.
- Production npm audit0, full unchanged development chain5 HIGH/0 critical. Current npm proposal is an incompatible downgrade; no risk waiver, forced downgrade or false resolution. Retained audit JSON is in the P7 ignored evidence directory, dated the same Bangkok day.
- Post-documentation bundle upgrade/smoke and final runtime state are controller-recorded external artifacts, not an invented self-referential SHA. The controller verifies them before issuing the final response. Local source commits only; no P8 remote delivery or exact-head P8 GitHub CI is claimed.

## Remaining gates and Owner actions

See the single [P8 gap register](gap-register.md), [installation/recovery runbook](installation-operations.md), [signed tooling commands](deployment-notes.md) and [staff preparation](staff-uat.md).

**Synthetic Staff UAT: prepared for authorized local synthetic scenarios**, using the generated accounts, observed endpoint and blank records; actual staff results/physical printing/manual accessibility are NOT RUN/SIGNED. Clinical templates/signing/vendor/LAN tasks retain explicit HOLD outcomes until approved. Synthetic success does not approve clinical UAT with real data.

**Clinical Pilot / Go-live: NOT PASS.** Owner/Lab QA/Clinical Governance must supply QC5/adapter, methods/templates/consent/DPO/DCC and AL-4b/5 evidence; IT must authorize real endpoints/LAN/service identities/ACK, NAS/WAL/retention/escrow/full DR and operational sizing/targets; Owner must approve actual cutoff/anchor/frozen list/Q-I11/OD-26(c), staff/physical/manual UAT/training and signed AL-7 go-live. Upstream HIGH development chain needs a compatible fix or separately reviewed replacement. Do not enable release, connect real systems, install hospital schedules or publish P8 from these technical results alone.

## Final controller validation after documentation packaging

Final signed/installed bundle source: **`16b9499aca8fef79fbd2913d4e4ba7c11cdb3ff4`**, tag `p8-16b9499aca8f`. Actual post-rollback forward upgrade succeeded; `.local/p8/final-upgrade.log`, `final-validation.json` and `final-runtime-summary.json` bind all five running services to the signed immutable image IDs. Final browser smoke passed1/1 in5.8s; evidence `.local/p8/installed-smoke-1e9d7ce58eaa4e189e631c2ff5d4108b/report.json`. Final operator health observed worker lock/recent successful real job, zero pending/unresolved P6, valid migration/audit/roles, authority false/releases0. Health is a point-in-time observation; the conservative recent-success predicate can become false during idle time without authorizing clinical use.

Installed dataset at final observation: **7 accounts,5 synthetic cases,3 job receipts,1 SYNTHETIC_CONFIRMED P6 transfer,0 clinical releases**. Staff-role probe opened Historical as Lab/importer and independent verifier; application requests stayed on localhost. Native cutover/recovery cluster55461 was cleanly stopped after verifying no other client sessions; all databases/files remain. The five-service Docker sandbox remains running at **https://localhost:18443** for authorized local synthetic testing. Self-signed test TLS is not hospital TLS trust or LAN acceptance.

All13 generated Linux secret/key files are UID/GID1000 mode0440; data/key/secret directories0750 and backup output0700. Actual Web/Worker/Renderer are nonroot/read-only. Production audit refreshed0, development5 HIGH; registry latest remains eslint-config-next16.4.0/braces3.0.3. Those development modules are absent from all three runtime images, a verified mitigation rather than vulnerability resolution.

The local workflow now includes the13 Node deployment regressions in future CI, and that exact command passed. This CI-only change and final report/ledger edits follow the signed image source; application, migration, deployment and tool code remain identical to the installed source. No P8 push, remote branch, PR, merge or GitHub CI run is claimed. Source guard500 files and all17 local report links passed. Full details/artifacts are retained under ignored `.local/p8`; signing/encryption credentials and generated datasets are not committed.

Synthetic Staff UAT inputs are prepared in `.local/p8/installed-uat`:18 blank records plus five-row CSV/PDF-ZIP fixtures with duplicate LN, cutoff-day and PDF identity negatives and file hashes. Expected outcomes are labelled test expectations, not staff results; synthetic policy activation must remain separate from actual cutoff/anchor approval. Start with the current installed sandbox, not the stopped native rehearsal cluster. Clinical Pilot/Go-live remains **NOT PASS / HOLD**, and phase status remains **P8 PARTIAL** for the genuine external constraints in the gap register.
