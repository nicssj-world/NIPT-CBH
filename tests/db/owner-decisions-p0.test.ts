import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import * as rec from '../../packages/lab/records';
import {FIELDS,requiredSheetFields} from '../../packages/lab/fields';
import {renderDraftTaskPdf} from '../../packages/workbook/draft-preview';
import type {Queryable} from '../../packages/db/connection';
vi.mock('../../packages/workbook/draft-preview',()=>({renderDraftTaskPdf:vi.fn(async()=>Buffer.from('%PDF-SYNTHETIC-DRAFT-TEST'))}));

// Owner approval 2026-10-18: OD-A, OD-B, OD-G, OD-E/E2, OD-S/T and G07 (Task List auto-fill). Synthetic PGlite database only.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,docs:Awaited<ReturnType<typeof docDeps>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);docs=await docDeps();});
afterEach(async()=>{vi.unstubAllEnvs();await db.close();await docs.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn),V=(id:string)=>version(q(),id);
async function ready(n:number){
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];for(let i=0;i<n;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-(n-i)*60000)));cases.push(c);}
 return {cases,attempts:await Promise.all(cases.map(c=>attemptOf(q(),c.roundId)))};
}
const placedSlots=async(batchId:string)=>(await db.query<{slot_number:number;attempt_id:string}>('SELECT slot_number,attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL ORDER BY slot_number',[batchId])).rows;

describe('G07 — "เติมตัวอย่างจากคิว" fills the selected Task from the eligible FIFO queue',()=>{
 it('previews then places exactly the FIFO head into empty patient slots (max 15), never controls, never twice; PET receipt alone places nothing',async()=>{
  const {cases,attempts}=await ready(17);
  // Receipt never assigns by itself.
  const b=await run(t=>batch.createBatch(t,u.staff));expect(await placedSlots(b.batchId)).toEqual([]);
  // Urgent does not jump the FIFO fill (OD-A): the newest sample is urgent but stays last.
  await run(t=>intake.setUrgent(t,u.staff,{attemptId:attempts[16].id,urgent:true,reason:'จำลอง แพทย์ขอผลด่วน'}));
  const lnBefore=(await db.query('SELECT round_id,ln_halos FROM specimen_lab_number ORDER BY round_id')).rows;
  const p=await run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:1}));
  expect(p).toMatchObject({sheetNumber:1,freeSlots:15,queueSize:17});
  expect(p.candidates.map(c=>c.attemptId)).toEqual(attempts.slice(0,15).map(a=>a.id));
  expect(await placedSlots(b.batchId)).toEqual([]); // preview is read-only
  await expect(run(t=>batch.previewFill(t,u.anc,{batchId:b.batchId,sheetNumber:1}))).rejects.toMatchObject({code:'FORBIDDEN'});
  // A proposal that no longer matches the queue is refused and nothing is placed.
  await expect(run(t=>batch.fillFromQueue(t,u.staff,{batchId:b.batchId,expectedVersion:0,sheetNumber:1,attemptIds:attempts.slice(1,16).map(a=>a.id)}))).rejects.toMatchObject({code:'FILL_PROPOSAL_CHANGED'});
  expect(await placedSlots(b.batchId)).toEqual([]);
  const r=await run(t=>batch.fillFromQueue(t,u.staff,{batchId:b.batchId,expectedVersion:0,sheetNumber:1,attemptIds:p.candidates.map(c=>c.attemptId)}));
  expect(r.placed.map(x=>x.slot)).toEqual(Array.from({length:15},(_,i)=>i+2)); // slot 1 is the PC control
  expect(r.rejected).toEqual([]);
  expect((await placedSlots(b.batchId)).some(s=>[1,25,40].includes(s.slot_number))).toBe(false);
  // Identifiers come from the normal assignment path: LN Halos rows unchanged, printed IDs assigned once.
  expect((await db.query('SELECT round_id,ln_halos FROM specimen_lab_number ORDER BY round_id')).rows).toEqual(lnBefore);
  expect((await attemptOf(q(),cases[0].roundId)).printed_sample_id).toBe(r.placed[0].printedSampleId);
  // The same proposal cannot be placed twice; Task 1 is now full; Task 2 continues the queue.
  await expect(run(async t=>batch.fillFromQueue(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,attemptIds:p.candidates.map(c=>c.attemptId)}))).rejects.toMatchObject({code:'FILL_PROPOSAL_CHANGED'});
  expect((await run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:1}))).freeSlots).toBe(0);
  const p2=await run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:2}));
  expect(p2.candidates.map(c=>c.attemptId)).toEqual([attempts[15].id,attempts[16].id]);
  const r2=await run(async t=>batch.fillFromQueue(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:2,attemptIds:p2.candidates.map(c=>c.attemptId)}));
  expect(r2.placed.map(x=>x.slot)).toEqual([17,18]);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM lab_batch_event WHERE batch_id=$1 AND event_type='FIFO_FILL'",[b.batchId])).rows[0].n).toBe(2);
 });
 it('refuses to fill a Task that is already finalized',async()=>{
  const {attempts}=await ready(2);
  const b=await run(t=>batch.createBatch(t,u.staff));
  await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[attempts[0].id]}));
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,plannedWorkDate:'2026-10-12',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1}));
  await expect(run(t=>batch.previewFill(t,u.staff,{batchId:b.batchId,sheetNumber:1}))).rejects.toMatchObject({code:'PLACEMENT_LOCKED'});
  await expect(run(async t=>batch.fillFromQueue(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,attemptIds:[attempts[1].id]}))).rejects.toMatchObject({code:'PLACEMENT_LOCKED'});
  // OD-G: the user may still place manually into another open Task, and not into the finalized one.
  await expect(run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),attemptIds:[attempts[1].id],sheetNumber:1}))).rejects.toMatchObject({code:'PLACEMENT_LOCKED'});
  const r=await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),attemptIds:[attempts[1].id],sheetNumber:3}));
  expect(r.placed.map(x=>x.slot)).toEqual([33]);
 });
});

describe('OD-A / OD-G — urgent reason reuse, no automatic jump, chosen Task',()=>{
 it('an urgent sample that goes ahead reuses its recorded reason; a non-urgent one still needs its own; Task choice is honoured',async()=>{
  const {attempts}=await ready(4);
  await run(t=>intake.setUrgent(t,u.staff,{attemptId:attempts[3].id,urgent:true,reason:'จำลอง แพทย์ขอผลด่วน'}));
  // The FIFO head is still the oldest sample (urgent never jumps the queue by itself).
  expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[attempts[0].id]}))).toEqual({overtaken:0,reasonRequired:false,urgentReasonReused:false});
  expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[attempts[3].id]}))).toEqual({overtaken:3,reasonRequired:false,urgentReasonReused:true});
  expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[attempts[2].id,attempts[3].id]}))).toEqual({overtaken:2,reasonRequired:true,urgentReasonReused:false});
  const b=await run(t=>batch.createBatch(t,u.staff));
  await expect(run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[attempts[2].id]}))).rejects.toMatchObject({code:'QUEUE_OVERRIDE_REASON_REQUIRED'});
  const r=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[attempts[3].id],sheetNumber:2}));
  expect(r.placed).toMatchObject([{attemptId:attempts[3].id,slot:17}]);
  expect((await db.query<{reason:string;details:{reasonSource?:string}}>("SELECT reason,details FROM attempt_event WHERE attempt_id=$1 AND event_type='QUEUE_OVERRIDE'",[attempts[3].id])).rows)
   .toEqual([expect.objectContaining({reason:'จำลอง แพทย์ขอผลด่วน',details:expect.objectContaining({reasonSource:'URGENT_REASON'})})]);
 });
});

describe('OD-B — uncontrolled DRAFT preview before Finalize',()=>{
 it('renders the live plan with a DRAFT watermark, stores no document and is refused after Finalize',async()=>{
  const {attempts}=await ready(1);
  const b=await run(t=>batch.createBatch(t,u.staff));
  await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[attempts[0].id]}));
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,plannedWorkDate:'2026-10-18',plannedOperator:'จำลอง ผู้ปฏิบัติ',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  const out=await run(t=>rec.previewDraftF2(t,u.staff,{batchId:b.batchId,sheetNumber:1}));
  expect(out.bytes.subarray(0,5).toString()).toBe('%PDF-');
  const doc=vi.mocked(renderDraftTaskPdf).mock.calls.at(-1)![0];
  expect(doc).toMatchObject({sheetNumber:1,previewedBy:u.staff.id,plan:{workDate:'18/10/2569',operator:'จำลอง ผู้ปฏิบัติ'}});expect(out.fileName.startsWith('DRAFT-')).toBe(true);
  expect(doc.rows[0]).toMatchObject({printedId:'26N120261018-1'});expect(doc.rows[1].printedId).not.toBe('');
  expect(docs.rendered).toHaveLength(0); // The live preview uses the native Task renderer, never the HTML worksheet.
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM lab_document')).rows[0].n).toBe(0);
  for(const table of ['lab_document_copy','task_workbook_revision','task_workbook_export'])expect((await db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='LAB_DRAFT_PREVIEW'")).rows[0].n).toBe(1);
  await expect(run(t=>rec.previewDraftF2(t,u.anc,{batchId:b.batchId,sheetNumber:1}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await run(async t=>batch.planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber:1}));
  await expect(run(t=>rec.previewDraftF2(t,u.staff,{batchId:b.batchId,sheetNumber:1}))).rejects.toMatchObject({code:'DRAFT_PREVIEW_ONLY_BEFORE_FINALIZE'});
 });
});

describe('OD-E/E2 + OD-S/T — actual Library Preparation date, Extraction date, locked control IDs',()=>{
 it('keeps control IDs, requires a short reason for a different Library date, records Extraction separately and states the basis on Completed',async()=>{
  const {attempts}=await ready(1);
  const b=await run(t=>batch.createBatch(t,u.staff));const id=b.batchId;
  await run(t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:0,attemptIds:[attempts[0].id]}));
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1,plannedWorkDate:'2026-10-18',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1}));
  await run(async t=>rec.issuePreWork(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1},docs.deps));
  await run(async t=>batch.startExecution(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1}));
  const controlBefore=(await db.query<{c:string}>("SELECT payload->'slots'->0->>'printedControlId' c FROM lab_placement_snapshot WHERE batch_id=$1",[id])).rows[0].c;
  expect(controlBefore).toBe('26N120261018-1');
  const add=async(x:Record<string,unknown>)=>(await run(async t=>rec.recordObservation(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1,source:'DIRECT_ENTRY',...x}))).id;
  // F2-03 Extraction date is informational: recordable, never required, never a deviation.
  expect(requiredSheetFields(1).some(f=>f.id==='F2-03')).toBe(false);
  const ids=[await add({fieldId:'F2-03',value:{date:'2026-10-17'}})];
  await expect(add({fieldId:'F2-02',value:{date:'2026-10-19'}})).rejects.toMatchObject({code:'LIBRARY_DATE_DEVIATION_REASON_REQUIRED',details:{plannedWorkDate:'2026-10-18'}});
  await expect(add({fieldId:'F2-02',value:{date:'2026-10-18',deviationReason:'จำลอง ไม่ควรมีเหตุผล'}})).rejects.toMatchObject({code:'DEVIATION_REASON_NOT_APPLICABLE'});
  await expect(add({fieldId:'F2-05',value:{text:'จำลอง',deviationReason:'จำลอง เหตุผลผิดช่อง'}})).rejects.toThrow();
  ids.push(await add({fieldId:'F2-02',value:{date:'2026-10-19',deviationReason:'จำลอง เครื่องเสียเลื่อนหนึ่งวัน'}}));
  ids.push(await add({fieldId:'F2-05',value:{text:'จำลอง ผู้ปฏิบัติ'}}));
  for(const f of ['F2-13','F2-14'])ids.push(await add({fieldId:f,value:{lot:'SYN-LOT-1',expiry:'2027-01-31'}}));
  ids.push(await add({fieldId:'F2-24',value:{start:'09:00',end:'11:30'}}));
  for(const f of FIELDS.filter(x=>x.form==='F2'&&x.kind==='CHECK'&&x.required(1)))ids.push(await add({fieldId:f.id,item:f.item,value:{checked:true}}));
  for(const slot of [1,2])ids.push(await add({slot,fieldId:'F2-11',value:{before:true,after:true}}));
  await run(async t=>batch.endExecution(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1}));
  await run(t=>rec.reviewObservations(t,u.certifier,{observationIds:ids,result:'Confirmed'}));
  await run(async t=>rec.verifyExecution(t,u.certifier,{batchId:id,expectedVersion:await V(id),sheetNumber:1}));
  // Control IDs never changed (OD-T: locked at execution start).
  expect((await db.query<{c:string}>("SELECT payload->'slots'->0->>'printedControlId' c FROM lab_placement_snapshot WHERE batch_id=$1",[id])).rows[0].c).toBe(controlBefore);
  const sheetId=(await db.query<{id:string}>('SELECT id FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1',[id])).rows[0].id;
  expect(await rec.libraryDateDeviation(q(),id,sheetId)).toEqual({plannedWorkDate:'2026-10-18',actualLibraryDate:'2026-10-19',reason:'จำลอง เครื่องเสียเลื่อนหนึ่งวัน'});
  // OD-E2: the native master Completed would be ambiguous — held until QA accepts an annex format; nothing is issued.
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await db.query("UPDATE nipt_runtime_config SET mode='operational'");
  await expect(run(async t=>rec.issueCompleted(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1},docs.deps))).rejects.toMatchObject({code:'LIBRARY_DATE_DEVIATION_ANNEX_PENDING_QA'});
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM lab_document WHERE kind='COMPLETED'")).rows[0].n).toBe(0);
  await db.query("UPDATE nipt_runtime_config SET mode='synthetic'");vi.unstubAllEnvs();
  // The Chromium Completed states the basis unambiguously.
  await run(async t=>rec.issueCompleted(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1},docs.deps));
  const done=docs.rendered.at(-1)!;if(done.form!=='F2')throw Error();
  expect(done.dateBasis).toBe('รหัส Control สร้างจากวันที่ทำ Library Preparation ที่วางแผน 18/10/2569 (ล็อกเมื่อเริ่มปฏิบัติงาน) · วันที่ทำ Library Preparation จริง 19/10/2569 · เหตุผล: จำลอง เครื่องเสียเลื่อนหนึ่งวัน');
  expect(done.execution.find(x=>x.label.startsWith('วันที่ทำ DNA Extraction จริง'))?.value).toBe('17/10/2569');
  expect(done.execution.find(x=>x.label==='วันที่ทำ Library Preparation จริง')?.value).toContain('19/10/2569 — ต่างจากวันที่วางแผน');
 });
});
