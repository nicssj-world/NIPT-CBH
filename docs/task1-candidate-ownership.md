# Task1 isolated candidate ownership

Owner authorized isolated candidate creation and local checkpoint commits on 2026-10-24. Base is1a4055ac8136f10684e8a818e458b4341b22a439. Shared working tree remains untouched. Candidate migration inventory stops at125; no migration126 or typed Storage/Task1.5 diff is included. Existing baseline Storage122 remains unchanged.

All source files, including unchanged modules, remain covered by the full source/runtime fingerprint gate. Gate logic retains clean Git, exact source/raw hashes, image provenance, complete candidate migration inventory+applied checksum ledger and feature evidence tied to candidate revision. Only target project/database selection is parameterized, retaining prior defaults. Candidate feature manifest covers Task1 functionality; unrelated ANC features are outside this candidate acceptance scope. No reviewed exclusion or feature flag bypass is used.

Candidate runtime: Compose project nipt-cbh-task1-rc-20261024, loopback HTTPS19568/DB19569, separate networks, volumes, images and copied local secrets/files. It starts existing through125 DB snapshot; migration/seed services are never invoked. Task2 continues independently. Evidence and dump hashes are under `.local/evidence/` and excluded from source fingerprint to avoid self-referential attestations.

| File | Ownership |
|---|---|
| `db/migrations/123_task1_attempt_identity_s3.sql` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `db/migrations/124_task1_early_resampling.sql` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `db/migrations/125_task1_external_no_call.sql` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `docs/task1-change-review-20261024.md` | Task1 evidence and Owner-approved scope |
| `docs/task1-export-validation-20261023.md` | Task1 evidence and Owner-approved scope |
| `docs/TASK1-FINAL-ACCEPTANCE-CHECKLIST-20261024.md` | Task1 evidence and Owner-approved scope |
| `docs/task1-owner-validation-20261023.md` | Task1 evidence and Owner-approved scope |
| `packages/db/roles.sql` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/inbound/process.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/batch.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/bench.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/core.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/intake.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/rules.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/seq-export.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/lab/worklist.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/p6/released-result.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/p6/res.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/results/gates.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/results/parser.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/results/service.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/security/policy.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/sequencing/owner-export.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/sequencing/owner-task-import.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/workbook/exceptional-highlights.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/workbook/master.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/workbook/service.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `packages/workbook/text-fit.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/app/(protected)/lab/page.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/app/api/p4/batches/[id]/route.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/app/api/p4/worklist/route.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/batch-workspace.css` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/batch-workspace.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/lab-bench.css` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/lab-bench.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/worklist.css` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p4/worklist.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p5/result-review.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/components/p5/result-workspace.tsx` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/server/p4-data.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `src/server/p4.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/lab-owner-nifty.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/lab-owner-task-import.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/p6-res.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/resampling-pet-labels.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/resampling-pet.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/contracts/task1-no-call-native.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/lab-owner-bench.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/lab-repeat-export.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/native-controlled-documents.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/p4-lab.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/p4b-pooling.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-external-no-call.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-failure-no-call.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-lineage.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-placement-metadata.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-upgrade.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/task1-workbook-native-metadata.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/workbook-metadata-source.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/db/workflow-correction.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p4-lab.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p4-task-list.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p4b-pooling.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p4c-sequencing.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p5-case-upload.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/p5-results.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/e2e/task1-ui.spec.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/helpers/browser-auth.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/helpers/pre-102.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/helpers/task1-no-call.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/p4-parity.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/p5-gates.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/specimen-display-code.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/task1-exceptional-highlight.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/task1-identifiers.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/task1-no-call-parser.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tests/unit/task1-result-correlation.test.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tools/his-simulator/result-pdf.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tools/operational/pre-uat-source-parity.mjs` | Candidate isolation/gate configuration; all verification predicates retained |
| `tools/operational/source-parity-features.json` | Candidate isolation/gate configuration; all verification predicates retained |
| `tools/operational/task1-export-evidence.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tools/operational/task1-rc.compose.yaml` | Candidate isolation/gate configuration; all verification predicates retained |
| `tools/operational/verify-binding-fidelity.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tools/task1-browser.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
| `tools/task1-native-persistence.ts` | Task1 implementation or focused verification; copied from reviewed shared snapshot |
