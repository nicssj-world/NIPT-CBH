import {describe, expect, it} from 'vitest';
import type {PlacementPayload} from '../../packages/lab/batch';
import {controlTypeOf, getPlatePosition} from '../../packages/lab/rules';
import {inspectP4PlacementEvidence, type P4PlacementSnapshotRef} from '../../packages/halos-export/p4-placement-preflight';

/** Synthetic P4 snapshot, NOT a vendor-approved mapping or live instrument fixture. */
function sheet(n: number): P4PlacementSnapshotRef {
  const slots: PlacementPayload['slots'] = Array.from({length: 16}, (_, i) => {
    const slot = (n - 1) * 16 + i + 1;
    const control = controlTypeOf(slot);
    return {
      slot, plate: getPlatePosition(slot), barcode: slot, control,
      controlCode: control ? `CONTROL-${slot}` : null,
      printedControlId: control ? `PRINTED-CONTROL-${slot}` : null,
      attemptId: control ? null : `attempt-${slot}`,
      caseId: control ? null : `case-${slot}`,
      roundId: control ? null : `round-${slot}`,
      roundNumber: control ? null : 1,
      lnHalos: control ? null : `26B261013${String(slot).padStart(3, '0')}`,
      printedSampleId: control ? null : `26B261013${String(slot).padStart(3, '0')}-1`,
      repeat: false,
    };
  });
  const payload: PlacementPayload = {
    synthetic: true,
    batchId: 'batch-123',
    runLabel: 'Run001/2570',
    sheetNumber: n,
    placementRevision: 1,
    templateVersion: 'SYNTHETIC',
    formulaVersion: 'SYNTHETIC',
    plan: {workDate:'2026-10-13',operator:null,extractionLot:null,extractionExpiry:null,libraryLot:null,libraryExpiry:null},
    planCheck: {by:null,at:null},
    finalizedBy: 'synthetic.lab',
    gate: {ruleVersion:'synthetic',policy:'PROCEED_SYNTHETIC_LABELLED',pendingAccepted:[]},
    slots,
  };
  return {id:`snapshot-${n}`,revision:1,contentHash:'a'.repeat(64),payload};
}
const all = () => [sheet(1), sheet(2), sheet(3)];

describe('P4 placement -> P4b integration preflight (NOT HALOS export)', () => {
  it('recognizes 47 source physical members but never authorizes export', () => {
    const value = inspectP4PlacementEvidence([sheet(3), sheet(1), sheet(2)]);
    expect(value.sheetCount).toBe(3);
    expect(value.physicalMemberCount).toBe(47);
    expect(value.nominalFullBatch).toBe(true);
    expect(value.exportReady).toBe(false);
    expect(value.usage).toBe('P4_PLACEMENT_EVIDENCE_ONLY');
    expect(value.physicalMembers[0]).toMatchObject({physicalPosition:1,role:'PC',taskListBarcodeIndex:1});
    expect(value.physicalMembers.find(m=>m.physicalPosition===25)).toMatchObject({role:'NC',taskListBarcodeIndex:25});
    expect(value.physicalMembers.find(m=>m.physicalPosition===40)).toBeUndefined();
    expect(value.physicalMembers[45].physicalPosition).toBe(47);
    expect(value.physicalMembers[46].physicalPosition).toBe(48);
    expect(value.blockers).toContain('POOL_ACCEPTED_SNAPSHOT_NOT_IMPLEMENTED');
    expect(value.blockers).toContain('PHYSICAL_TO_HALOS_BARCODE_MAPPING_PENDING');
    // P4's preprinted Task List barcode (position) is not HALOS barcode 1..12,14..48.
    expect(value.physicalMembers[0]).not.toHaveProperty('barcodeIndex');
    expect(value.physicalMembers[0]).not.toHaveProperty('exportSampleId');
  });
  it('marks valid P4 partial batches blocked instead of adding missing samples', () => {
    const value=inspectP4PlacementEvidence([sheet(1)]);
    expect(value.sheetCount).toBe(1);
    expect(value.physicalMemberCount).toBe(16);
    expect(value.nominalFullBatch).toBe(false);
    expect(value.blockers).toContain('HALOS_PARTIAL_BATCH_POLICY_PENDING');
    expect(value.exportReady).toBe(false);
  });
  it('marks vacant P4 patient slots blocked, without phantom IDs', () => {
    const list=all();const x=list[0].payload.slots[1];
    x.attemptId=null;x.caseId=null;x.roundId=null;x.roundNumber=null;x.lnHalos=null;x.printedSampleId=null;
    const v=inspectP4PlacementEvidence(list);
    expect(v.physicalMemberCount).toBe(46);
    expect(v.physicalMembers.some(m=>m.physicalPosition===2)).toBe(false);
    expect(v.blockers).toContain('HALOS_PARTIAL_BATCH_POLICY_PENDING');
  });
  it('does not mutate P4 placement snapshots or invent new identifiers', () => {
    const input=all();const before=JSON.stringify(input);
    const out=inspectP4PlacementEvidence(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.physicalMembers)).toBe(true);
  });
  it('rejects duplicate source sheet, even with different snapshot refs', () => {
    expect(()=>inspectP4PlacementEvidence([sheet(1),sheet(1)])).toThrow('P4_DUPLICATE_SHEET');
  });
  it('rejects cross-batch mixing', () => {
    const list=all();list[1].payload.batchId='another-batch';
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_SNAPSHOT_BATCH_OR_SHEET_MISMATCH');
  });
  it('rejects snapshot reference/revision inconsistencies', () => {
    const list=all();list[2].payload.placementRevision=2;
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_SNAPSHOT_PROVENANCE_INVALID');
  });
  it('rejects forged/unformatted hash metadata', () => {
    const list=all();(list[1] as {contentHash:string}).contentHash='not-a-hash';
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_SNAPSHOT_PROVENANCE_INVALID');
  });
  it('rejects control moved to wrong physical location', () => {
    const list=all();list[0].payload.slots[0].control=null;
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_CONTROL_SLOT_MISMATCH');
  });
  it('rejects P4 Task List barcode changed into HALOS numbering', () => {
    const list=all();list[1].payload.slots[8].barcode=13;
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_SLOT_MAPPING_INVALID');
  });
  it('rejects missing patient identity and cross-case mismatch risk', () => {
    const list=all();list[2].payload.slots[0].printedSampleId=null;
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_PATIENT_IDENTITY_INCOMPLETE');
  });
  it('rejects an extra attempt in a P4 control slot', () => {
    const list=all();list[0].payload.slots[0].attemptId='unexpected';
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_CONTROL_DATA_MISMATCH');
  });
  it('rejects malformed sheet slot ranges/duplicate positions', () => {
    const list=all();list[0].payload.slots[1].slot=1;
    expect(()=>inspectP4PlacementEvidence(list)).toThrow('P4_SLOT_MAPPING_INVALID');
  });
});
