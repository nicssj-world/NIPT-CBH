# HIS Settings integration delivery — 2026-10-14

Status: **READY FOR INTEGRATION PR — synthetic/authorized test scope only**. Local branch `integ/his-settings-functional`, existing worktree `D:\Claude workspace\NIPT-CBH-HIS-INTEG`, baseline `7c63a2a`. No push, merge, new worktree, Windows Package work or hospital-share access was performed during the resume. P8 checkout remains clean at `7967cd5`.

## Delivered functionality

Existing Settings revision/RBAC/Maker-Checker/audit, PET/OK discovery/parser/deduplication and P6 serializer/journal/publication/Backup/Retry/Recovery are reused. Settings now controls authorized local/UNC test paths, credential reference, result style, retry delay/limit and timeout. The real Worker reads active configuration and checks its revision/fingerprint; configuration changes cancel stale pre-delivery work or retain reconciliation after delivery. Final OK publication is fenced against concurrent activation.

Worker-driven draft/active connection tests report path, account, ACL and file errors. Settings exposes test results, transfer status/history/error and permission-gated retry. Inbound is read-only and requires a successfully parsed synthetic PET/OK sample. Migration083 adds physical source identity without weakening relative-path validation or global byte deduplication. No second Settings-bound transfer engine or legacy transfer application was added.

`p5_release_authorized()` and Clinical Publisher remain closed. Historical outbound remains forbidden; unreleased P5 results have no outbound adapter. OK/pickup/synthetic confirmation never means HIS confirmation.

## Actual verification

| Check | Actual result |
| --- | --- |
| Previously reported focused regression | 54 passed; inspected prior result and corresponding tests, not treated as missing implementation |
| Resumed focused regression | **55 passed, 5 files**; original set plus Windows UNC/drive-root containment regression |
| Full `npm test` | **1869 passed, 49 skipped; 68 files passed, 16 skipped; zero failures** |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, zero warnings |
| `npm run guard` | PASS |
| `git diff --check` | PASS |
| `npm run build -- --webpack` | PASS; optimized build and tracing completed after replacing the dependency junction with independent local dependencies |
| Native development web + real PostgreSQL/Worker | PASS; `.local/his-native-WdmaWT/evidence.json` |
| Native compiled web + real PostgreSQL/Worker | PASS; `.local/his-native-BTp5x1/evidence.json` |
| Read-only review | All identified important findings fixed; final review found no remaining important issue |

Fresh resumed logs are `.local/his-resume-focused.log` and `.local/his-resume-full-tests.log`. Focused command: `npm test -- tests/db/his-settings.test.ts tests/unit/his-paths.test.ts tests/db/p6-workflow.test.ts tests/unit/p6-sandbox.test.ts tests/contracts/p6-transfer.test.ts`.

Native evidence covers browser Save → Worker Validate → independent Approve → Activate, active inbound scan, configuration/path changes, actual Worker process restart, PET/OK duplicate protection, real Worker RES/PDF/OK/Backup, cancellation of old outbound configuration, new destinations, browser status/history, axe and database least privilege. Windows ACL denial/restoration, junction/hardlink refusal, invalid sample rejection, pre-checkpoint recovery, retry/backoff and transient destination failure are exercised by the focused tests. The native harness uses isolated local directories and its own loopback PostgreSQL cluster; it shuts down its own processes and retains artifacts.

Compiled-web evidence uses `next start` with the normal build tree; Next emits its standalone-start advisory. This proves the compiled application flow, **not** a Windows installer or isolated standalone-media runtime. Opt-in suites skipped by `npm test` are not counted as passing; the separate native harness is independent evidence.

## Remaining external/merge acceptance

- Hospital LAN Acceptance: **NOT RUN**.
- UNC/SMB endpoint, domain service credential/reconnect and actual share publication/durability acceptance: **NOT RUN**. Lexical UNC containment tests are not SMB endpoint acceptance.
- Clinical Production Integration: **HOLD / NOT AUTHORIZED**. No patient files or hospital Production shares were read/written.
- During resume, `origin/main` was already at `53482f0` (P4 monthly LN sequence), one commit after this worktree baseline. Its six changed paths are disjoint from this HIS diff; it adds migration082 before this migration083. No merge/rebase was performed. Verify the combined target and exact-head CI after separately authorized integration, before merge/release.
- No functional issue remains identified within the tested synthetic scope. IT must provision the deployment-owned Allowed Root policy, test marker, account/ACL and credential reference; an editable Settings path does not authorize a new share.

## Windows Offline Installer impact

P8/Packaging files and artifacts are preserved. No package build, installer changes or package release occurred during resume. After separately approved source integration, the package needs a rebuild/signing and install/upgrade/rollback smoke with migration083, reviewed P6 grants and Worker policy environment/service-account provisioning. No runtime dependency was added. Keep authorization policy and credentials outside installation media; do not seed hospital paths or enable Clinical Publisher. Full external-share disaster-recovery/archive acceptance and installer acceptance remain separate work.

Implementation details and operator setup: [HIS Settings integration](his-settings-integration.md).

## Changed files

The local commit contains only the following HIS implementation, migration, verification and documentation files:

- `db/migrations/083_his_source_identity.sql`
- `docs/his-settings-delivery.md`
- `docs/his-settings-integration.md`
- `docs/legacy-functional-parity-matrix.md`
- `docs/p5-settings-coverage.md`
- `docs/p6/integrated-legacy-parity.md`
- `packages/inbound/connection-test.ts`
- `packages/inbound/cycle.ts`
- `packages/inbound/discovery.ts`
- `packages/inbound/source.ts`
- `packages/integrations/authorized-share.ts`
- `packages/jobs/his-retry.ts`
- `packages/jobs/his-settings-test.ts`
- `packages/jobs/his.ts`
- `packages/jobs/worker.ts`
- `packages/p6/grants.sql`
- `packages/p6/sandbox.ts`
- `packages/p6/transfer.ts`
- `packages/p6/worker.ts`
- `packages/settings/catalog.ts`
- `packages/settings/coverage.ts`
- `packages/settings/fields.ts`
- `packages/settings/his-monitoring.ts`
- `packages/settings/his.ts`
- `src/app/api/settings/his/route.ts`
- `src/app/api/settings/route.ts`
- `src/components/his-settings-status.tsx`
- `src/components/settings-editor.tsx`
- `tests/db/his-settings.test.ts`
- `tests/unit/his-paths.test.ts`
- `tools/his/verify-native.ts`
- `tools/p6/sandbox-workflow.ts`
