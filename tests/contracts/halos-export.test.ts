import {describe, expect, it} from 'vitest';
import fixture from '../fixtures/halos-full-synthetic.json';
import {buildHalosCellPlan, verifyHalosCellPlan, type HalosCellPlan} from '../../packages/halos-export/contract';

const input = () => structuredClone(fixture);
const candidate = () => JSON.parse(JSON.stringify(buildHalosCellPlan(input()))) as HalosCellPlan;
// Independent source-derived oracle, deliberately not imported from the implementation.
const barcodes = [1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48];

describe('P4b synthetic HALOS cell contract (not HALOS import acceptance)', () => {
  it('preserves exact source headers, 47 rows and all A-E cell types without row49', () => {
    const plan = buildHalosCellPlan(input());
    expect([plan.sheet, plan.range, plan.usage]).toEqual(['Sheet1', 'A1:E48', 'synthetic-cell-plan-only']);
    expect(plan.headers).toEqual(['*Sample ID', '*Lane ID', '*DNB ID\n(20 characters limited)', '*Barcode ID', 'Sub-Library Conc. (ng/μl)']);
    expect(plan.rows).toHaveLength(47);
    plan.rows.forEach((row, i) => {
      expect(row.excelRow).toBe(i + 2);
      expect(row.cells).toEqual([
        {type: 'string', value: fixture.members[i].exportSampleId},
        {type: 'string', value: 'L01'}, {type: 'string', value: 'DNB20261012'},
        {type: 'number', value: barcodes[i]}, {type: 'blank'},
      ]);
      expect(row.source).toEqual(fixture.members[i]);
    });
    expect(plan.rows.at(-1)?.excelRow).toBe(48);
    expect(plan.rows.at(-1)?.cells[0].value).toBe('00SYN-1-1');
    expect(plan.rows.some(r => r.cells[3].value === 13)).toBe(false);
    expect(() => verifyHalosCellPlan(fixture, plan)).not.toThrow();
  });

  it('does not infer HALOS barcode or A-column identity from physical position, LN or printed ID', () => {
    const plan = buildHalosCellPlan(fixture);
    expect(plan.rows[0].source.physicalPosition).toBe(48);
    expect(plan.rows[0].cells[3].value).toBe(1);
    expect(plan.rows.at(-1)?.source.role).toBe('PC');
    expect(plan.rows.at(-1)?.cells[3].value).toBe(48);
    expect(plan.rows.find(r => r.source.role === 'NC')?.source.physicalPosition).toBe(25);
    expect(plan.rows.some(r => r.source.physicalPosition === 40)).toBe(false);
  });

  it.each(['0000123', '1E10', ' 00SYN-Repeat-2 '])('copies opaque identity %s exactly as text', exportSampleId => {
    const s = input(); s.members[0].exportSampleId = exportSampleId;
    expect(buildHalosCellPlan(s).rows[0].cells[0]).toEqual({type:'string', value:exportSampleId});
    expect(s.members[0].lnHalos).toBe(fixture.members[0].lnHalos);
    expect(s.members[0].printedSampleId).toBe(fixture.members[0].printedSampleId);
  });

  it('matches independent Python canonical JSON/SHA-256 golden digests', () => {
    // Python hashlib + json.dumps(sort_keys=True,separators=(',',':'),ensure_ascii=False).
    expect(buildHalosCellPlan(fixture).integrity).toEqual({
      snapshotSha256:'09813014ed7904a8c46222e9cf770fe8e45ad10821ab204b965d75e5dc8a8dd9',
      orderedMembersSha256:'d0a174a113d2d319925a273474e636262f591a806bdbeba3ec1341c70e487303',
      cellPlanSha256:'46f58e3c5151a8e9b8267095e26aa589fe083314f14e5e0c171168b4e09246a6',
    });
  });

  it.each(['memberKey','exportSampleId','lnHalos','printedSampleId','barcodeIndex','physicalPosition'] as const)('rejects duplicate %s', field => {
    const s = input();
    Object.assign(s.members[1], {[field]: s.members[0][field]});
    expect(() => buildHalosCellPlan(s)).toThrow(`DUPLICATE_${field}`);
  });

  it.each([0, 1, 16, 32, 46, 48])('rejects unsupported cardinality %i without padding', count => {
    const s = input();
    s.members = count === 48 ? [...s.members, {...s.members[0]}] : s.members.slice(0, count);
    expect(() => buildHalosCellPlan(s)).toThrow();
  });

  it('rejects wrong order rather than sorting it', () => {
    const s = input();
    [s.members[0], s.members[1]] = [s.members[1], s.members[0]];
    expect(() => buildHalosCellPlan(s)).toThrow('BARCODE_ORDER_MISMATCH');
  });

  it.each([13, 0, 49, 1.5, '1', null])('rejects invalid, reserved or mistyped barcode %s', barcodeIndex => {
    const s = input();
    Object.assign(s.members[0], {barcodeIndex});
    expect(() => buildHalosCellPlan(s)).toThrow();
  });

  it.each(['', ' ', null, 123, 'SYN\nID'])('rejects missing or malformed identity %s', exportSampleId => {
    const s = input();
    Object.assign(s.members[0], {exportSampleId});
    expect(() => buildHalosCellPlan(s)).toThrow();
  });

  it.each(['PC', 'NC'])('rejects moved or missing %s control', role => {
    const s = input();
    const ctrl = s.members.find(m => m.role === role)!;
    [ctrl.role, s.members[0].role] = [s.members[0].role, ctrl.role];
    expect(() => buildHalosCellPlan(s)).toThrow(`${role}_MAPPING_MISMATCH`);
  });

  it('rejects Blank in members, wrong excluded Blank and mixed barcode types', () => {
    const blankMember = input(); blankMember.members[0].role = 'BLANK';
    expect(() => buildHalosCellPlan(blankMember)).toThrow();
    const blankPosition = input(); blankPosition.members[0].physicalPosition = 40;
    expect(() => buildHalosCellPlan(blankPosition)).toThrow('PHYSICAL_MEMBERSHIP_MISMATCH');
    const excluded = input(); excluded.excludedBlank.physicalPosition = 13;
    expect(() => buildHalosCellPlan(excluded)).toThrow();
    const mixed = input(); mixed.members[0].barcodeType = 'SYN-OTHER';
    expect(() => buildHalosCellPlan(mixed)).toThrow('MIXED_BARCODE_TYPE_PENDING');
  });

  it.each(['2026-02-30','2026-13-01','0000-01-01','2026-2-01','20261012',''])('rejects invalid workday %s', workDate => {
    const s = input(); s.dnb.workDate = workDate;
    expect(() => buildHalosCellPlan(s)).toThrow();
  });

  it('rejects placeholder/date mismatch and never silently revises an intended date', () => {
    const s = input(); s.dnb.id = 'DNBYYYYMMDD';
    expect(() => buildHalosCellPlan(s)).toThrow('DNB_DATE_MISMATCH');
    s.dnb.id = 'DNB20261013';
    expect(() => buildHalosCellPlan(s)).toThrow('DNB_DATE_MISMATCH');
    s.dnb.workDate = '2026-10-13';
    expect(buildHalosCellPlan(s).lineage.dnb.dateBasis).toBe('intended');
    const leap = input(); leap.dnb.workDate = '2028-02-29'; leap.dnb.id = 'DNB20280229';
    expect(() => buildHalosCellPlan(leap)).not.toThrow();
  });

  it('requires explicit synthetic provenance, revisions and template version', () => {
    for (const patch of [{mode:'production'}, {mappingStatus:'verified'}, {templateSha256:'other'}, {handoffRevision:0}, {pool:{id:'SYN-POOL',revision:0}}, {unexpected:'field'}]) {
      expect(() => buildHalosCellPlan({...input(), ...patch})).toThrow();
    }
    expect(() => buildHalosCellPlan(null)).toThrow();
  });

  it('is deterministic, detached and deeply frozen without mutating source', () => {
    const s = input(), before = structuredClone(s);
    const plan = buildHalosCellPlan(s);
    expect(s).toEqual(before);
    expect(buildHalosCellPlan(s)).toEqual(plan);
    expect(() => { (plan.rows as unknown[]).pop(); }).toThrow();
    expect(() => { (plan.rows[0].source as {lnHalos:string}).lnHalos = 'changed'; }).toThrow();
    expect(() => { (plan.headers as unknown as string[])[0] = 'changed'; }).toThrow();
    s.members[0].exportSampleId = 'SYN-CHANGED';
    expect(plan.rows[0].cells[0].value).toBe(before.members[0].exportSampleId);
  });

  it('detects changed, missing, extra, reordered and retyped output including blanks', () => {
    const mutations = [
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].cells[0], {value:'SYN-ALTERED'}); },
      (p: ReturnType<typeof candidate>) => { (p.rows as unknown[]).pop(); },
      (p: ReturnType<typeof candidate>) => { (p.rows as unknown[]).push(p.rows[0]); },
      (p: ReturnType<typeof candidate>) => { (p.rows as unknown[]).reverse(); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].cells[3], {type:'string',value:'1'}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].cells[4], {value:''}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].cells[4], {value:0}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].cells[4], {formula:'=""'}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.integrity, {cellPlanSha256:'0'.repeat(64)}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.lineage.pool, {revision:99}); },
      (p: ReturnType<typeof candidate>) => { Object.assign(p.rows[0].source, {lnHalos:'SYN-ALTERED'}); },
    ];
    for (const mutate of mutations) {
      const p = candidate(); mutate(p);
      expect(() => verifyHalosCellPlan(fixture, p)).toThrow('CELL_PLAN_INTEGRITY_MISMATCH');
    }
    expect(() => verifyHalosCellPlan(fixture, undefined)).toThrow('INVALID_CELL_PLAN_JSON');
  });

  it('binds source IDs, mapping and revision; self-consistent hashes cannot substitute a different snapshot', () => {
    const original = buildHalosCellPlan(fixture);
    const s = input(); s.pool.revision++;
    const revised = buildHalosCellPlan(s);
    expect(revised.integrity.snapshotSha256).not.toBe(original.integrity.snapshotSha256);
    expect(revised.integrity.cellPlanSha256).not.toBe(original.integrity.cellPlanSha256);
    expect(() => verifyHalosCellPlan(fixture, revised)).toThrow();
    const remapped = input();
    const a = remapped.members[0], b = remapped.members[1];
    remapped.members[0] = {...b, barcodeIndex:a.barcodeIndex};
    remapped.members[1] = {...a, barcodeIndex:b.barcodeIndex};
    expect(() => verifyHalosCellPlan(fixture, buildHalosCellPlan(remapped))).toThrow();
  });
});
