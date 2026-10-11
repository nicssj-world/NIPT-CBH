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

Audit uses sanitized structured vocabulary and hashes. Separate immutable PHI access journal stores authorized case IDs/actor/purpose; a hash-chained aggregate access event records actor/purpose/count (individual journal rows are not cryptographically bound). Authorization does not grant Admin automatic patient visibility. Runtime requires synthetic mode; actual certification, historical promotion and clinical publication fail closed.

Five forward migrations implement foundation tables only. Unique constraints requiring later OD decisions are intentionally absent. Full clinical registration/forms, worksheet engines, result import/certification and live receivers belong to later phases.
