# Consolidated parity remediation 1.0.1

This delivery implements the Owner-approved remediation prompt dated 19 October 2026. It is based on documentation commit 5598def, whose executable source tree matches installed release c57ced4. Main and the existing pagination worktree are preserved. All runtime verification uses disposable loopback PostgreSQL clusters and explicit local test identities. No Production/Hospital/HIS mutation, push, merge or deployment is authorized or performed.

## Confirmed defects and changes

| Item | Root cause / before | Implemented behavior |
| --- | --- | --- |
| D01 P1 | Shared manual-link/RG-04 cross-check omitted Lab Number | Both-present contradictory Lab Numbers block manual approval and release revalidation; missing value remains NOT_AVAILABLE under the original contract. Unique automatic matching is unchanged. |
| D02 P1 | Electronic acknowledgments referred to a synthetic summary | All 12 original DOCX clauses and declaration have stable IDs, content version and canonical hash. Prepared and final evidence retain exact text and per-clause provenance. Old acknowledgments are never promoted to the new content. Forward migration105 validates the same provenance and preserves original signing/session safeguards. |
| D03 P1 | Locked snapshots used the historical HTML renderer while preview used DCC originals | Newly issued operational snapshots freeze verified template hashes, mapped fields and stored doctor evidence. The existing original-PDF overlay path renders actual stored doctor/patient signatures. Historical revisions retain their original semantics/renderer. Unsigned evidence has no patient ticks, decision or signing date. |
| D04 P1 | Original DCC assets/registry were external to the offline release | Build verifies pinned original hashes and signs the originals plus release-relative registry into the package inventory. Provisioning and supervisor resolve the installed release bundle. No manual copying is required. |
| D05 P2 | Questions4/7/8 had different meanings | Labels and PDF mappings use the DCC meanings. Explicit semantic versioning requires changed questions to be answered again when editing a legacy draft; stored historical revisions remain unchanged. |
| D06 P2 | Confirmation and preview used different completion rules | Shared operational contract requires DOB, recognized entitlement, facility and testing reason alongside existing physician/pregnancy/history checks. Thai national ID is conditional on identifier type; passports are not printed into its box. Registry progress preserves scalar contract version and does not infer a legacy version. |

## ANC mapping and preserved boundaries

| Data | Contract and destination |
| --- | --- |
| LN HIS / HN | Registration/PET identity remains authoritative; frozen identity and result linkage use the original source contract. |
| Patient identification | Operational identifier choices mirror backend support. Only ThaiNationalId fills the DCC national-ID field. |
| DOB / entitlement | Required at operational confirmation; entitlement maps to NHSO/self-pay only when recognized. |
| Facility / reason | Required trimmed values shared by validation and DCC missing-field checks. |
| Physician | Existing approved Doctor Registry revision and stored signature are frozen; no per-case re-signing. |
| Pregnancy / collection | Existing type, EDD, date/source and clinical checks retained. Optional collection time, address and unresolved nullable fields are not globally made mandatory. |
| History4/7/8 | Current semantic contract binds explicit new answers; legacy answers are not reinterpreted. |
| Consent | Exact 12-clause text/hash/IDs in prepared and final evidence; patient signature from actual signing session; paper consent remains marker-only, with refusal and withdrawal retained. |

DCC status remains REFERENCE_NOT_DCC_APPROVED. A recorded signature does not change that status: rendered documents remain DRAFT / DCC NOT APPROVED. Existing clinical acceptance and Owner decisions remain in force. HIS file publication remains hisConfirmed=false; it does not establish an HIS acknowledgment.

## Native Task preview

Pre-work Task1-3 DRAFT now starts from the SHA-locked approved workbook and uses the existing native Excel bridge. Only recorded plan/slot values are filled; unknown inputs are truly blank. Each Task remains two A4 pages with a DRAFT watermark and no persisted issuance/workbook revision. Final workbook rendering, Master formatting, formulas, merges, print areas and page breaks are preserved. QC/Pooling/Sequencing retain one A4 page each.

Master SHA256: `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`. 316 bindings /149 formulas; QC F52 `=(D54*F54)/D52`, D55 `=F54-F52`.

Original request PDF SHA256: `c5b2bfce72f64ba80d06967575fd17364aa98bb5a37c5032d2d3dbaeedb9511b`.
Original consent PDF SHA256: `dc791bb8f40ccc0b895d4f9171f81950738cceb28b57bb056111b97f3c3f0332`.
Original consent DOCX SHA256: `79bfc2edb40c4d89b7a081da13cdc2004cf37991aaf55976790f441efca5fe9e`.

## Verification evidence locations

The ignored `.local` evidence is retained beside this checkout, not committed as clinical data. Final delivery in chat reports actual counts, installer hash/size and source commit after all required runs.

- `.local/validation/`: full Vitest JSON/log, Playwright logs, TypeScript, ESLint, source guard and build logs. Any initial invalidated/failed attempts remain available and are not described as successful.
- `.local/parity-remediation/dcc/`: request/unsigned consent/signed consent/combined PDFs and exact snapshot/signing provenance from disposable database tests. Actual original background, clause ticks/signatures and A4 page counts are inspected.
- `.local/operational-positive-*/`: local ANC/PET/S2/Lab/Task/QC/pooling/sequencing/results/export/recovery evidence. Same-run `native-draft-final-same-run-comparison.json` records retained draft/final/native-export PDFs, page geometry and hashes; it does not claim pixel-level Owner visual acceptance.
- `.local/p8-win/setup/`: real Setup1.0.1 EXE and adjacent `.record.json` with SHA256, bytes, package/source provenance and signing limitations.
- `.local/p8-win/parity-upgrade-*-evidence/`: real1.0.0 package installation followed by actual1.0.1 EXE upgrade, preserved record IDs/counts/file hashes, original Run Photo retrieval, installed DCC previews and new installed workflow. Each rehearsal has its own root, ports, database and service cleanup.

## Source inventory

Primary implementation: `packages/results/gates.ts`; `packages/forms/{consent-content,request-contract}.ts`; `packages/p2/{schema,service,forms,document-snapshot}.ts`; `packages/pdf/{p2,dcc-snapshot}.ts`; `packages/workbook/draft-preview.ts`; `packages/lab/records.ts`; migration105; runtime-aware server pages and P2 components; draft-PDF route tracing; existing P8 builder/provision/supervisor/admin and original-form staging. The final Git commit provides the complete exact file inventory including regression fixtures and the two reviewed responsive snapshots.

## Updating the actual server after separate authorization

1. Retain the existing install root and take a verified backup using the installed P8 backup workflow, including database, configuration/secrets, files and Run Photo storage. Keep the1.0.0 package and backup available.
2. Copy the delivered1.0.1 EXE to the server and run it using the same Windows identity/installation scope as1.0.0. Select the existing installation/root. The existing engine performs backup/migration/release switching; do not uninstall, delete data or create a second root to perform an upgrade.
3. After success, check installed version/health, existing records and original Run Photo retrieval, DCC previews, and a separately authorized local/nonclinical test. Preserve external storage paths, operating mode and hospital configuration.
4. If setup reports a failure, retain logs and use the supported recovery flow; do not reset migration ledgers or manually delete database/files.

The executable is not Authenticode signed; the offline package inventory is Ed25519 signed with the development/test package key. This is a technical test release, not DCC, hospital, physical printer/HALOS or clinical acceptance. No real server update is performed in this delivery.
