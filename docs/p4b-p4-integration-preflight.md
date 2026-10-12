# P4 → P4b integration preflight (synthetic only, 2026-10-13)

## Current implementation status

- Base commit: P4 on `main` `5d859c3a8be433b10668a9b097396cf1be69c54e`.
- P4b source: verified Draft PR #2 `424e9c520d3a5dc193e1e5148bc8debf880cdf51` (six files copied without changing the original PR).
- Combined work lives in `feat/p4b-integration-synthetic` and is **NOT approved for merge or real HALOS use**.
- `packages/halos-export/contract.ts`: original 47-row `Sheet1!A1:E48` typed cell plan, copied synthetic snapshot IDs/barcodes, no XLSX bytes.
- `packages/halos-export/p4-placement-preflight.ts`: new read-only P4 Placement evidence inspector; validates snapshot shape and physical slot provenance without deriving HALOS Sample ID or Barcode ID.
- `tests/contracts/p4b-p4-placement-preflight.test.ts`: positive full/partial and negative mapping/identity/revision tests.

## Verified P4 source boundary

P4 `packages/lab/batch.ts` currently emits immutable `lab_placement_snapshot` per finalized sheet. Its `PlacementPayload` captures:

- `batchId`, `sheetNumber`, `placementRevision`, template/formula version and plan/gate metadata.
- Per physical slot 1–48: `slot`, `plate`, `barcode` (**P4 Task List Barcode index = physical slot**), control kind/printed control code, patient `attemptId`, `caseId`, `roundId`, `lnHalos`, `printedSampleId`.
- Physical controls: PC at 1, NC at 25, BLANK at 40.

This is **not** a Pool snapshot, not a list of accepted pooled members and not a HALOS mapping. P4 `packages/lab/records.ts` provides QC1 and F3 evidence but has **no PoolAccepted event or immutable accepted Pool membership snapshot** yet. It would be incorrect to call `buildHalosCellPlan` directly from placements, to pass physical slot as HALOS Barcode ID, or to select Column A from LN Halos versus printed ID on our own.

The new preflight validates only the independently supportable P4 placement facts, returns a frozen evidence summary and ALWAYS `exportReady:false`. Full nominal placement can yield 47 *physical* non-blank members (45 patients, PC, NC) but this is **not evidence that these 47 were accepted into Pool**. Partial batches remain valid P4 work but blocked for HALOS file creation until a separate partial-batch policy is approved.

## Integration workflow — next coding milestone

1. Develop P4b **Pooling/QC2 and immutable accepted Pool snapshot**, anchored in the Plan's Field Inventory, approved calculation/version and QC criteria. Any unresolved formula/counting/eligibility must stay Pending/Hold; no synthetic defaults become clinical approval.
2. Design the persisted Pool snapshot to reference immutable P4 Placement revisions and list Pool membership/disposition explicitly; carry a verified `exportSampleId` choice (OD-03/Q-P4) and explicit approved physical ↔ HALOS Barcode associations.
3. Implement a permission/currentness gate that validates accepted Pool state, source snapshot hashes/revisions, Stop-use/Recall, DNB intended vs actual date, approval and signed mapping. Only then construct the `HalosSnapshotInput` DTO from frozen data.
4. Extend `buildHalosCellPlan` with actual XLSX writer/readback **only when** approved template and vendor dry-run requirements are met. Preserve Owner-locked full-batch 47 members (no HALOS Barcode13, no Row49, E cells empty); do NOT equate HALOS Barcode13 with physical slot40.
5. Handoff Manifest (source+output SHA-256, revision, actor/time), actual import confirmation and mandatory second-person/HALOS pre-sequencing verification remain release gates.

## Blocking decisions (single list; do not guess)

- OD-28/29/30/31: Pool count and PC/NC/Blank participation, formula/rounding, QC criteria and Pool eligibility.
- OD-35/Q-P4/Q-I8: HALOS A-column identity/control format, all 47 physical-to-HALOS member associations, source XLSX vendor compatibility and witnessed import.
- Partial Batch: row cardinality and control policy; never pad 47 rows with phantom identities.
- DNB actual-day change: supersede/reissue/import reconciliation.
- Pool data model: first approved immutable accepted membership Snapshot/Lineage + Stop-use enforcement, before connection to the exporter.

**Safety:** No external HALOS connection, no Live HIS, no patient data, no Production deploy/migration. Draft PR #2 remains intact. Do not merge both duplicate PRs.
