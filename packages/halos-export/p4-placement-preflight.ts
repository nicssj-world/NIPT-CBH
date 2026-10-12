import type {PlacementPayload} from '../lab/batch';
import {controlTypeOf, getPlatePosition, getSheetNumber} from '../lab/rules';

/**
 * Read-only P4 -> P4b boundary. This deliberately does NOT produce HalosSnapshotInput:
 * P4 has immutable Placement snapshots but no accepted Pool snapshot, no approved
 * 47-member HALOS barcode association and no approved Column A identity selection.
 * Task List barcode 1..48 is NEVER used as HALOS Barcode ID 1..12,14..48.
 */
export type P4PlacementSnapshotRef = Readonly<{
  id: string;
  revision: number;
  contentHash: string;
  payload: PlacementPayload;
}>;

export type P4PhysicalMemberEvidence = Readonly<{
  physicalPosition: number;
  sheetNumber: number;
  role: 'PATIENT' | 'PC' | 'NC';
  // P4 Task List index, NOT a HALOS barcode association.
  taskListBarcodeIndex: number;
  attemptId: string | null;
  caseId: string | null;
  roundId: string | null;
  lnHalos: string | null;
  printedSampleId: string | null;
  printedControlId: string | null;
  placementSnapshotId: string;
  placementRevision: number;
  placementContentHash: string;
}>;

export type P4PlacementPreflight = Readonly<{
  usage: 'P4_PLACEMENT_EVIDENCE_ONLY';
  exportReady: false;
  batchId: string;
  sheetCount: number;
  physicalMemberCount: number;
  nominalFullBatch: boolean;
  physicalMembers: readonly P4PhysicalMemberEvidence[];
  blockers: readonly string[];
}>;

const hashPattern = /^[a-f0-9]{64}$/;
const present = (x: string | null | undefined) => typeof x === 'string' && x.length > 0;

/**
 * Collect immutable placement *references* from P4 in memory. Caller must still
 * verify DB snapshot currentness, permission, hash, execution/QC state and Pool
 * acceptance. A supplied hash is provenance metadata, NOT cryptographic proof.
 */
export function inspectP4PlacementEvidence(snapshots: readonly P4PlacementSnapshotRef[]): P4PlacementPreflight {
  if (!snapshots.length || snapshots.length > 3) throw new Error('P4_SNAPSHOT_COUNT_INVALID');
  const batchId = snapshots[0]?.payload?.batchId;
  if (!present(batchId)) throw new Error('P4_BATCH_ID_REQUIRED');
  const sheets = new Set<number>();
  const members: P4PhysicalMemberEvidence[] = [];
  for (const record of snapshots) {
    const p = record.payload;
    if (!p || p.synthetic !== true || p.batchId !== batchId || ![1, 2, 3].includes(p.sheetNumber)) {
      throw new Error('P4_SNAPSHOT_BATCH_OR_SHEET_MISMATCH');
    }
    if (sheets.has(p.sheetNumber)) throw new Error('P4_DUPLICATE_SHEET');
    sheets.add(p.sheetNumber);
    if (!present(record.id) || !Number.isInteger(record.revision) || record.revision < 1 ||
        record.revision !== p.placementRevision || !hashPattern.test(record.contentHash)) {
      throw new Error('P4_SNAPSHOT_PROVENANCE_INVALID');
    }
    if (!Array.isArray(p.slots) || p.slots.length !== 16) throw new Error('P4_SLOT_COUNT_INVALID');
    const positions = new Set<number>();
    for (const s of p.slots) {
      if (!Number.isInteger(s.slot) || getSheetNumber(s.slot) !== p.sheetNumber ||
          positions.has(s.slot) || s.plate !== getPlatePosition(s.slot) ||
          s.barcode !== s.slot) throw new Error('P4_SLOT_MAPPING_INVALID');
      positions.add(s.slot);
      const expectedControl = controlTypeOf(s.slot);
      if (s.control !== expectedControl) throw new Error('P4_CONTROL_SLOT_MISMATCH');
      if (expectedControl) {
        if (s.attemptId !== null || s.caseId !== null || s.roundId !== null ||
            s.lnHalos !== null || s.printedSampleId !== null ||
            !present(s.controlCode) || !present(s.printedControlId)) {
          throw new Error('P4_CONTROL_DATA_MISMATCH');
        }
        if (expectedControl === 'blank') continue; // physical slot40 never exported as member
      } else if (s.attemptId !== null) {
        if (!present(s.attemptId) || !present(s.caseId) || !present(s.roundId) ||
            !present(s.lnHalos) || !present(s.printedSampleId) ||
            s.controlCode !== null || s.printedControlId !== null) {
          throw new Error('P4_PATIENT_IDENTITY_INCOMPLETE');
        }
      } else if (s.caseId !== null || s.roundId !== null || s.lnHalos !== null ||
                 s.printedSampleId !== null || s.controlCode !== null ||
                 s.printedControlId !== null) {
        throw new Error('P4_VACANT_SLOT_HAS_IDENTITY');
      }
      if (expectedControl === null && s.attemptId === null) continue; // partial batch permitted by P4, not HALOS export
      members.push(Object.freeze({
        physicalPosition: s.slot,
        sheetNumber: p.sheetNumber,
        role: expectedControl === 'positive' ? 'PC' : expectedControl === 'negative' ? 'NC' : 'PATIENT',
        taskListBarcodeIndex: s.barcode,
        attemptId: s.attemptId,
        caseId: s.caseId,
        roundId: s.roundId,
        lnHalos: s.lnHalos,
        printedSampleId: s.printedSampleId,
        printedControlId: s.printedControlId,
        placementSnapshotId: record.id,
        placementRevision: record.revision,
        placementContentHash: record.contentHash,
      }));
    }
  }
  members.sort((a, b) => a.physicalPosition - b.physicalPosition);
  const nominalFullBatch = sheets.size === 3 && members.length === 47 &&
    members.filter(m => m.role === 'PATIENT').length === 45 &&
    members.filter(m => m.role === 'PC').length === 1 &&
    members.filter(m => m.role === 'NC').length === 1;
  // These are explicit blockers even when all 47 physical memberships are present.
  const blockers = [
    ...(!nominalFullBatch ? ['HALOS_PARTIAL_BATCH_POLICY_PENDING'] : []),
    'POOL_ACCEPTED_SNAPSHOT_NOT_IMPLEMENTED',
    'P4_SNAPSHOT_CURRENTNESS_AND_QC_PENDING',
    'PHYSICAL_TO_HALOS_BARCODE_MAPPING_PENDING',
    'HALOS_COLUMN_A_IDENTITY_AND_CONTROLS_PENDING',
    'DNB_DATE_AND_VENDOR_IMPORT_VERIFICATION_PENDING',
  ];
  return Object.freeze({
    usage: 'P4_PLACEMENT_EVIDENCE_ONLY' as const,
    exportReady: false as const,
    batchId,
    sheetCount: sheets.size,
    physicalMemberCount: members.length,
    nominalFullBatch,
    physicalMembers: Object.freeze(members),
    blockers: Object.freeze(blockers),
  });
}
