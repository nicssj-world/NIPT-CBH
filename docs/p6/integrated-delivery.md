# P6 integrated synthetic delivery — 2026-10-13

Status: durable **integrated synthetic workflow implemented and tested** on local sandbox/PostgreSQL; clinical publisher remains disabled. AL-5 and AL-6 remain HOLD. No HIS/HALOS/CFS/LAN endpoint was contacted; no patient files, P5 CertifiedReleased state or result_release rows were created. No local Production deployment, push, merge-to-main or PR creation.

## Preflight / sync / scope

Continued existing `D:/Claude workspace/NIPT-CBH-P6`, branch `feat/p6-outbound-contract-synthetic`, from `adc64e120d1d34903d4e060007bb794201c85010`. Remote main was exactly `bd50f160dfd09654a348062f8aed0e488a609361`. Fetch and the expressly authorized merge of main into P6 produced `42079c7710b3e8275ec26960a2a01c1970b8f3b9`, without conflicts. Prior P6 commit/goldens/files are preserved; other worktrees and local main were not changed.

Only two existing shared source files receive minimal integration hooks: `packages/jobs/worker.ts` calls the P6 cycle when `NIPT_P6_SANDBOX_ENABLED=yes`; `tools/prepare-db.ts` applies additive P6 grants after existing roles. No P1–P5 business logic, release function, old migration, outbox job semantics, settings catalog, renderer, UI, architecture or dependency manifest/lockfile was changed. Existing pure transfer.ts gained durable write-intent and unexpected-OK observations; pure serializer/goldens are unchanged.

## Implementation

| Deliverable | Actual behavior / evidence |
| --- | --- |
| Additive migration 060_p6_outbound_synthetic.sql | Separate p6_fixture, p6_transfer, immutable p6_transfer_event/p6_reconciliation and p6_worker_heartbeat. All transfers explicitly SANDBOX_FIXTURE_ONLY; clinical_release_id must be NULL; model never claims HIS confirmed. No FK or fabricated P5 release |
| Fixture enrollment boundary | Deterministic fixture factory exists only in tools/p6. Dedicated NOLOGIN p6_fixture_writer role for trusted isolated setup; actual native non-superuser fixture login used for tests. Web/worker roles can read fixtures but cannot create or change them. No web route or P5 asset-to-fixture fallback |
| Atomic reservation / N | Transaction advisory lock per sandbox/original LN/generation plus DB unique keys. Twelve concurrent native connections obtain one ID/N. Same version reuses frozen payload; changed bytes reject; new revision/round advances N. Sandbox identity namespaces independent synthetic runs; original LN/generation remain the export key within that sandbox |
| Frozen journal | Original PDF/RES bytes, profile/settings hashes, names, report-version/round/attempt and epoch frozen; immutable plan/fixture, append-only step events/audit. Optimistic operator checkpoints reject stale revision; worker checkpoints resolve concurrent controls under a fresh row lock |
| Local file transport | Fixed application-root .local/p6-sandbox/<SYNTHETIC-id> only; no caller root or network path setting. Synthetic lexical paths, marker, checked ancestors/reparse points, device-name/case-alias checks, no external hardlinks. Temporary fsynced complete bytes, exclusive hardlink publication, byte/hash readback; no overwrite |
| Approved synthetic order | PDF verified → RES verified → backup PDF/RES/manifest verified → exclusive two-byte OK → post-OK epoch check → AwaitingConfirmation. R[3]/RES/PDF naming uses preserved pure contracts |
| Native process recovery | Per-transfer session advisory lock on one connection across separately committed checkpoints. Durable WRITE_STARTED precedes I/O. Proven pre-OK staging twins recover only with deterministic fingerprint/destination identity, exact BigInt inode/device, two-link count and expected hashes; only owned staging names can be removed. Final artifacts are never deleted. Ambiguous OK twins/checkpoint loss require reconciliation |
| Cancellation fence | Final fresh gate read and OK publication/readback share a DB row lock with cancellation. Cancellation committed before that check prevents OK. Requests arriving after it serialize behind publication and create reconciliation; post-OK and post-confirmation withdrawal reopens HOLD. No stale checkpoint can overwrite a concurrent terminal HOLD |
| Queue / retry / timeout | Existing worker opt-in cycle consumes durable P6 IDs, never P5 release payloads. Competing workers use native session locks; retry/backoff/deadline and bounded attempts persist. Exact artifact reuse, no recertification/new N. Unknown/ambiguous delivered state never resends. Polling prioritizes ready work and does not silently truncate the queue |
| Confirmation / reconciliation | Pickup unconfirmed; timeout UnknownTimeout; correlated synthetic ACK/operator/query evidence yields SYNTHETIC_CONFIRMED with hisConfirmed=false. Immutable operator investigation records OBSERVED_SANDBOX_DELIVERY/NO_DELIVERY/KEEP_HOLD; evidence never authorizes replay or removes files |
| History / monitoring / operations | CLI enrollment, worker cycle, status, history, cancellation, synthetic confirmation/reconciliation; coded events, hash-chain audit and heartbeat. Multiple queued fixtures handled in the same cycle. No new UI/API |
| Actual P5 authority boundary | readClinicalOutboundCandidate queries actual integrated p5_release_authorized() and fails closed on false/unavailable. ANC-view explicitly rejected; even a test-only hypothetical HIS channel remains AL-6 HOLD. Function returns never; no publish side effect |

NIPT_P6_SANDBOX_ENABLED is not clinical authorization. It only enables the fixture journal's local sandbox worker. Existing P1 simulator capabilities remain unchanged and are not repurposed as a clinical publisher.

## Verification evidence

Tests use disposable in-memory PGlite and a dedicated PostgreSQL 17 Docker container published on **127.0.0.1 only**, with PG data under this P6 worktree's ignored synthetic sandbox. Every native/CLI E2E run creates a fresh nipt_p6_synthetic_* database. No shared session DB URL/environment file is loaded. Actual non-superuser fixture/app/worker privileges are exercised.

| Check | Result |
| --- | --- |
| Original P6 byte parity | 492 RES goldens + seven PDF naming goldens preserved; byte-exact UTF-16LE BOM/CR/R[3] and property tests retained |
| Focused native PG17 | 33 passed: 12-client reservation, six worker competitors, idempotent N/inode, 20 artifact×file-point failures, pre-/post-OK withdrawal, final-gate interleaving fence, four abrupt process.exit hardlink crashes, pickup/timeout/CLI history/evidence, actual application worker, roles/audit/ledger/HOLD |
| PGlite workflow | Nine passed including pre-publication withdrawal, recovery before checkpoint, ambiguous OK and post-confirmation withdrawal |
| Playwright CLI E2E | 1 passed, actual CLI processes and isolated roles through complete new workflow. CLI/service E2E, not browser/clinical UX acceptance |
| Final combined Vitest regression | **1,760 passed; 14 skipped**, 55 passed files / 13 skipped files. Includes all 598 P6 tests (546 preserved pure + 33 native + 5 journal + 9 workflow + 5 transport), no P6 skips. Other phases' optional native/legacy tests were not enabled and are not claimed passed |
| Typecheck / full ESLint / source guard | npm run typecheck / lint / guard: PASS; zero lint warnings/errors, source guard 407 files |
| Next.js build | PASS with local dependencies; three tracing warnings in unchanged PDF-preview/secrets routes recorded outside scope |
| Dependency audit | Production: 0 vulnerabilities. Full audit: **5 high dev dependency findings** in existing eslint-config-next → fast-glob/micromatch/braces chain (GHSA-vfj7-8cjw-p6xm). Not fixed; manifests/lockfile unchanged |
| Diff / prior migrations | Only additive 060; previous migrations/P5 source/package manifests unchanged versus bd50f16. Original pure serializer/golden bytes unchanged versus adc64e1; final staged whitespace/scope check PASS |

Red→green evidence includes terminal-confirmation withdrawal, before-OK cancellation, native stale-checkpoint interleaving and reviewer-discovered hardlink crash window. An early combined run failed the new final-gate test with STALE_TRANSFER; the atomic worker checkpoint fixed it. Final combined regression above supersedes that result. An initial build failed because the prior node_modules junction escaped Turbopack's root; the junction was removed non-recursively and npm ci installed exact locked dependencies inside P6 without touching main's dependencies. No Next configuration/package update hid the issue.

Read-only review found no unresolved critical/important issue after the row-lock publication fence, fresh locked worker checkpoints and deterministic staging-twin recovery fixes. Reviewer source inspection is distinct from tests executed by the implementation session.

## Remaining HOLD / before full P6 completion

AL-5 still blocks real P5 release creation. AL-6 still requires signed IT/HIS authority for paths/ACL/service identity/temporary files/durability, RES profile/escaping/length/DOB-sex/certifier mapping, ACK/query/operator procedures, retries/revisions/void/consumption semantics, backup ordering/retention/restore, OD-07 channels/PIC/templates, and round >=2 P[23]/second-result same-LN acceptance. Production adapter remains closed even if one authority field later changes; no setting reinterprets ANC-view as HIS permission.

Clinical released-result→publisher mapping, approved integrated clinical export schema, real endpoint transport, operational HIS-settings UI/single-bulk clinical export controls and witnessed LAN acceptance remain explicitly **DEFERRED/HOLD**, not implemented claims. Synthetic journal authority cannot be promoted into clinical transfer records. Reconciliation records synthetic investigation with replay blocked; authoritative receiver acceptance is absent.

- [Integrated legacy parity](integrated-legacy-parity.md)
- [Sandbox workflow runbook](sandbox-runbook.md)
- [Original contract review](contract-review.md) and [Owner/IT decisions](integration-holds.md)

Outside-scope findings retained only: dev dependency audit above; three existing Next tracing warnings; integrated P4b/P5 audit's clinical/QC/Stop-use gaps. No fixes in those phases/dependencies. No Production/HIS interface pass is asserted.

Migration SHA-256 (remove grouping colons): `27c64eba:1ce5bcf5:5b83d8e1:815095bf:6558529f:89237fdb:8f6a558a:9ab9cebe`. Native server version independently read as PostgreSQL 17.11. Migration was applied/reapplied only to isolated test databases. Changed files are the P6 modules/tests/tools/docs, migration 060 and the two minimal shared hooks above; the final commit's file list is authoritative. The dedicated test container is stopped after verification; ignored synthetic sandbox data is retained locally for inspection, not committed.
