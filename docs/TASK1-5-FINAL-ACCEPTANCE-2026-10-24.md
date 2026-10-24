# Task 1.5 — Integrated technical acceptance

Verdict: **TECHNICALLY READY FOR TASK 3**.

This report is governed by the complete [Master Prompt](TASK1-5-FULL-INTEGRATION-MASTER-2026-10-24.md) and the existing [Mandatory Pre-Delivery Checklist](TASK1-5-PRE-DELIVERY-CHECKLIST-2026-10-24.md). The checklist contains the individual source → test → result → evidence rows for all **133 A–K gates and R15-01–R15-20**. Its original requirements were retained. Execution continued across Bangkok midnight on 24–25 October; the Owner's document names retain their approved 2026-10-24 date.

Owner visual/clinical/hospital/real-HIS/hardware acceptance is **DEFERRED_AFTER_TASK3**. This is an internal synthetic technical closeout; no separate Owner UAT is requested. Task 3 is not implemented by this change.

## Integrated source and provenance

Integration root: `D:\Claude workspace\NIPT-CBH-PARITY-REMEDIATION\.local\task1-5-integration`.
Branch: `candidate/task1-5-integration-20261024`.

| Input | Verified provenance and disposition |
|---|---|
| Task 1 | `cf70065d8eed6f3096f870ebd683035db666d98d`; original technical gate56/56, full source fingerprint `41f718c78d680205a9df35bd6ce0c47f11c976be164426949fae6bcef1cdfa66`. Technical evidence verified independently; Owner acceptance deferred. |
| Task 2 | Original shared dirty checkout, HEAD `1a4055ac8136f10684e8a818e458b4341b22a439`; explicit typed Storage files matched its tested build. Migration126, labels/parser, UI and native verifier included. |
| UI/APP_ADMIN | Original `.local/ui-status-detail-remediation`, HEAD `1a4055ac…`,39 dirty paths; latest12 corrective source hashes matched its corrective manifest and actual Before/After evidence. |
| Frozen baseline | `9db447a7c83ee7d17a6fd808757f4be4929e6a4a`; full source `44fbcca93cf3c56ed6d1405e23ceb26611d4f57d81767ba359a22cf68184ac9a`; build `XxtLAUvfrcKdddlL1efHA`; Gate A/B passed BEFORE Task15 edits. |
| Task15 checkpoint | `ff78fe3d8881ce9c0a056e7619adb3c2b9c96af5`; subsequent security, fixture and clinical-button guard changes reviewed separately. Exact final HEAD/source/build/PIDs are in `final-runtime.json` and `final-source-parity.json`. |

Evidence root, relative to this integration root: **`.local/integration-evidence/`**. `input-inventory.json`, `verified-inputs.json`, `ownership.json`, original patches and `original-inputs-preserved.json` record exact inputs. Shared100 dirty files and UI39 dirty files, their HEADs/statuses, and the clean Task1 original were preserved. Nothing was reset, discarded, force-committed or copied over an original candidate.

Three overlapping components—`p4/batch-workspace.tsx`, `p5/result-review.tsx`, `p5/result-workspace.tsx`—were merged semantically. The narrow baseline fixes retained Task1 `attempt.noCall` in the APP_ADMIN allowlist, adopted the Task2 native Storage contract, and replaced a stale parser-version expectation with the accepted parser constant. No Task1/2 business rules were changed.

## Implementation and API contracts

| Exact file(s), relative to integration root | Purpose |
|---|---|
| `packages/p2/pet-registration.ts` | Permission-checked LN OR HN lookup; only OK-discovered stored PET with provenance/hash checks. Multiple LN needs explicit fileId; revalidate under the existing LN lock. Central `registerP2` identity and existing inbound receipt hook; no new allocator. Current-round/current-PET receipt proof prevents an old S1 satisfying pending S2. |
| `src/app/api/p2/pet-registration/route.ts` | Existing authenticated/CSRF/no-store mutation contract; POST `action: lookup` or `register`. Registration uses LN/HN, optional selected fileId/internal unitId, explicit Paper/Electronic and idempotencyKey. Typed409 conflicts; unauthorized role403; invalid input422. Citizen identity is never returned. |
| `packages/p2/service.ts` | Nullable initial operational clinical facts; selected consent mode; current HIS Ward/receipt/number in case read. `saveLabClinicalMetadata` is limited to deferred LAB Paper metadata, optimistic version, no clinical-review override and no fabricated document/signature. Existing ANC Request, signing and release safeguards retained. |
| `src/app/api/p2/cases/[id]/route.ts` | Existing case dispatcher adds only `saveLabClinicalMetadata`; other actions retain contracts. |
| `src/components/p2/lab-registration.tsx` | Preserves Manual versus Operational. Operational LN OR HN, verified read-only PET facts, explicit multi-LN choice and Paper/Electronic; no department/clinical prerequisite/receive/manual-number action. |
| `src/components/p2/registry.tsx` | ANC department selector removed while retaining internal authorized unit scope and delayed-scope safety; pre-PET Request/Consent preserved. |
| `src/components/p2/case-workspace.tsx`, `lab-clinical-metadata.tsx`, `shared.tsx` | HIS facts separated from later clinical facts, existing dialog/date components, derived GA and explicit pregnancy type. Clinical-edit button disabled during an outstanding mutation. ANC/Electronic retain the original five-category form. |
| `packages/lab/core.ts`, `packages/results/service.ts` | Narrow same-round fallback for nullable initial LAB EDD/type. Only Singleton/Twins count; Unknown never becomes a Singleton label. No release authority, outbound format or Storage rule change. |
| `db/migrations/127_task15_deferred_registration_clinical.sql` | Forward-only relaxation of absent initial GA/EDD/type and false Paper marker for Electronic; GA pair consistency retained. Immutable registration and historical rows remain protected. |
| `package.json`, `package-lock.json` | Minimal security patches Next16.4.0→16.4.3, matching eslint-config-next, Zod4.6.5→4.6.7, required by the checklist's zero-security-FAIL gate. Current full dependency audit0. |
| `tests/db/task15-registration.test.ts`, `tests/contracts/task15-native.test.ts`, `tests/e2e/task15-registration.spec.ts`, `tests/unit/task15-scope-ui.test.ts` | Real positive/negative, native app_rw concurrency, PDF label readback and authenticated responsive Task15 coverage. |
| `tests/db/lab-uat-storage.test.ts`, `tools/sample-storage-e2e/e2e.ts` | Pre126 fixture includes only migrations below126, rather than accidentally including new127 before126. Product Storage code unchanged. |
| `tests/e2e/p2.spec.ts`, `tests/e2e/p4-task-list.spec.ts` | Reconcile stale selectors with the already-accepted doctor combobox, calculated age, optional channel reason, no separate SCA UI, staff return-to-detail and Paper marker; keep refusal/revocation/signature safeguards. Pagination remains exactly55 with a unique fixture search, preserving existing data. |
| `docs/TASK1-5-PRE-DELIVERY-CHECKLIST-2026-10-24.md`, this report | Update the original mandatory acceptance record, individual evidence and final gap reconciliation. |

LN Halos still uses the existing receipt trigger, advisory/row locks and unique constraints. The counter month is the approved **Bangkok allocation date**, not the historical receipt date. Actual HIS P23 receipt remains stored unchanged. No daily reset, renumbering, competing allocation service, PET/RES/OK format change or invented Storage suffix was introduced.

Paper Consent is a channel marker, not signing/review/certification evidence. Refusal, revocation, existing clinical assessment and document locks remain authoritative. A new LAB Paper sample can later save EDD/type and enter the accepted Paper Task1 route; an Unknown type remains label-ineligible. Existing manual completion remains independent of PET receipt.

## Executed verification and preserved failure history

Counts below are per group; overlapping runs must not be summed as unique tests. No whole-repository suite or external acceptance is claimed.

| Group | Actual successful result | Evidence under `.local/integration-evidence/` |
|---|---|---|
| Frozen pre-Task15 baseline | Permissions884; Storage29; cross-task59; native Task1 three plus Storage four concurrency checks; browser Storage15+TaskList1+roles6;24 corrective captures | `baseline-gates.json`, `baseline-frozen/` |
| Current affected unit/DB/contracts/permissions | **979 PASS /0 FAIL /0 SKIP**,20 files | `task15-final-affected.log` |
| Result/HIS authority and wire regression | **565 PASS /0 FAIL /0 SKIP**,8 files | `task15-result-his-regression.log` |
| Actual PostgreSQL native contracts | **4 PASS /0 FAIL /0 SKIP**; disposable DB; app_rw, concurrent registration, receipt/number, repeat/NoCall and label PDF | `task15-final-native.log`, `native-execution.json`, `task15-native/evidence.json` |
| Integrated Storage/browser restart | **16 PASS /0 FAIL /0 SKIP**: search/API5, interactions5, Task1 RC1 one, repeat search/API5 after DB/web restart; native Storage4 concurrency assertions PASS | `task15-security-final-harness.log`, `.local/sample-storage-e2e/evidence/final-evidence.json` |
| Task15 authenticated browser | **5 PASS /0 FAIL /0 SKIP**; LN-only/HN selection, no PET/OK/conflict/ambiguous/role deny, retry, later clinical, Ready queue, Storage, ANC arrival and8 actual theme/width pairs | `task15-closeout-browser.log`, final bound browser log, `task15-browser/` |
| Existing ANC/Request/Consent browser | **7 unique scenarios**: delayed scope, duplicates/keyboard, five-category Request, four document modes, Electronic signing/withdrawal, decline/cancel, USB HID | `task15-closeout-p2.log`, `p2/` |
| Task1 browser | **10 unique scenarios** after pagination fixture repair; actual native PDF1–3/urgent, QC48, paired XLSX, assignments/FIFO and responsive | `task15-task1-browser.log`9PASS+fixtureFAIL retained, `task15-task1-pagination.log`1PASS; final artifact rerun log |
| Actual role checks | **6 PASS /0 FAIL**, APP_ADMIN/ANC/LAB real sessions, page/API/deep link, logout, keyboard/axe and served build/static bytes | `roles/report.json`, final bound role log |
| Corrective visual | **24 captures**,3 routes×4 widths×2 themes; no horizontal overflow; real service status/alerts shown | `visual-final/report.json` and captures; frozen original Before/After retained |
| Final static/build | typegen/tsc, eslint zero warnings, source guard, Next production build; exact root/snapshot/server/static source binding | final build log, `final-runtime.json`, `final-source-parity.json` |
| Dependency security | **0 vulnerabilities** including dev dependencies after minimal patch | `dependency-audit-final.json`; original findings in `dependency-audit-retry.json` |

The first review found three important defects: stale S1 receipt satisfying pending S2; generic full Request save creating PendingData and blocking the accepted LAB Paper route; and truthy Unknown pregnancy yielding a Singleton label. Each was reproduced, fixed and retested. Later browser checks exposed a mutation/open-dialog race; the clinical button now waits for the outstanding save. No safety gate was relaxed to make tests pass.

All failed attempts are retained. Initial native PDF cleanup used an obsolete PDF.js method, and old Storage/Consent/browser selectors assumed pre-integration interfaces or a clean55-row DB. These were corrected to the actual accepted contracts; successful reruns retain their original behavioral assertions or explicitly assert the updated Owner-locked marker semantics. A proposed bundled test edit was rejected by automatic approval review; it was not executed. The subsequent safe changes were separated and supported by the frozen9db447a source, optional `setModes.reason` schema and `docs/p2-paper-consent.md`. No required reason for refusal/revocation was removed.

The minimal security patch resolves findings recorded by npm, including [Next image optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Server Actions DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), [typed-array cache](https://github.com/advisories/GHSA-673q-mjm6-r5xr), and the Zod advisory recorded in the original audit JSON. This was a mandatory gate repair, not a feature expansion. Initial Windows EPERM during network-account installation was resolved using a candidate-local cache and the file-owning account; dependency versions were not guessed or broadly upgraded.

## Real artifacts and preservation

`task15-native/labels.pdf` was generated and read back by PDF.js: actual LN/LN Halos and existing suffixes are present. Native evidence records bytes/SHA/readback. `task1-artifacts/` contains actual Task List1–3 PDFs, urgent PDF, QC48 JSON and same-revision NIFTY/HALOS XLSX. `task1-seq-task-g50-pair.json` records both SHA256 values, revision3, specimen identities and native XLSX readback. Request/Consent tests verify actual PDF bytes and unauthorized document rejection. `artifact-manifest.json` hashes final retained artifacts; no renamed placeholder is used.

Original input dumps were restored in disposable DBs on the integration server and removed afterward. Task1 additionally has129 original file objects copied with per-file SHA. Migration127 has a pre-change archive whose restore and13-table before/after hashes match. `migration127.json` records checksum `304eea36570608dead7e32a0881ffb66e37638f0d78d6729d73d71ce95e8c366` and exact isolated target.

`final-retention/evidence.json` compares **all145 public tables**, row counts and deterministic row-set hashes, before backup, after a real restore and after restarting the isolated PostgreSQL container. All match. The exact dump SHA/bytes and restore-database cleanup are recorded. Existing signed documents, audit, identity, rounds, numbers, Storage positions/movements and source records remain present. New synthetic test rows are distinguishable; original Owner UAT databases were never the destructive-test target.

## Runtime, credentials and external boundaries

Internal integration URL: `http://127.0.0.1:20028` (synthetic and loopback only). PostgreSQL20029, renderer20030, Compose project `nipt-task15-integration-20261024`, own persistent database volume. Web/worker/renderer run native Node24 from the exact final source snapshot; therefore there is **no web container image**. Their source/build/server/PID hashes and the actual PostgreSQL image identity are attested separately; a nonexistent web image is not invented.

Actual authenticated test accounts: `synthetic.admin`, `synthetic.anc`, `synthetic.lab`. Password is retained only in ignored `.local/sample-storage-e2e/data/secrets/seed-password`; it is not printed in Git/reports. No `admin/admin` account was inferred or seeded into an operational database. Authentication proof is in role/browser evidence. This URL is for internal technical verification, not a separate Owner UAT handoff.

`service-health.json` records web200, bearer-authenticated renderer200 and actual worker heartbeat. Source↔snapshot↔served build/static bytes and migration123–127 checksums are independently compared in `final-source-parity.json`. `final-runtime.json` is the authoritative exact final revision/build binding, avoiding report self-hash recursion. Prior baseline, pre-patch and corrected intermediate evidence is labelled separately.

The health UI truthfully shows that operational backup monitoring is not configured in this isolated harness; manual dump/restore evidence proves this task's backup gate. Hospital share/LAN/UNC/SMB, real HIS, clinical criteria and actual staff/hardware acceptance remain unverified externally and deferred; synthetic transport proof does not substitute for them. Source fingerprints do not substitute for the real browser/artifact tests.

## Final gap check and release control

`final-gap-check.json` compares the **complete471-line Master**, all133 original detailed IDs, all20 mandatory R15 IDs, implementation, evidence references and final report fields. It records coverage by Master section and the critical independent I01–I10 interfaces, not just a count of tests. No requirement is waived by an old candidate PASS. Final technical readiness requires zero open local functional/security failures and exact-source parity PASS.

No push, merge into Main, Production deploy, real-HIS/clinical publication, EXE/installer creation or unrelated-project modification was performed. Original Excel/PDF masters were copied only into ignored approved-fixture paths and their SHA values verified; the originals were not edited. Only the isolated candidate may receive justified local checkpoint commits. Owner performs **one integrated UAT after Task3** under its separately approved specification.

