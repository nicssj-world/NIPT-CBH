# P1 Foundation delivery record — 2026-10-11

Scope: approved Plan v6.2.1/AL-1/P1 Start Order. Source implementation is complete for restricted synthetic foundation; downstream clinical workflows and external/user acceptance are not claimed. No production deployment/migration or real HIS access.

## Delivered modules

Root Next.js16/React19/TypeScript/Tailwind4 app; security/auth/session/RBAC/envelope; PostgreSQL registration/schema/audit/roles; settings/cutoff; domain gates/status/idempotency; immutable storage; integration PET/RES/scanner/safe publisher; durable jobs/heartbeat/reconciliation; isolated Thai PDF renderer/cache; responsive design system; simulator; signed OCI/offline/backup tooling and CI.

Read-only inspection of both actual ZIPs, selected-source comparison and Hermes prototype assessment are recorded in `legacy-mapping.md` and `source-register.md`. No raw legacy source, patient payload or credentials copied. 67 matching source/config/template paths are identical; the full archives differ in size/content and were not assumed interchangeable.

## Executed verification

Final results are recorded below after the release verification run. Local verbose logs and raw browser traces remain gitignored; only sanitized results/source/synthetic screenshots are committed.

| Check | Result |
| --- | --- |
| TypeScript / ESLint zero warnings | PASS |
| Unit/permission/domain/PostgreSQL/contract suite | PASS17files /813tests, including permission,domain invariants and native integration |
| Native PostgreSQL multi-client registration | PASS:8 independent transactions,1created/7opened,one LN |
| Native worker | PASS singleton,outbox→HTTP renderer→hash asset,heartbeat,actual retry,cancelled-before-dispatch/no-effect |
| Native PET | PASS ANC/LAB_DIRECT S1,idempotency,unlinked queue,late changed PET after redraw conflict,rounds unchanged; rollback cleanup |
| Native Windows browser | PASS8tests incl4viewports,axe all impacts,session/CSRF/admin scope,session-bound identical PDF and cross-session403,negative minor/moderate fixtures |
| Docker HTTPS browser / least privilege | PASS8tests with Linux container services,web role nipt_web,worker heartbeat; Windows visual baseline not applied to Linux containers |
| Production build | PASS; native/dynamic file-trace warnings documented, tracing exclusions and Docker context exclude local secrets; no key/env found in standalone output |
| Encrypted native backup / empty restore | PASS: isolated empty restore,5migrations/3cases/40audit entries,valid hash-chain and2referenced assets verified |
| Production dependency audit | PASS0 vulnerabilities;5 high dev-only transitive braces/ESLint advisories have no available patch at this run; excluded from runtime images |
| Static UI detector | PASS0 findings |
| Public source guard | PASS; excludes ZIP/PHI/keys/data/env; final staged review required |
| CI workflow | Added; GitHub execution evidence is reported separately after push |

Independent domain review and final whole-branch review found receipt provenance, role grants, settings audit, migration ordering, storage atomicity/concurrency, reconciliation durability and rollback/bootstrap issues. All confirmed source findings were corrected and scoped rechecked; final reviewer found no remaining confirmed critical source defect. Reviewer-only checks5files/11tests passed, separate from full-suite counts.

## Migrations

`db/migrations/001_foundation.sql`, `002_security_settings.sql`, `003_web_foundation.sql`, `004_integration.sql`, `005_phi_access.sql`. Five forward checksummed migrations, immutable ledger verification. Applied only to disposable native/Compose synthetic databases and fresh test databases; **not applied to Production**. `packages/db/roles.sql` is an owner-controlled least-privilege preparation script, not an app migration.

## Acceptance boundaries

P1 is a working synthetic foundation, not a clinical release. Formal Linux cold-cache host acceptance, hospital RPO/RTO, manual all-SC/NVDA ACR, visual owner approval and actual ANC/Lab usability signatures remain separate evidence; no signature or acceptance is fabricated. See `accessibility.md`, `operations.md`, `next-phases.md`. Original UQ thresholds and AL gates remain unchanged.

Git commit and remote SHA are recorded in the final handover response (avoids self-referential commit hashes). No force push or nested repository.
