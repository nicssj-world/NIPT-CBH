# Architecture and source authority

Approved implementation basis: Plan v6.2.1 + latest AL-1 Lock Record + Consolidated Owner Decision + P1 Start Order (2026-10-11). The Start Order and current Owner request supersede earlier “P1 pending” statements. Originals were read in place and remain unchanged; source hashes are recorded in `source-register.md`.

The architecture, Task List and HALOS audits were reviewed as evidence, with the Baseline Supersession Index controlling stale audit recommendations. In particular: partial batches permitted; HALOS nominal Sheet1 A1:E48 /47 data rows/no Row49/no Barcode13; PC+NC count and Blank exclusion; EB Buffer; installed MGISP-100 script baseline. A26 is a pre-use defect according to Owner, not a claim of past patient harm. These clinical/formula/HALOS decisions are preserved as downstream contracts, not activated clinical calculations in P1.

## ADR implementation disposition

| Foundation decision | Implementation |
| --- | --- |
| Single LAN system | Root Next.js app, internal Node worker/renderer, PostgreSQL, Caddy/OCI; no separate NIPTY process |
| Self-hosted data/auth | PostgreSQL, Argon2id, hashed server sessions; no external auth or cloud data service |
| D-15 | Tailwind CSS 4 PostCSS build; self-hosted fonts |
| D-38/round lineage | Current-round composite FK and status derivation; repeat same specimen, redraw new round/same LN |
| D-49 | Shared transaction advisory LN lock for registration and PET application; identity conflicts fail closed |
| D-50 | Versioned cutoff setting with impact digest/effective date; historical entry/promote unavailable P1 |
| D-51 / OD-24 | All-impact A/AA axe harness, negative detector fixtures, responsive snapshots, ACR template; manual acceptance remains evidenced separately |
| Settings/secrets | Versioned draft/test/approve/activate/archive, new revision rollback, immutable payload, audit; public-key-only web secret sealing |
| Files/jobs | Hash-addressed staged/fsynced atomic immutable publication, outbox + pg-boss receipts, epoch cancellation and durable reconciliation |
| Release operations | Signed exact file-set + image IDs; separate trusted verifier/key; no-pull install; forward checksummed migrations; encrypted backup/new-DB restore |

## Boundaries

Web holds the integration public key only. Private decryption/identity/backup keys remain outside Git and release archives; the simulator does not need HIS credentials. Web/worker PostgreSQL roles are separated and no app login has migration-owner privileges. Renderer receives controlled synthetic snapshots over authenticated internal HTTP, blocks page JS/network and has bounded memory/CPU/pids. Docker Chromium currently requires `--no-sandbox` inside this isolated, non-root, read-only container; hospital hardening approval is a later gate.

Audit uses sanitized structured vocabulary and hashes. Separate immutable PHI access journal stores authorized case IDs/actor/purpose; a hash-chained aggregate access event records actor/purpose/count (individual journal rows are not cryptographically bound). The 2026-10-24 Owner lock grants APP_ADMIN explicit system-wide case, document, released-result and workspace read actions through a classified allowlist; the role name alone grants no unclassified patient access. HIS inbound identifier visibility remains tied to `intake.link`, and manual result linking remains separately controlled. Runtime requires synthetic mode; actual certification, historical promotion and clinical publication fail closed.

Migrations 001–005 retain the reviewed P1 foundation. Migration 006 adds the restricted synthetic P2 model; forward migration 007 strengthens consent document uniqueness and final evidence binding. They do not activate clinical registration, worksheet engines, result import/certification or live receivers. Unique constraints requiring later OD decisions remain outside this scope.

## P2 restricted synthetic extension

Owner record `NIPT-CBH-AL2-20261012-001` and the P2 Synthetic Start Order dated 2026-10-12 authorize the bounded P2 extension. This later decision supersedes the original proposal's Pending wording, while preserving AL-1 and all clinical/document controls. See [p2-governance.md](p2-governance.md) for unresolved authority and acceptance.

The shared registration service and transaction LN lock serve ANC and LAB_DIRECT; LN+HN identity matching preserves leading zeros. P2 identity evidence is distinct from the older P1 synthetic fixture key: an unverified legacy pair cannot silently acquire new verified identity. Registration does not receive a specimen or allocate an LN Halos.

P2 owns versioned per-round drafts, immutable Request/Consent snapshots, paper review history, collection-source evidence, synthetic doctor versions and signing evidence. Clinical assessments record a rule version and retain PendingData/PendingClinicalReview/ClinicalDataConflict or synthetic negative blocked states. There is no approved clinical pass path. Request and Consent modes are independent; paper selection is not verification.

Patient simulation uses an expiring, document-bound HttpOnly capability cookie. Staff APIs cannot acknowledge, choose consent or submit a patient signature. During handover the preparer's server session is suspended across tabs; return requires the same preparer's password and attestation. The server derives PNG/hash from bounded synthetic signature vectors. Final immutable consent evidence includes the acknowledgments, decision, signature, doctor/template version, session and preparer attestation.

Signing permits one active session and one signature/final consent per document. Finalization rechecks current round, revision, workspace, mode and revocation under serialization. A completed signature that becomes stale remains historical evidence; the preparer may return safely without creating a new finalized Consent. The database compares final acknowledgment identities/timestamps and signature/session/template evidence with their source rows. New final rows declare `PG_JSONB_CANONICAL_V1`: recursively sorted object keys under PostgreSQL C collation, retained array order and JSONB scalar text, with SHA-256 computed and verified in SQL. Existing JavaScript canonical hashes retain `JS_CANONICAL_V1`; verification must use the declared algorithm.

Patient capability operations and preparer return discover their immutable binding without locking it, acquire the case row, then reselect and lock the signing row before validating or mutating it. Retry and case mutation use the same case-before-signing order. Native concurrency tests cover expiry retry, patient completion/cancellation and return in both acquisition orders, including an in-flight completion crossing expiry.

The existing internal renderer adds controlled synthetic Request/Consent A4 rendering. P2 previews use session-bound expiring memory and per-read authorization/access logging, never permanent Result PDF storage. Locked document identity/template and stored doctor signature remain stable; all output says NOT FOR CLINICAL USE / SYNTHETIC. P1 Result PDF and HIS wire modules retain their existing architecture.

W0/W1 withdrawal appends revocation and PendingGovernance evidence, invalidates signing and holds future P2 work. It preserves original documents/results and performs no HIS void or deletion. Later withdrawal stages and actual clinical operations remain governed downstream work.

## P2–P3 synthetic integration

The P3 synthetic HIS inbound build (scanner, matcher, conflicts, health) is integrated with P2 registration on the same synthetic boundary. Migration 008 is the P3 inbound schema (renumbered from 090 with an unchanged body) and migration 009 records the blind-entry identifier source on `registration_attempt`. P3 runtime grants are part of `packages/db/roles.sql`.

`registerP2` calls `linkIntakeAtRegistration` inside its own transaction after the case is created or reopened, under the shared LN advisory lock (D-49). The hook takes the authenticated principal. The caller's HN is only a cross-check: it must equal the case's immutable `p2_case_identity` HN and the stored `identityLookup(JSON.stringify([normalizedLn,hn]),key)` digest, and the actor must have case-read scope for the case's unit. Matching then reads the same stored P2 identity the worker reads (`p2IdentitySource`). A case without P2 identity, such as a P1 `SYNTHETIC-ID` digest, is `IDENTITY_UNVERIFIED`, and LN equality never upgrades it. Registration and linking commit or roll back together. A waiting intake whose bytes cannot be read fails registration closed. A same-key replay is idempotent, while a replay with a different unit or identifier source is a conflict.

Lab blind entry (§4.7 L2–L3) offers a presence-only probe (`POST /api/p2/intake-presence`, Lab registration permission, audited). It answers only whether an unlinked intake waits for an LN that has no case. LAB_DIRECT registration requires `TUBE_LABEL`, `REQUEST_FORM` or `PATIENT_DOCUMENT`. After entry, the registrant sees only the outcome and the names of differing fields, never HIS values.

S1 receipt writes HIS `P[21]` to `received_at` and HIS `P[23]` to `specimen_round.collection_date`, beside P2 collection facts and never over them. A disagreeing declared source records `COLLECTION_PROVENANCE_CONFLICT` (source names only), and P2 evaluation then reports `ClinicalDataConflict`. The worker reads only `p2_case_identity(case_id,hn)` and the `p2_collection_fact` date columns, and never writes P2 evidence or rounds ≥ 2. Worker apply takes the LN lock, then the intake, `case_ln`, round and case-row key-share locks; it never takes signing rows. Native tests run P2 autosave and case-before-signing against a concurrent worker apply in both acquisition orders without deadlock. See [p2-p3-integration-review.md](p2-p3-integration-review.md).
