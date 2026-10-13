# P1 Foundation implementation ledger

Authority: Owner P1 start order 2026-10-11; Plan v6.2.1 plus AL-1 and its supersession index. Synthetic data only. AL-2–AL-8 remain open; no production deployment.

The application is at repository root as explicitly ordered. Worker, renderer, domain, database and UI packages remain separate modules in the same repository and one NIPT CBH application. Legacy NIPTY is an immutable compatibility reference, never a runtime dependency.

| Work package | Contract | Verification |
| --- | --- | --- |
| Domain/schema | Current round owns status; S1-only HIS; redraw keeps LN; repeat keeps specimen; history immutable | Domain, permissions, database negative tests |
| Auth/settings | Local Argon2id; server sessions; scoped deny-default policy; write-only envelope secrets | Auth, CSRF, matrix, settings tests |
| HIS/files/jobs/PDF | Actual archive wire contract; simulator-only transfer; immutable bytes; pg-boss worker; isolated Chromium | Contract, retry, cancellation, PDF tests |
| Web/design/offline | Thai-first tokens; responsive foundation screens; offline assets; signed bundle tooling | Typecheck, lint, browser/axe, build |

Ruling: no Hermes files are copied verbatim. Inspection found a mismatch between its TypeScript HIS-order rule and SQL rule, and an unconstrained current-round foreign key. Build a reviewed foundation from the approved contracts.

Ruling: source authority takes precedence over stale P0 'not authorised' text; the later explicit P1 start order and this session authorise implementation and push to main.

Ruling: Foundation implements restricted contracts, not downstream clinical workflows. No setting or runtime flag may enable real PHI, real HIS, clinical certification or release in this P1 build.

## P2 extension — 2026-10-12

The P1 record above is historical. Owner lock `NIPT-CBH-AL2-20261012-001` and the later P2 Synthetic Start Order authorize the restricted P2 extension. Full clinical AL-2 acceptance and AL-3–AL-8 remain separate gates.

P2 implementation and final verification are recorded in [p2-delivery.md](p2-delivery.md), with source authority in [source-register.md](source-register.md), forward migration checksums in [migrations.md](migrations.md) and outstanding decisions in [p2-governance.md](p2-governance.md). No P1 wire contract or Production release authority is changed by this extension.

## P4b continuation — 2026-10-13

Executed the session-authorized Pooling → QC2 → F4 → immutable Pool snapshot milestone in the existing P4b worktree, after safely merging P4 main. Separate calculation/service/document modules reuse P4 evidence and transaction/security contracts. Additive migrations 011–013 and Unit/DB/native/contract/browser tests are described in [p4b-pooling-delivery.md](p4b-pooling-delivery.md). Owner-dependent operations remain HOLD; simulation artifacts never establish AL-4b acceptance. HALOS contract is preserved; PR #2 stays draft and unmerged.

## P4b DNB / sequencing continuation and Owner parity lock — 2026-10-13

DNB/QC3, G50/QC4, F5 and stored-source HALOS handoff simulation continue on the same P4b branch/Draft PR #2. Additive014–018 close lifecycle/verification/currentness SQL boundaries. See [delivery](p4b-sequencing-delivery.md), [Legacy Functional Parity Matrix](legacy-functional-parity-matrix.md) and [P5 integration contract](p4b-p5-integration-contract.md). One NIPT CBH runtime only; P5 worktree/PR #5 remains separate,050 reserved. Restricted synthetic outcomes do not establish AL-4b or clinical/Production acceptance.
