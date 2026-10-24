# NIPT-CBH Task1 — Final Acceptance Checklist (2026-10-24)

## TASK1 — READY FOR OWNER TEST (isolated candidate)

This is the sole Task1 checklist. The latest Owner instruction supersedes earlier shared-working-tree closeout verdicts. Candidate branch `candidate/task1-rc-20261024` is isolated at `.local/task1-release-candidate` beneath the original workspace. Shared Task2/Task1.5 work and the prior UAT remain unchanged. Working URL: **https://127.0.0.1:19568**. Credentials are in the private `.local/owner-local-uat-1.0.2/credentials.txt` inside the candidate (same local test accounts).

Full source-parity delivery gate passed on the functional candidate with clean Git, all three matching image/raw/source inventories, exact applied migration checksum ledger through125 and real Task1 feature evidence. Final documentation-only checkpoint is rebuilt and rechecked; exact final commit, source hash, images and gate verdict are in `.local/evidence/gate-final.json` and `final-acceptance.json`. Read those actual records, not an inferred future PASS.

Candidate scope/ownership: `docs/task1-candidate-ownership.md`. No migration126, typed Storage or Task1.5 diff was copied. Existing unchanged Storage122 remains as baseline. Project `nipt-cbh-task1-rc-20261024`, loopback HTTPS19568/DB19569, separate Docker networks/volumes/images, copied files/secrets and verified DB backup restore. No migration/seed was executed in the persistent candidate. Dump SHA256:3eb5c634a30b10818f66d26e3236044ac4db860cd74d714298810b524cce6a2c. Ledger68entries ends at125; cases64/batches7/releases3 restored. Run007 attribution and accepted new baseline are retained below.

## Checklist — 56 items

PASS denotes local technical evidence for Owner testing; it does not represent physical instrument/printer, hospital HIS acknowledgment, vendor clinical PDF or clinical/Owner hands-on acceptance. Those remain external acceptance work, not a reason to mix Task2 into this candidate.

| ID | Status | Evidence |
|---|---|---|
| T1-01 | PASS | Authenticated candidate Operational Task List1–3 rendered at https://127.0.0.1:19568; full candidate Task browser regression10/10. |
| T1-02 | PASS | Native Task workbook/PDF readback and unchanged six-sheet/149-formula Master evidence in `.local/task1-owner-resolution-20261024/exports/manifest.json` and `pdf-readback.json`; control/slot semantics covered by affected Task tests. |
| T1-03 | PASS | Authenticated browser test moved an Urgent case into slot 40, verified the displaced Ready attempt and generated/read back Task PDF; `.local/task1-browser-lF0lKh/playwright.log`, `task1-urgent-slot40.pdf`, and displacement JSON. |
| T1-04 | PASS | Authenticated browser regression exercised Manual exact-slot UI and current backend; `.local/task1-browser-lF0lKh/playwright.log` (10/10). |
| T1-05 | PASS | Authenticated browser regression exercised Urgent Fill; responsive task UI also measured at four viewports; `.local/task1-browser-lF0lKh/playwright.log`. |
| T1-06 | PASS | Browser regression verified slot-40 replacement and returned displaced sample/lineage before readable Task PDF; `.local/task1-browser-lF0lKh/playwright.log` and `task1-urgent-displacement.json`. |
| T1-07 | PASS | Analytical ID rules covered by `tests/unit/task1-identifiers.test.ts`, `tests/db/task1-lineage.test.ts` and PET/label contracts; relevant suites pass as recorded in owner validation. |
| T1-08 | PASS | FIFO/urgent/repeat assignment gate behavior covered by existing Task/assignment tests and server-side worklist eligibility; no live patient was assigned during final smoke. |
| T1-09 | PASS | Authenticated browser test paginated 55 synthetic Ready attempts and searched/selected from the next page; `.local/task1-browser-lF0lKh/playwright.log` and `task1-pagination-55.json`. |
| T1-10 | PASS | Placement/finalization and post-lock metadata behavior covered by DB tests and prior native persistence/PDF evidence; Run007 is intentionally still Draft. |
| T1-11 | PASS | Task-scoped evidence and metadata cases are covered by `tests/db/task1-placement-metadata.test.ts` and native workbook metadata tests; no cross-Task evidence was written to UAT. |
| T1-12 | PASS | Candidate Operational browser asserts no F2/F3/Issued Original controls; inherited legacy matrix18views retained and product source unchanged. |
| T1-13 | PASS | Authenticated Operational browser on isolated DB/file-store clone exercised Tasks 1–3 across PlacementFinalized, PreWorkIssued, InExecution, ExecutionRecorded, ExecutionVerified and CompletedIssued (18 views). Backend returned operational=true; PDF controls present and legacy controls absent. `.local/task1-closeout-remaining/legacy-browser.json`. |
| T1-14 | PASS | Prior full regression P0-5 finalized all three Tasks through real APIs, downloaded/read back native PDFs and navigated to QC Measurements. New authenticated Operational clone regression confirms PDF controls and QC/Pooling/Sequencing navigation for legacy states. |
| T1-15 | PASS | Live page provides links to QC Measurements, Pooling/QC2 and Sequencing; route destinations are present in AX tree. |
| T1-16 | PASS | Exactly the allowed six post-lock metadata fields are covered by native DB/XLSX/PDF metadata evidence retained in `.local/task1-owner-20261023/exports/` and owner validation. |
| T1-17 | PASS | Immutable placement/snapshot/history regression is covered by native database tests; the current UAT was only queried and viewed. |
| T1-18 | PASS | Metadata PDF/XLSX readback and stale-version/source binding evidence are recorded in prior owner validation artifacts. |
| T1-19 | PASS | S1 `-1` / shared repeat `-2` identifier contracts pass in `tests/unit/task1-identifiers.test.ts` and affected DB/export tests. |
| T1-20 | PASS | Owner-locked early re-sampling behavior and S3 PET progression are exercised in `tests/db/task1-lineage.test.ts`, `tests/contracts/resampling-pet.test.ts` and native P3 contracts. |
| T1-21 | PASS | Early resampling repeat suffix `R-2` before global attempt 5 and no invented suffixes are included in lineage/identifier tests and native Task output readback. |
| T1-22 | PASS | Global LAB5+ red `R-1`, distinct attempt/specimen identities and ordinals are covered by lineage tests and actual Task PDF/XLSX output inspection. |
| T1-23 | PASS | Twin `D`/`R` ordering and unchanged HIS LN are covered by `tests/contracts/resampling-pet-labels.test.ts` and label/PET evidence. |
| T1-24 | PASS | Genuine PET identity, receipt provenance and idempotency guards are covered by native P3/repeat contracts and wrong-HN rejection tests. |
| T1-25 | PASS | QC1–QC4 and Sequencing failure/repeat paths and permission checks are covered by `tests/db/task1-failure-no-call.test.ts`, PET/failure regression (19 PASS) and permission suite (843 PASS). |
| T1-26 | PASS | Authenticated browser test read all 48 identity/control positions, saved synthetic measurements, and verified persisted readback; `.local/task1-browser-lF0lKh/playwright.log` and `task1-qc-48-readback.json`. This used isolated synthetic DB, not the persistent Local UAT. |
| T1-27 | PASS | Existing Owner-approved QC rules, normal result gates and negative fabricated-PASS assertions remain covered by the focused DB/unit/contract regressions; no threshold was changed. |
| T1-28 | PASS | Approved pooling formula and under-2µL highlighting are covered by pooling tests and actual native XLSX readback; no UAT pooling values were changed. |
| T1-29 | PASS | Browser4 responsive measurements reported at 1440/1280/768/375px with aligned desktop input tops/heights and no mobile overflow; evidence is summarized in owner validation. |
| T1-30 | PASS | Pool CSV field/position semantics including `F=0` are covered by `tests/db/p4b-pooling.test.ts` and export contract regression. |
| T1-31 | PASS | Authenticated Task-G50 UI saved revision 3, calculated Pooling, edited QC2, recorded actual pooling, downloaded both XLSX files, and verified ZIP structure, expected patient/sample IDs, revision and SHA-256. Files: `.local/task1-browser-lF0lKh/p4-pdf-evidence/task1-nifty-revision-3.xlsx` (SHA `73cccb47863a6bab5ad50cbb488b02177796ddfefa405d8ea14715ae865cff2d`) and `task1-halos-revision-3.xlsx` (SHA `01dfc132adfd5e58606e4c4f8792b52c9fc2fa9718fd19ae4520ab2d5b443b4d`); manifest `task1-seq-task-g50-pair.json`. |
| T1-32 | PASS | Readback verifies six sheets, 149 formulas and unchanged Master SHA-256 `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1`. |
| T1-33 | PASS | Actual native PDF readback reports pages 2/2/2/1/1/1 and workbook readback; artifacts under `.local/task1-owner-resolution-20261024/exports/`. |
| T1-34 | PASS | Exceptional red IDs were inspected in Task UI/XLSX/PDF; vendor master hashes and schemas remain unchanged. CSV/plain text cannot carry font color and remains a format limitation. |
| T1-35 | PASS | Synthetic label outputs preserve 4 stickers/8 halves, 50×20mm, LN and D-before-R semantics in prior label evidence; physical printer acceptance remains external and unverified. |
| T1-36 | PASS | NIFTY output transformation and original master hash `07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc` are documented in export evidence. |
| T1-37 | PASS | HALOS Task Import readback and unchanged original master hash `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec` are documented. |
| T1-38 | PASS | Correlation/duplicate-display-ID and immutable attempt lineage negative tests pass in `tests/unit/task1-result-correlation.test.ts` and lineage/No Call DB contracts. |
| T1-39 | PASS | Attempt-4 “await consideration” state and no automatic No Call choice covered by failed-stage/result-gate tests. |
| T1-40 | PASS | LAB_STAFF No Call selection without certification privilege covered by No Call Browser/native permission tests; permission suite reports 843 PASS. |
| T1-41 | PASS | No Call pending state creates no clinical result/release/HIS job or fabricated QC PASS in `tests/db/task1-failure-no-call.test.ts` and native No Call contract. |
| T1-42 | PASS | Same-structure synthetic external PDF with explicit `Result = No Call` was parsed, rendered and exact-byte checked; `.local/task1-owner-resolution-20261024/synthetic-external-no-call.pdf` and parser tests. This is not a hospital-supplied PDF. |
| T1-43 | PASS | Native `app_rw`/`worker_rw` test exercised existing review/release/RES/PDF/OK workflow with No Call and preserved failed attempt state; see `native-no-call-evidence.json`. |
| T1-44 | PASS | Wrong identity, ambiguous/duplicate result, stale attempt, missing consent/review, hold and unauthorized release negative assertions pass in DB/native result regressions. |
| T1-45 | PASS | Candidate npm run typecheck PASS; earlier ESLint PASS retained because product source identical. Candidate production build TypeScript PASS. |
| T1-46 | PASS | Candidate permissions843/843, focused Task1 unit/contract/DB32/32, native PostgreSQL role contracts5/5, gate unit2/2. Earlier broader suites retained without unnecessary reruns. |
| T1-47 | PASS | Affected normal-result/HIS regressions pass: result regression 556; existing QC release 538; P5 PDF/auth upload 1 PASS; PET/label regressions included above. Logs in `.local/task1-owner-resolution-20261024/`. |
| T1-48 | PASS | Candidate Task List browser10/10 (RC1 and T1-31 included), component browser4/4, native contracts5/5. Operational candidate runtime also passed real browser/API and generated native PDF/XLSX checks. |
| T1-49 | PASS | Operational authenticated legacy matrix asserts no F2/F3, Issued Original, pre-work issuance or legacy execution controls in 18 Task/state views. `.local/task1-closeout-remaining/legacy-browser.json`. |
| T1-50 | PASS — synthetic browser | Current Task List UI was measured at 1440/1280/768/375: Manual/Urgent/Repeat controls stay within the viewport and the lightning icon/title remain aligned. Evidence: `.local/task1-browser-lF0lKh/p4-pdf-evidence/task1-responsive.json` and `playwright.log`. Persistent Local UAT web was rebuilt after the QC2 fix; full runtime parity remains NOT VERIFIED under T1-54. |
| T1-51 | PASS | Actual Excel/PDF files were generated by Microsoft Excel/read back and verified, including formula count, six sheet outputs, PDF page counts, and vendor master hashes; exact file and hash manifest is `exports/manifest.json` plus `pdf-readback.json`. |
| T1-52 | PASS | Candidate DB/web/worker/renderer/proxy restart PASS;10 core/export tables retain exact ordered row-content hashes and identical DB volume. `.local/evidence/persistence-{before,after}.txt`. |
| T1-53 | PASS | Run007 ID 9ccd4f07-4dbe-404d-9859-084c33f9f2cd was created by uat.lab at 2026-10-23T20:41:24.943929Z, after snapshot20:28:42Z. BATCH_CREATED event72 and LAB_BATCH_CREATED audit35736 agree; cancellation event73/audit36313 record cancellation21:12:05Z. New baseline64/7/3 accepted. `.local/task1-run007-audit-20261024.jsonl`. |
| T1-54 | PASS | Full candidate delivery gate PASS, readyForOwnerTest=true, failures=[], blocked=[] at verified functional checkpoint. Final documentation-only checkpoint is rebuilt and the exact final SHA/source/raw/image/migration result is `.local/evidence/gate-final.json`. Candidate clean Git; inventory and applied ledger match through125 only; no reviewed exclusions or bypass. |
| T1-55 | PASS | Working persistent isolated candidate URL https://127.0.0.1:19568; authenticated Task1–3/QC48/Pooling/Sequencing and actual PDF/XLSX paths verified. Local training banner and six existing test accounts preserved. |
| T1-56 | PASS | Shared working tree remains untouched. Only candidate branch has Owner-authorized local checkpoints. No push/merge, Production, EXE,126, Task2/Task1.5, asset or package-version change. |
## Candidate execution evidence

- `.local/task1-browser-ZZB1eh/playwright.log`:10/10 Task List browser (RC1, final PDFs→QC, slot40 displacement, pagination, QC48, T1-31 native pair, responsive views).
- `.local/task1-browser-Ashwvr/playwright.log`:4/4 component browser; `native-contracts.log`:5/5 actual PostgreSQL-role contracts.
- `.local/evidence/focused-task1.log`:26passes;6 fixture failures were all missing copied Master path. Corrected fixture provision (no assertion/source change) in `focused-fixture-corrected.log`:6/6. Total32/32. Initial browser attempt likewise aborted due missing Master path; corrected run10/10. Preserve both attempts.
- `.local/evidence/permissions.log`:843/843; `typecheck.log`:PASS; `parity-unit.log`:2/2. Product source unchanged from earlier scoped ESLint PASS.
- `.local/evidence/feature-evidence.json`:real candidate Operational browser,6role auth/secure-cookie/RBAC, Task1–3, QC48, Pooling calculation, Sequencing, newly generated NIFTY/HALOS pair ZIP/readback/SHA and native Task PDF2pages/Seq PDF1page. Test harness CSRF setup was serialized; obsolete iframe expectation was corrected to the existing PDF canvas renderer without a product change.
- `.local/evidence/persistence-{before,after}.txt`:10table hashes and DB volume identity survive real candidate restart. Final restart/health evidence is recorded alongside it.
- `gate-final.json`:unchanged full gate predicates; target project/database parameters retain old defaults. Task1-scoped feature manifest requires actual evidence and has no reviewed exclusions. No false feature flag, dirty-Git exception or missing-ledger exception was introduced.

Original legacy18views, normal/NoCall, repeat/PET, PDF/XLSX/label and Master/formula evidence is retained from the verified Task1 implementation. Copied product files are identical to that approved work. The isolated candidate reran affected native/integrated checks rather than repeating unrelated full suites. Source footprint remains reviewed; current shared Task2 drift cannot affect this committed snapshot.

The worker build's npm prune stalled both online/offline. Candidate-only Dockerfile uses exact-lockfile production npm ci offline/no-audit/no-fund with120s timeout; package.json/package-lock.json and all package versions are unchanged. Final source includes this necessary deterministic build fix.
