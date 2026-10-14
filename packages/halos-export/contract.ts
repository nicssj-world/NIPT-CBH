import {createHash} from 'node:crypto';
import {z} from 'zod';

/** Internal synthetic proposal only. This module never serializes a HALOS file. */
export const CONTRACT = 'p4b-halos-synthetic-v1' as const;
export const TEMPLATE_SHA256 = '1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec';
export const HEADERS = Object.freeze([
  '*Sample ID', '*Lane ID', '*DNB ID\n(20 characters limited)', '*Barcode ID',
  'Sub-Library Conc. (ng/μl)',
] as const);
import {BARCODE_ORDER} from './barcodes';
export {BARCODE_ORDER} from './barcodes';

const opaque = z.string().min(1).refine(v => v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v), 'INVALID_OPAQUE_TEXT');
const revision = z.number().int().positive();
const reference = z.strictObject({id: opaque, revision});
const workDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number(value.slice(0, 4)) >= 1 && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'INVALID_DNB_DATE');

const member = z.strictObject({
  memberKey: opaque,
  physicalPosition: z.number().int().min(1).max(48),
  role: z.enum(['PATIENT', 'PC', 'NC']),
  // All three are supplied frozen values. A-column selection is an unresolved upstream decision.
  exportSampleId: opaque,
  printedSampleId: opaque,
  lnHalos: opaque,
  barcodeIndex: z.number().int().min(1).max(48),
  barcodeType: opaque,
});

/** Proposed adapter DTO, NOT an assertion about P4's eventual schema or trusted lineage. */
const snapshotSchema = z.strictObject({
  contract: z.literal(CONTRACT),
  mode: z.literal('synthetic'),
  mappingStatus: z.literal('synthetic-fixture-unverified'),
  batch: reference,
  placement: reference,
  pool: reference,
  handoffRevision: revision,
  templateSha256: z.literal(TEMPLATE_SHA256),
  dnb: z.strictObject({
    id: opaque,
    workDate,
    dateBasis: z.enum(['intended', 'actual']),
  }),
  excludedBlank: z.strictObject({physicalPosition: z.literal(40), role: z.literal('BLANK')}),
  members: z.array(member).length(47),
}).superRefine((snapshot, ctx) => {
  const fail = (message: string) => ctx.addIssue({code: 'custom', message});
  if (snapshot.dnb.id !== `DNB${snapshot.dnb.workDate.replaceAll('-', '')}`) fail('DNB_DATE_MISMATCH');
  for (const field of ['memberKey', 'physicalPosition', 'exportSampleId', 'lnHalos', 'printedSampleId', 'barcodeIndex'] as const) {
    if (new Set(snapshot.members.map(m => m[field])).size !== 47) fail(`DUPLICATE_${field}`);
  }
  const positions = snapshot.members.map(m => m.physicalPosition);
  if (positions.includes(40) || Array.from({length: 48}, (_, i) => i + 1).filter(p => p !== 40).some(p => !positions.includes(p))) fail('PHYSICAL_MEMBERSHIP_MISMATCH');
  if (snapshot.members.filter(m => m.role === 'PC').length !== 1 || snapshot.members.find(m => m.role === 'PC')?.physicalPosition !== 1) fail('PC_MAPPING_MISMATCH');
  if (snapshot.members.filter(m => m.role === 'NC').length !== 1 || snapshot.members.find(m => m.role === 'NC')?.physicalPosition !== 25) fail('NC_MAPPING_MISMATCH');
  if (snapshot.members.filter(m => m.role === 'PATIENT').length !== 45) fail('PATIENT_COUNT_MISMATCH');
  if (snapshot.members.some((m, i) => m.barcodeIndex !== BARCODE_ORDER[i])) fail('BARCODE_ORDER_MISMATCH');
  if (new Set(snapshot.members.map(m => m.barcodeType)).size !== 1) fail('MIXED_BARCODE_TYPE_PENDING');
});

export type HalosSnapshotInput = z.input<typeof snapshotSchema>;
export type HalosMember = HalosSnapshotInput['members'][number];
type StringCell = Readonly<{type: 'string'; value: string}>;
type NumberCell = Readonly<{type: 'number'; value: number}>;
/** Blank has no value, formula or empty-string payload. Writer implementation is deferred. */
type BlankCell = Readonly<{type: 'blank'}>;
export type Cell = StringCell | NumberCell | BlankCell;
export type ExportRow = Readonly<{
  excelRow: number;
  source: Readonly<HalosMember>;
  cells: readonly [StringCell, StringCell, StringCell, NumberCell, BlankCell];
}>;
export type HalosCellPlan = Readonly<{
  contract: typeof CONTRACT;
  usage: 'synthetic-cell-plan-only';
  sheet: 'Sheet1';
  range: 'A1:E48';
  headers: typeof HEADERS;
  lineage: Readonly<{
    batch: Readonly<{id: string; revision: number}>;
    placement: Readonly<{id: string; revision: number}>;
    pool: Readonly<{id: string; revision: number}>;
    handoffRevision: number;
    templateSha256: string;
    dnb: Readonly<HalosSnapshotInput['dnb']>;
    mappingStatus: 'synthetic-fixture-unverified';
  }>;
  rows: readonly ExportRow[];
  integrity: Readonly<{snapshotSha256: string; orderedMembersSha256: string; cellPlanSha256: string}>;
}>;

/** Stable JSON encoding: sorted object keys, ordered arrays; not a vendor hash specification. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const text = (value: string): StringCell => ({type: 'string', value});

/** Reject invalid input; never sort, fill, renumber, normalize IDs or infer a physical mapping. */
export function buildHalosCellPlan(input: unknown): HalosCellPlan {
  const snapshot = snapshotSchema.parse(input);
  const rows: ExportRow[] = snapshot.members.map((source, i) => ({
    excelRow: i + 2,
    source,
    cells: [text(source.exportSampleId), text('L01'), text(snapshot.dnb.id),
      {type: 'number', value: source.barcodeIndex}, {type: 'blank'}],
  }));
  const payload = {
    contract: CONTRACT, usage: 'synthetic-cell-plan-only' as const,
    sheet: 'Sheet1' as const, range: 'A1:E48' as const, headers: HEADERS,
    lineage: {
      batch: snapshot.batch, placement: snapshot.placement, pool: snapshot.pool,
      handoffRevision: snapshot.handoffRevision, templateSha256: snapshot.templateSha256,
      dnb: snapshot.dnb, mappingStatus: snapshot.mappingStatus,
    },
    rows,
  };
  return freeze({...payload, integrity: {
    snapshotSha256: hash(snapshot), orderedMembersSha256: hash(snapshot.members), cellPlanSha256: hash(payload),
  }});
}

/** Compare every cell, identity, order, provenance and digest against the supplied source. */
export function verifyHalosCellPlan(snapshot: unknown, candidate: unknown): void {
  const expected = buildHalosCellPlan(snapshot);
  // Candidates must be JSON data. Cycles/BigInt/non-JSON input fail closed.
  let actual: string;
  try {
    const json = JSON.stringify(candidate);
    if (json === undefined) throw new Error('Not JSON');
    actual = canonical(JSON.parse(json));
  } catch {
    throw new Error('INVALID_CELL_PLAN_JSON');
  }
  if (actual !== canonical(expected)) throw new Error('CELL_PLAN_INTEGRITY_MISMATCH');
}
