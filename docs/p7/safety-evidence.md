# P7 clinical state and currentness technical evidence

Scope: restricted synthetic code at merged baseline `ad66ab401b0565ed0bd88fb73096ef6f0456a1ef`, with forward migration080. No clinical acceptance adapter, QC5 decision, release authorization or applied migration was changed.

## Changes

- An unconditional INSERT/entry-UPDATE trigger rejects `AnalysisComplete`, `FinalQcAccepted` and `Final`, including ordinary owner sessions. Its rejection is independent of role, settings and custom session variables. Ordinary P4 state transitions retain their existing guards.
- P5 reads the persisted report's exact attempt and active slot, latest Pool/snapshot/DNB/sequence lineage, persisted member/slot identity, Pool source validation, Stop-use/HOLD/supersession and F4/F5 recall. A sequence hold is scoped to the latest sequence ID. Negative upstream reasons are shown by RG06/RG07 before the closed clinical adapter can mask them.
- `current` describes inspected structural lineage only, not analysis completion, clinical approval or QC acceptance. No pipeline returns `current:false`; existing state/QC1 predicates explain absent progress. Clinical analysis/final acceptance are always false in the evidence reader, independently of state strings. The RG rule version is `P7-RG-CLOSED-CLINICAL-v2`.
- The permanent `p5_release_authorized()=false` guard and result release triggers remain independent.

## Focused checks run

1. Red: `npx vitest run tests/unit/p5-gates.test.ts` failed the new evidence regression because a bare `FinalQcAccepted` state incorrectly passed RG06 (`ANALYSIS_COMPLETE` instead of closed-adapter rejection). After implementation: 15/15 passed.
2. `npx vitest run tests/db/p4b-p5-integration.test.ts tests/db/p5-results.test.ts tests/unit/p5-gates.test.ts`: 27/27 passed, 3 files, 56.68 seconds. Real disposable PGlite services exercise a 47-member synthetic Pool, DNB, handoff and sequencing, exact linked report, current sequence Hold, replacement sequence without inheriting the old hold, F5 Stop-use/pending recall/confirmed recall, Pool Stop-use and zero result releases. Protected clinical INSERT/UPDATE rejection and independent direct result-release HOLD also pass. Initial new Stop-use test used an unauthorized staff actor and failed `FORBIDDEN`; corrected to the existing authorized certifier role.
3. Native PostgreSQL17.11: `NIPT_MODE=synthetic`, explicit `NIPT_P7_NATIVE_URL`, `npx vitest run tests/contracts/p7-safety-native.test.ts`: passed 1/1 on a fresh UUID-named database with all migrations and actual role grants. Owner/app_rw attempts to INSERT/UPDATE each protected state reject; ordinary Ready→Assigned→InProgress→Stopped works; AL5 stays false, zero clinical states/releases. An initial fixture omitted receipt and therefore had no attempt; receipt was added before the successful run.
4. Scoped ESLint on the changed safety modules, labels and tests passed. Whole-worktree TypeScript was attempted; concurrent parity changes had errors outside Task1, so no whole-worktree typecheck success is claimed here.

Native cluster: owned disposable local path `.local/p7-native/data`, loopback127.0.0.1 port55450, user `nipt_p7_synthetic`, trust authentication. No inherited `.env` files or external database were used. Per-test databases are removed; server stopped after verification, cluster files preserved for final controller verification.

## Limits

No clinical adapter or mutation race guarantee is claimed. Existing P5/P4b lock protocols require coordinated review before enabling clinical transitions. SQL owner/superuser administrative trigger removal is outside ordinary application-write enforcement. No production/hospital data, vendor import, QC5 acceptance, clinical validation, AL5 approval, deployment or user acceptance was exercised. Full-candidate regression and independent review remain controller work.
