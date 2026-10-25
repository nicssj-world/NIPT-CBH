# NIPT-CBH Task 3 — Completion Checklist with Evidence (108 items)

Source: `NIPT_CBH_Task3_Completion_Checklist_20261025_REVIEWED.md` (SHA-256 `4E5CF1B6…`), Master Prompt (SHA-256 `33D17B02…`), cross-checked against the Independent QA Gap Report (2026-10-25; 32 IMPLEMENTED / 53 IN PROGRESS / 1 MISSING / 22 NOT VERIFIED at HEAD `09c6d7a`).
Evidence is bound to the final commit named in `docs/task3-final-report-20261025.md` (§1). Local artifacts live under the git-ignored `.local/task3-evidence/` (never committed; synthetic data only).

**Status key**
- **PASS**: verified by an executed test, E2E run or runtime check listed in the row; reading the source alone was never counted.
- **PENDING GATE (EXT)**: needs an external dependency that the implementer cannot lawfully provide (trusted, licensed ReadyGen).
- **OWNER PENDING**: a human or clinical decision or authorization; never marked PASS in advance.

**Evidence shorthand**
- Contract tests: `NP` task3-native-pathway, `NC` task3-native-no-call, `NEG` task3-negatives, `ID` task3-identity-sources, `REC` task3-reconciliation, `GOLD` task3-golden, `SRC` task3-real-sources, `PG` task3-native-pg (native PostgreSQL), `CONC` task3-native-concurrency (native PostgreSQL).
- DB and unit tests: `HAL` tests/db/task3-halos-import, `FB` tests/db/task3-fallback-package, `INT` tests/unit/task3-interpretation.
- `E2E`: tests/e2e/task3-integrated-uat.spec.ts on the integrated UAT (https://127.0.0.1:20128).
- `REG`: full regression logs in `.local/task3-evidence/regression/`.

| ID | Status | Evidence |
|---|---|---|
| T3-00-01 | PASS | Final SHA, clean tree, migration ledger (72 rows, 128/129 last), web/worker/renderer build ID and `server.js` SHA-256 recorded in `.local/task3-uat/runtime.json` and final report §1. |
| T3-00-02 | PASS | REG: unit, permissions, db, contracts suites; E2E admin and LAB navigation; Task 1 No Call contracts unchanged; Task 1.5 suites in REG. |
| T3-00-03 | PASS | Isolated worktree `.local/task3-readygen`, branch `feat/task3-readygen-20261025` from `40a9c7e`. Other worktrees, main and the stash were untouched. |
| T3-00-04 | PASS | Both pathways use the existing P5/P6 tables and services (`registerInternalVersion` → same gates, QC5 and release). Out-of-baseline edits are listed with their reasons in final report §3. |
| T3-00-05 | PASS | Real sources stay in ignored `.local/task3-sources` (read-only copies); 45 PHI PDFs are never copied. Tests use synthetic data; E2E evidence masks names. A grep for 13-digit IDs found only timestamps and hashes. |
| T3-00-06 | PASS | Impeccable loaded; detector run: 0 findings in Task 3 files (1 pre-existing `globals.css:412` photo progress, out of scope). UI/UX Pro Max applied: §1–§5 review, 44px targets, 0 px overflow at 375/768/1440, axe, dark mode. |
| T3-00-07 | PASS | `40a9c7e` and `1a4055a` are ancestors; Task 1.5 / UI / APP_ADMIN regression in REG; E2E checks APP_ADMIN global navigation and denies certification (HTTP 403). |
| T3-00-08 | PASS | `docs/task3-readygen-outage-sop.md` and final report §2: SHA-256 of all six sources plus `ReadyGen.zip` and the exe. `Pasted text(3).txt` and the Owner Addendum were not found at the searched paths and are recorded as missing, not substituted. |
| T3-01-01 | PASS (Owner note) | FB: the vendor NIFTY export is byte-exact; the ReadyGen-input copy swaps only J/O, matching the real Run 2 layout. **OWNER PENDING:** confirm J/O (LAB-13 F04 vs ReadyGen alias). |
| T3-01-02 | PASS | Frozen `lab_bench_export.mapping` and `lab_seq_export_pair` hold per-attempt sampleId/attempt/round/case/vendorSampleId and SHA (HAL, ID, NC). |
| T3-01-03 | PASS | FB: offline ZIP with NIFTY vendor + ReadyGen input + HALOS task + README + manifest. `Verify-Package.ps1` detects tampering (now .NET hashing; also passes under a PowerShell 7 parent). PHI access is logged and permission-checked. SOP authorization: OWNER PENDING. |
| T3-01-04 | **PENDING GATE (EXT)** | No trusted, licensed ReadyGen installation; the bundled `ReadyGen.exe` is unsigned and was **not run**. Dependency: a hospital-provided, licensed ReadyGen on an authorized workstation. |
| T3-01-05 | PASS (draft) | `docs/task3-readygen-outage-sop.md` covers pre-outage export, fallback, custody, return/reconciliation and the HIS outage. Hospital SOP approval: OWNER PENDING. |
| T3-01-06 | PASS | REG: p4/p4b/p4c/lab-owner/task-list/HALOS export suites. |
| T3-02-01 | PASS | SRC (real HALOS workbook) and HAL: bounded reader; macro/external-link/ActiveX refused; malformed files refused with a reason. |
| T3-02-02 | PASS | HAL/SRC: result / repeat / sampleinfo; raw values plus sheet/row/chip provenance. |
| T3-02-03 | PASS | HAL: original bytes, SHA-256, name, size, user, time and adapter version stored; UPDATE/DELETE of import or rows rejected by triggers. |
| T3-02-04 | PASS | HAL counts by class; E2E preview screenshot (`a-halos-preview-*`), "6 ราย". |
| T3-02-05 | PASS | HAL: duplicate SHA, name collision (warning ack required), tab/whitespace key, ambiguity, malformed input. CONC: two parallel imports → one import. |
| T3-02-06 | PASS | SRC: real fixture counts 45 NIFTY / 46 result / 2 repeat / 46 sampleinfo (counts only). |
| T3-02-07 | PASS | HAL: download is byte-identical (SHA match), access-logged `LAB_HALOS_SOURCE_FILE`; ANC refused. E2E: ANC POST `/api/task3/halos` refused. |
| T3-03-01 | PASS | HAL/ID: exact frozen-export membership only; no suffix matching. |
| T3-03-02 | PASS | Paired export (`LAB_SEQ_EXPORT_PAIR`) and older `p4b_halos_export` resolved by the same resolver (HAL). |
| T3-03-03 | PASS | ID: `-1` matches; Backup `-3` and an unexported `-2` stay UNMATCHED. NC: real `-1 → -2 → R-1 → R-2` lineage. E2E twin ID `…D-1`. |
| T3-03-04 | PASS | NP: control row → HOLD `ROW_NOT_REPORTABLE`; HAL control classification; E2E controls listed as not reportable. |
| T3-03-05 | PASS | HAL/NP: unmatched, ambiguous, stale, superseded, newer import, match changed since import → explicit HOLD codes. |
| T3-03-06 | PASS | HAL: a repeat duplicating the result row becomes DUPLICATE_ENTRY; differing values → AMBIGUOUS; unique Final per attempt (NP, CONC). |
| T3-03-07 | PASS | ID: collection date from the part of P[23] before `^`, receipt from after `^`, ID/Passport from P[33] after `^`; Ward printed nowhere; a principal scoped to the Ward text gets NOT_FOUND. Access follows only `case_unit_scope`. |
| T3-03-08 | PASS | NC: the 4th attempt R-2 via real `orderRepeat`/`orderRedraw`/`confirmFailure`/`noCall`; ID: Backup `-3` is not an attempt. The 5th-attempt reuse of `R-1` resolves AMBIGUOUS when two exports share it (HAL) — fail-closed, see limitations. |
| T3-04-01 | PASS | INT (8 tests): T21/T18/T13, risk index, QC/advice, FF, SCA, gender/Y. |
| T3-04-02 | PASS | `RULESET_SHA256` pinned; trace, approver revision and interpretation snapshot stored immutably in `internal_report` (NP, NEG). |
| T3-04-03 | PASS | INT: ML21, T22, XO, T10, unknown codes and the alias/HN reference defects are gated, not reproduced. |
| T3-04-04 | PASS | INT: Pass + Rerun → HOLD `QC_RERUN_ADVISED`; E2E A5 held. |
| T3-04-05 | PASS (software) / **OWNER PENDING** (clinical sign-off) | NP/NEG/NC: unapproved ruleset, product, template or No Call rendering → HOLD. The UAT approval is labelled synthetic. |
| T3-04-06 | PASS | NC: the existing Task 1 No Call contract (`task1_no_call_qc5_valid`) is reused; the attempt stays QcFailed. Root-cause fix: `confirmFailure` closes the failed child's repeat order (it blocked No Call for the Owner lineage). |
| T3-04-07 | PASS | NP §7: a later ruleset or signer change leaves the frozen report and PDF unchanged. |
| T3-04-08 | PASS (software) / **OWNER PENDING** (rendering approval) | NC: native No Call in the **same** Owner master (Singleton and Twin): every result cell "No Call", probability "-", Remark "Result = No Call", QC FAIL; no Low/High Risk/Male/Female; parser 1.0.4 reads it back; released through Task 1 No Call QC5; ANC shows No Call. Held until the CLINICAL `noCallRenderingApproved` setting is approved (migration 129). |
| T3-05-01 | PASS | Master SHA-256 pinned (`a56be6e4…` / `0f731321…`); refused if the bytes differ (GOLD). |
| T3-05-02 | PASS | Template from the ANC/request record; authorized override needs `result.certify` + a reason, recorded (NP). |
| T3-05-03 | PASS | NP/ID: patient, doctor, GA, collection and receipt from PET/request/case sources; any disagreement → HOLD; Request DOB/EDD required before rendering. |
| T3-05-04 | PASS | GOLD/NP: static QC PASS, signers, licences, signature images and dates of the master replaced; NC prints QC FAIL. |
| T3-05-05 | PASS | GOLD: 0 placeholders, 0 pt anchor drift, one page; long Thai names fitted (≥ 0.6 ratio) or refused. |
| T3-05-06 | PASS (software) / **OWNER PENDING** (OD-09 rule) | NEG: twin RG-11 PENDING `TWIN_Y_CHROMOSOME_DISCLOSURE_RULE` until the authorized disclosure review at release, then PASS `TWIN_DISCLOSURE_REVIEWED` (existing accepted rule, no new rule); a DoNotWant twin wish holds. |
| T3-05-07 | PASS (Singleton) / **OWNER PENDING** (Twin reference) | GOLD: real Singleton reference — uniform 3.38 pt page offset, residual ≤ 0.16 pt. No approved Twin reference PDF exists; the Twin master golden layout has 0 pt drift. |
| T3-05-08 | PASS (software) / **OWNER PENDING** (clearance) | NEG: HNZ0011 data against an HNZ0051-only approval → HOLD `PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED`. |
| T3-06-01 | PASS | NEG/NP: legal name, licence (digits) and a PNG/JPEG signature verified by a second person; SVG/non-image refused. |
| T3-06-02 | PASS | E2E: searchable Reported by / Approved by selectors list only eligible, verified signers, with delegation status. |
| T3-06-03 | PASS (software) / **OWNER PENDING** (policy) | E2E: one certifier session finalizes and releases without a second login. Whether one person may hold both roles is hospital policy to confirm. |
| T3-06-04 | PASS | NP/NEG/E2E: another person's signature needs a standing delegation for that role; the operator and the basis are stored separately. |
| T3-06-05 | PASS | GOLD/NP: names, licences, signature pictures, Reported/Approved dates read back on both masters. |
| T3-06-06 | PASS | NP §7: profile renamed and delegation revoked → old PDF hash unchanged. |
| T3-06-07 | PASS | NEG: ineligible signer, unverified, revoked and expired delegation, revoked profile, non-image signature, stale (revoked) session → refused; idempotency key reused by another operator → refused. |
| T3-07-01 | PASS | E2E: single preview (watermark) and Final + release for A1. |
| T3-07-02 | PASS | E2E: batch A2 (Singleton) + A3 (Twin) → one PDF each; held rows not selectable. |
| T3-07-03 | PASS | E2E/NEG: shared defaults plus per-row override; each row authorized and held independently. |
| T3-07-04 | PASS | E2E: ZIP downloaded (`batch.zip` SHA-256 in evidence); NP/NEG manifest lists not-included rows. |
| T3-07-05 | PASS | Settings `report_output.downloadNameTemplate` validated by `templateProblems` (INT unit test, settings route); E2E download name `<LN>_<name>_Chonburi hospital.pdf`. |
| T3-07-06 | PASS | Download name, content hash (`file_asset`) and P6 `pdf_name` are independent columns (E2E P6 rows with names). |
| T3-07-07 | PASS | NEG: a pre-release re-issue supersedes the old report (bytes kept, cannot be released); after release → OD-17 HOLD (NP). |
| T3-08-01 | PASS | E2E/NP: `origin = INTERNAL_GENERATED`, intake source INTERNAL_GENERATED. |
| T3-08-02 | PASS | E2E A6: existing upload → Preview → import works; REC; Task 1 external No Call contracts in REG. |
| T3-08-03 | PASS | E2E: imported A6 version SHA-256 = original file SHA-256; identity, round and attempt linked and gated. |
| T3-08-04 | PASS | NP: `EXTERNAL_ATTESTATION_NOT_FOR_INTERNAL_REPORT`; internal release only through `acceptInternalAndRelease`. |
| T3-08-05 | PASS | Same `result_report_version`, review, QC5, gate and release tables (NP, NC, E2E). |
| T3-08-06 | PASS | E2E: origin badge on the result page and queue; origin, hash, signer and events stored in audit/version events. |
| T3-08-07 | PASS | REG: Task 1 external No Call and P5 external suites. |
| T3-08-08 | PASS | NP/REC/CONC: one Final per attempt; a second active final is refused (`OPEN_REPORT_EXISTS_FOR_ROUND` / unique index). |
| T3-09-01 | **PENDING GATE (EXT)** | Actual ReadyGen offline run not performed (see T3-01-04). The fixture PDF is labelled as a fixture, not as ReadyGen output. |
| T3-09-02 | PASS | E2E pathway B: external PDF imported after "outage", reconciled to A6's attempt, ANC sees it (E2E ANC A6). |
| T3-09-03 | PASS | E2E: statement "มีผลใน HIS แล้ว", effect `SUPPRESSED_BEFORE_RELEASE`, actor/time stored, no outbound job; NEG: duplicate attestation refused; ANC cannot attest. |
| T3-09-04 | PASS | PG: P6 delivers once under worker_rw; E2E: exactly one `p6_transfer` per release; p6-native contracts (concurrent workers and retry). |
| T3-09-05 | PASS | p6-native "OK/checkpoint ambiguity stays held … never resends"; p6-transfer "ambiguous OK … never blind replay". |
| T3-09-06 | PASS | CONC (parallel imports/finals), NEG (attestation withdraw → one requeue), NC (No Call), p6-native (outage/retry), NEG/NP (revision). |
| T3-09-07 | PASS | Attestation rows are immutable except withdrawal; audit `RESULT_HIS_PRESENCE_ATTESTED`; recorded as a user assertion, not HIS proof. |
| T3-10-01 | PASS | E2E: ANC sees released results of both origins only; LAB pages and APIs refused. |
| T3-10-02 | PASS | REC/NC: ANC summary from the certified parsed report (No Call shown as No Call). |
| T3-10-03 | PASS | E2E "เปิดรายงาน PDF", access-logged. |
| T3-10-04 | PASS | E2E: `attachment` with the configured name; no new release created. |
| T3-10-05 | PASS | E2E: view/download/print bytes identical (SHA-256); browser print path logged `ANC_RESULT_PRINT_VIEW`; physical printing not claimed. |
| T3-10-06 | PASS | REC: superseded/void versions are never current; ANC lists active releases only. |
| T3-10-07 | PASS | E2E: same ANC card for internal (A1) and outage-imported external (A6). |
| T3-11-01 | PASS | E2E: existing sidebar/top navigation; no duplicate menus; screenshots in `.local/task3-evidence/e2e/`. |
| T3-11-02 | PASS | E2E realtime LN/HN search, clear search, status tabs, next-action column. |
| T3-11-03 | PASS | E2E preview: matched/control/repeat/needs-fix with reasons. |
| T3-11-04 | PASS | E2E: one dialog for single/batch; preview nested; Escape closes only the top dialog (shared Dialog root-cause fix). |
| T3-11-05 | PASS | E2E axe (WCAG 2 A/AA, light and dark): 0 serious/critical after fixing link-in-text-block; 44px targets; labels; keyboard Escape. |
| T3-11-06 | PASS | GOLD (long Thai names); E2E screenshots at 1440/768/375, 0 px horizontal overflow on every captured page. |
| T3-11-07 | PASS | Loading, empty, error-with-retry, success, held and print-fallback states in the components; seen in E2E. |
| T3-11-08 | PASS | E2E: ANC top navigation only, LAB_STAFF sidebar, APP_ADMIN global menus, single logout, deep links, negative RBAC. |
| T3-11-09 | PASS | The grouped label–value layouts (HIS status, Result Import, Runtime Services) are preserved: `git diff 40a9c7e` shows only the Task 3 heading/badge lines in `result-workspace.tsx` and the fallback button in `lab-bench.tsx`; the health page is unchanged. Authenticated screenshots: `lab-runtime-services-*`, `lab-results-workspace-*`, `b-external-detail-*`. |
| T3-12-01 | PASS | REG on `3e0b6f7`: typecheck EXIT 0, lint EXIT 0 (0 warnings), unit 466, permissions 848, db 454, contracts 717 (734 with native PG), P6/P7 native 34, Task 3 native PG and concurrency PASS. |
| T3-12-02 | PASS | SRC (real XLSX, counts only) and INT. |
| T3-12-03 | PASS | GOLD both masters; NC both masters (No Call). |
| T3-12-04 | PASS | E2E 6/6 on the integrated runtime (pathway A and B). |
| T3-12-05 | PASS (no regression) | REG suites above. Disclosed: 2 native stack smoke tests (`native.test.ts`, `p3-native.test.ts`) fail **identically on baseline `40a9c7e`**, so they are pre-existing and outside Task 3 scope — reported, not hidden. |
| T3-12-06 | PASS | NEG, ID, E2E ANC negative APIs; permissions suite. |
| T3-12-07 | PASS | CONC, PG, restart persistence (counts equal before/after), `pg_dump` → restore check (same counts), SHA checks. |
| T3-12-08 | PASS | Final report §1: commit, ledger, build ID, `server.js` SHA-256, runtime PIDs, loopback binding. |
| T3-12-09 | PASS | This document. |
| T3-12-10 | PASS (prepared) / **OWNER PENDING** (execution) | `docs/task3-integrated-owner-uat-plan-20261025.md` with seeded data A1–A6. |
| T3-12-11 | PASS | No production change, no HIS mutation, no push/merge/deploy/EXE. |
| T3-12-12 | PASS | One URL https://127.0.0.1:20128; admin/admin and the other accounts are seeded only in `nipt_task3_integrated_owner_uat` with a loopback origin; all four ports bind 127.0.0.1. |
| T3-12-13 | **PENDING GATE (EXT)** | Same dependency as T3-01-04; not represented by the fixture import. |
| D-01 | See final report §6 | Every implementer-executable item PASS; external and Owner gates listed separately. |
| D-02 | **OWNER PENDING** | Clinical approval of ruleset, products, No Call rendering and twin Y disclosure; until then the software holds. |
| D-03 | PASS | Both pathways functional, idempotent, recoverable (restart, restore), audited and visible to ANC (E2E, PG, CONC). |
| D-04 | PASS | Releases go only through the gates; attestation suppresses duplicate outbound; withdrawal queues exactly once. |
| D-05 | **OWNER PENDING** | Owner UAT and Production acceptance — NOT RUN, AUTHORIZATION REQUIRED. |
