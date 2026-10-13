# P4b DNB / Sequencing / F5 synthetic delivery

Continuation from `5a628e3` on the existing P4b branch and Draft PR #2. No P5 worktree changes, merge, Production deployment, real instrument access or clinical acceptance. Authority and source hashes: [plan](p4b-sequencing-plan.md), [sources](p4b-sequencing-sources.md).

## Delivered behavior

Stored completed HOLD Pool snapshot → explicitly labelled simulation DNB preparation/attempt → F5 preview/Pre-work → server DNB Start/End → QC3/Standard1/2 observations, paper provenance and independent review → immutable handoff manifest → explicit unverified fixture mapping when all47 source members exist → transfer evidence and exact independent1:1 readback → sequencing run/first-cycle/wash evidence → lane/member QC4 review and rerun → simulation F5 Completed.

An unmapped/partial source never becomes a padded47-member vendor package. Operational DNB/PoolAccepted/F5/export remain blocked. FS10 validation uses `(N+2)*199` Buffer and `N+2` Dye and exposes WC14 rather than choosing the contradictory955 table value. OD32/WC05 preparation method stays unresolved; proposed QC3/stability values never auto-approve clinical work.

F5 contains all17 seed inventory rows, blank Pre-work actuals, persisted source/value/reviewer evidence for Completed, immutable original SHA256, byte-identical reprint, numbered derivatives with original hash on every page, source Stop-use and recall. Chromium embeds Thai fonts and repeats traceability footers. Task forms remain `SEED_UNVERIFIED` and unusable clinically.

Core command receipts replay exact request IDs and reject changed input/actor. Batch locks serialize currentness, corrections/reviews and source invalidation. F5 uniqueness/version/preview gates prevent duplicate issuance; deliberate copy actions create separately numbered audit records. API uses authenticated RBAC/SoD/CSRF and strict schemas; database guards independently reject lifecycle bypasses. Evidence and audit remain append-only.

## Review closure and migrations

| Review finding | Change | Evidence |
| --- | --- | --- |
| Raw F5 Completed/event/copy bypass; SQL NULL marker checks | 015 originals/copies;016 explicit simulation/issuance/readiness/event linkage/copy guards | Native app_rw malformed inserts; valid Pre-work→Completed/reprint; post-completion/inactive paper rejected |
| Missing status/lane accepted as MATCH | 016 null-safe required verification comparisons | Native15 omitted/null/wrong-type cases; each leaves verified=false |
| Cell plan could disagree with frozen members | 016 exact A/B/C/D/E, source/order/row guards;017 headers/template/contract metadata | Native semantic mutation matrix with recomputed outer hashes |
| Review/decision currentness race | 016 locks review and decision inserts on the batch before eligibility | Native pg_stat_activity observed lock waits: rollback permits review; committed invalidation rejects decision |
| Null/empty first-cycle evidence | 016 object + four numeric values + post-wash required | Native null/empty/missing/non-numeric negatives and positive end |
| Held run could not be replaced in UI; historical state leaked | UI replacement form + latest-run state/QC4 scoping | Full47 rerun DB test; browser held-lane replacement and current-run controls |
| SQL preview might be stale after evidence changed | Additive018 SQL-derived immutable evidence stamp, checked under batch lock | Native genuine Completed preview→AnalysisComplete→raw stale issuance rejected; fresh preview/issuance succeeds |

Existing committed001–013, Pooling/QC2/F4 services and all44 original HALOS contract tests remain unchanged. Additive014–018 run only on isolated loopback synthetic databases; final canonical LF checksums are in [migrations](migrations.md). Complete database preparation includes queue schema and worker roles. No ledger repair. Development databases were preserved when fresh final targets were created.

## Verification

Final local verification (2026-10-13):

- Typecheck, ESLint zero warnings, source guard330 files, build: passed. Build retains three pre-existing tracing warnings in unchanged PDF-preview/secrets routes.
- Full Vitest: **1,090 passed / one existing external-parser differential skip**,50 passed files/one skipped file. All eight native-test files ran against PostgreSQL17 loopback with actual app_rw/worker roles, including current-preview and observed-lock regressions.
- Playwright: full existing+new suite **56 passed**, including unchanged Windows visual baselines; additional held-QC4→UI rerun test **one passed** (57 distinct browser tests). Responsive/axe checks at375/768/1280/1440. Existing tests and baselines were not changed.
- Production dependency audit: **zero vulnerabilities**.
- Real Chromium Completed F5 from a stored native fixture:47 members,17 inventory rows,100 evidence rows,19 pages/~241KB; traceability footer on every page. Inspected first/last pages and mobile/desktop workspace; fixed long-evidence column widths and reran four real-PDF/unit tests successfully.
- Final database migrator recheck:18 migrations on both fresh synthetic native/browser targets; exact source/ledger checksums intact.
- Exact-head GitHub push/PR CI is linked in Draft PR #2 after push; this document does not infer CI success from local results.

 No skipped native test counts as PostgreSQL evidence. Existing external-parser differential skip remains explicit. PDF fake renderers are used by DB fixtures only; real Chromium PDF and browser tests verify rendering separately. Automated axe/screenshot review is not a full manual WCAG/NVDA ACR or witnessed Lab print validation.

## Legacy coverage and remaining gates

[Legacy Functional Parity Matrix](legacy-functional-parity-matrix.md) inventories both ZIPs, archive hashes,60 byte-identical canonical source files,201 application function definitions, all25 legacy setting keys, ten target settings groups and independent cutoff. ZIPs were read-only and never executed. No legacy Pool/DNB/Sequencing/HALOS app module exists; these capabilities are plan/WI additions. Other legacy outcomes remain tracked as partial/deferred/owner decision gaps with phase ownership and acceptance gates. No signed full-project legacy differential parity is claimed.

Owner HOLD remains OD28/29/30/31/32/33/34/35/36, WC05/WC14, signed F5 Field Inventory/Q-G4, Q-P4/Q-I8, approved mapping/ColumnA and vendor dry-run. Operational method/criteria, signed Excel goldens, physical printer/paper usability acceptance, real Accepted Pool adapter, vendor-compatible XLSX writer/API/import, scientific execution and clinical/P5 result certification are not delivered: required approvals/evidence are absent or the work belongs to another authorized phase. No AL-4b or Production readiness claim.

PR #5 integration must follow [the integration contract](p4b-p5-integration-contract.md), particularly001–018 before050, additive shared grants, immutable P4 analytical attempt identity and explicit synthetic/QC/result boundaries. Combined-branch migration and workflow testing remain a separate integration gate.
