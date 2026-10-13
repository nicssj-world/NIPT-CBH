# P6 Integrated Synthetic Implementation Plan

> Execution: superpowers:executing-plans, inline in the existing P6 worktree.

Goal: exercise durable local sandbox outbound end to end without clinical release/publication authority. Specification: Owner continuation order (2026-10-13), v6.2.1 §10, existing P6 contract-review and integration-holds. Local/on-premises only.

Preflight: clean adc64e1; remote main exactly bd50f16; fetched and merged as 42079c7 without conflicts; adc64e1 preserved. No newer remote commit required impact triage. Main/P4b/P5/Integration worktrees unchanged. Migration bands 001–018 and 050–051 inspected; new additive migration 060 reserved for P6. No existing migration changes.

Architecture: separate explicitly synthetic fixture registry and durable P6 transfer journal, with no P5 release FK/row fabrication. Fixture enrollment is test-tool-only under a dedicated DB role, unavailable to web and worker roles. Production read adapter queries actual P5 authority and always remains held while AL-5/AL-6/outbound channel are unresolved. Workers receive IDs only, read immutable registered fixtures, reserve N atomically and persist proof/checkpoints/audit. File transport accepts a sandbox ID only, resolving beneath this application's `.local/p6-sandbox`; never a caller-provided absolute/network root. Existing worker gets one opt-in P6 cycle hook; no existing job semantics change. Operations workflow is CLI/service-level, no UI added.

1. [x] Journal/migration/role boundary: PGlite red→green for immutable fixture/plan/events, atomic/idempotent reservation, sequence/collision, P5 authority HOLD. New `db/migrations/060_p6_outbound_synthetic.sql`, `packages/p6/journal.ts`, `packages/p6/grants.sql`, `packages/p6/release-boundary.ts`; update only P6 boundary tests for pure-vs-I/O module distinction.
2. [x] Local sandbox transport: strict component validation, parent/reparse checks, exclusive complete-byte publication/readback, original PDF/RES + backup manifest + exclusive OK. New `packages/p6/sandbox.ts`; injected failures, collisions, symlinks, invalid mode/path tests. No real path flags/defaults.
3. [x] Durable worker/operations: per-transfer session lock, durable step checkpoints/recovery, pure model reuse, retry schedule/timeout, synthetic evidence/reconciliation, immutable history and health. New `packages/p6/worker.ts`, `tools/p6/sandbox-workflow.ts`, `tools/p6/fixtures.ts`; minimal opt-in hook in `packages/jobs/worker.ts`. No renderer or clinical API.
4. [x] Native PG17 isolated sandbox tests: reservation/concurrent retries, crash/restart replay, failures at file boundaries and checkpoint gaps, post-OK cancellation, role denial, no release rows. Existing actual worker smoke with P6 opt-in. New `tests/contracts/p6-native.test.ts` and support harness.
5. [x] Verify existing 492 RES + seven naming goldens, P6/unit/native/combined regressions, typecheck/lint/guard/build/dependency audit. No Playwright needed without UI; document actual worker/CLI workflow tests instead. Read-only review and final scope/checksum audit; commit only P6 branch, no push/merge-to-main/deploy/PR.

Review focus: rollback after filesystem success; .ok ambiguously present after crash; spoofed fixture/clinical authority; two workers and cancellation while locked; symlink/hardlink/config aliases; collision across settings/rounds; unavailable authority/query; no patient-bearing logs. Backup-before-OK is the approved synthetic sequence only; real IT ordering/retention/ACK/P[23]/R[10] decisions remain HOLD.

## Completion ledger

Tasks 1-5 complete within synthetic scope. Native PostgreSQL 17.11 tests, fresh non-superuser role boundaries, full combined 1760-pass regression and Playwright CLI E2E are recorded in integrated-delivery.md.

Rulings: add the second minimal shared prepare-db grant hook so standard isolated setup installs P6 privileges; use Playwright CLI E2E to cover the new workflow without inventing a UI; use exact local dependencies after Turbopack rejected the old junction. No package manifest changes.

Reviewer fixes: row-lock final OK fence, fresh locked worker checkpoints, post-confirmation cancellation reconciliation, deterministic BigInt-verified staging-twin recovery with true process-exit tests. No unresolved critical or important review finding.

Outside-scope: five high dev dependency audit findings and three existing Next tracing warnings remain recorded, with no dependency or prior-phase changes. AL-5/AL-6, clinical schema/publisher/operational HIS UI and actual receiver acceptance remain HOLD.
