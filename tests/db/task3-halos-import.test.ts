import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {task3Fixture,halosWorkbook} from '../helpers/task3';
import {previewHalosImport,decideHalosImport,readHalosSource,resolveSample} from '../../packages/readygen/halos-import';

it('HALOS import archives the original, resolves only through the frozen export and classifies every row before confirmation',async()=>{
 const f=await task3Fixture();try{
  const [a,b,c]=f.cases,[pc,nc]=f.controls;
  const info=f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}));
  const bytes=halosWorkbook({
   result:[{sample:pc,t13:'TH13',t18:'TH18',t21:'TH21',sex:''},{sample:a.printed},{sample:b.printed,gender:'Male'},{sample:c.printed,gender:'Male'},{sample:nc,sex:''},
    // A HALOS-only sample (never exported) and one written with a pasted TAB, exactly as seen in the Owner's real file.
    {sample:'99B990999999-1'},{sample:'\t'+a.printed.replace(/-1$/,'-2')}],
   repeat:[{sample:b.printed,gender:'Male'},{sample:'99B990999998-1',t21:'ML21',advice:'Rerun',chip:'S990000000'}],sampleinfo:info});
  const name='Sample analysis data_S990000001_10242026.xlsx';
  const p=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name,bytes}));
  expect(p.duplicate).toBe(false);expect(p.state).toBe('Previewed');expect(p.counts).toMatchObject({result:7,repeat:2,sampleinfo:3,PATIENT:3,CONTROL:2,UNMATCHED:2,DUPLICATE_ENTRY:1,REPEAT_HISTORY:1});
  const by=(s:string,sheet='result')=>p.rows.find(r=>r.sheet===sheet&&r.sampleKey===s)!;
  expect(by(a.printed).classification).toBe('PATIENT');expect(by(a.printed).attemptId).toBe(a.attemptId);
  expect(by(pc).classification).toBe('CONTROL');expect(by(pc).attemptId).toBeNull();
  expect(by('99B990999999-1').reason).toBe('NOT_IN_ANY_FROZEN_EXPORT');
  // "-2" of an exported "-1" is never matched by stripping the suffix; raw text (with its TAB) is preserved.
  const tabbed=p.rows.find(r=>r.sample.startsWith('\t'))!;expect(tabbed.classification).toBe('UNMATCHED');expect(tabbed.sampleKey).toBe(a.printed.replace(/-1$/,'-2'));
  expect(by(b.printed,'repeat').classification).toBe('DUPLICATE_ENTRY');expect(by('99B990999998-1','repeat').classification).toBe('REPEAT_HISTORY');
  // Original bytes are archived unchanged and readable later with an access log.
  const src=await f.run(t=>readHalosSource(t,f.u.staff,f.store,p.id));expect(createHash('sha256').update(src.bytes).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));expect(src.bytes.equals(bytes)).toBe(true);
  expect((await f.db.query("SELECT 1 FROM result_access_log WHERE purpose='LAB_HALOS_SOURCE_FILE'")).rows).toHaveLength(1);
  // Same bytes again: the same live import, no second set of rows.
  const again=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'renamed.xlsx',bytes}));expect(again.duplicate).toBe(true);expect(again.id).toBe(p.id);
  expect(Number((await f.db.query<{n:number}>('SELECT count(*)::int n FROM halos_import')).rows[0].n)).toBe(1);
  // Same name, different content: a warning that must be acknowledged before confirming.
  const other=halosWorkbook({result:[{sample:a.printed,ff:'15.1'}],sampleinfo:info});
  const q=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name,bytes:other}));
  expect(q.issues.map(i=>i.code)).toContain('NAME_COLLISION_DIFFERENT_CONTENT');
  await expect(f.run(t=>decideHalosImport(t,f.u.staff,{importId:q.id,decision:'CONFIRM',expectedRowVersion:q.rowVersion}))).rejects.toThrow('HALOS_WARNINGS_ACK_REQUIRED');
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:q.id,decision:'CANCEL',expectedRowVersion:q.rowVersion}));
  const confirmed=await f.run(t=>decideHalosImport(t,f.u.staff,{importId:p.id,decision:'CONFIRM',expectedRowVersion:p.rowVersion}));expect(confirmed.state).toBe('Confirmed');
  // Confirmed import and its rows are immutable evidence.
  await expect(f.db.query("UPDATE halos_import_row SET classification='PATIENT' WHERE import_id=$1",[p.id])).rejects.toThrow();
  await expect(f.db.query("UPDATE halos_import SET state='Previewed' WHERE id=$1",[p.id])).rejects.toThrow();
  await expect(f.db.query('DELETE FROM halos_import WHERE id=$1',[p.id])).rejects.toThrow();
  // ANC and auditors cannot upload.
  await expect(f.run(t=>previewHalosImport(t,f.u.anc,f.store,{name:'x.xlsx',bytes}))).rejects.toThrow('FORBIDDEN');
 }finally{vi.unstubAllEnvs();await f.close();}
},240000);

it('a sample ID that two frozen exports map to different attempts is ambiguous, and malformed workbooks are refused with a reason',async()=>{
 const f=await task3Fixture();try{
  const a=f.cases[0];
  // A second export member carrying the same vendor ID for another attempt (synthetic conflict injected into a copy of the mapping).
  const h=(await f.db.query<{id:string;mapping:unknown[]}>("SELECT id,mapping FROM lab_bench_export WHERE kind='HALOS_TASK_XLSX'")).rows[0];
  const other=f.cases[1];
  const pair=(await f.db.query<Record<string,unknown>>('SELECT * FROM lab_seq_export_pair LIMIT 1')).rows[0];
  const forged=(await f.db.query<{id:string}>("INSERT INTO lab_bench_export(batch_id,workbook_revision_id,kind,source_sha256,file_sha256,mapping,created_by) SELECT batch_id,workbook_revision_id,kind,source_sha256,file_sha256,$2,created_by FROM lab_bench_export WHERE id=$1 RETURNING id",
   [h.id,JSON.stringify([{exportRow:2,physicalSlot:5,sampleId:a.printed,attemptId:other.attemptId,roundId:other.roundId,caseId:other.caseId,overallOrdinal:1}])])).rows[0];
  await f.db.query('INSERT INTO lab_seq_export_pair(batch_id,workbook_revision_id,actual_pooling_id,nifty_export_id,halos_export_id,idempotency_key,manifest,created_by) VALUES($1,$2,$3,$4,$5,gen_random_uuid(),$6,$7)',
   [pair.batch_id,pair.workbook_revision_id,pair.actual_pooling_id,pair.nifty_export_id,forged.id,JSON.stringify(pair.manifest),pair.created_by]);
  expect(await resolveSample(f.db,a.printed)).toMatchObject({classification:'AMBIGUOUS',reason:'SAMPLE_ID_MAPS_TO_DIFFERENT_MEMBERS'});
  for(const [bytes,code] of [[Buffer.from('not a workbook'),'ZIP_SIGNATURE'],[halosWorkbook({result:[],sampleinfo:[]}),'HALOS_RESULT_SHEET_HAS_NO_ROWS']] as const)
   await expect(f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'bad.xlsx',bytes}))).rejects.toThrow(code);
  await expect(f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'bad.csv',bytes:Buffer.from('x')}))).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();}
},240000);
