import {it,expect} from 'vitest';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {histFixture,goodRow,importBatch,pdfFor,confirmAll} from '../helpers/historical';
import {inspectHistoricalIntegrity} from '../../packages/historical/maintenance';

it('historical maintenance detects a missing original without changing drafts, evidence or audit',async()=>{
 const f=await histFixture();
 try{
  await f.configure();const row=goodRow(81);const batch=await importBatch(f,[row],[{name:row.pdf_file!,bytes:pdfFor(row)}]);
  expect((await confirmAll(f,batch)).summary.promoted).toBe(1);
  const snapshot=async()=>JSON.stringify((await f.db.query("SELECT (SELECT jsonb_agg(to_jsonb(d)) FROM historical_draft d) drafts,(SELECT jsonb_agg(to_jsonb(e)) FROM historical_eligibility_evaluation e) evaluations,(SELECT jsonb_agg(to_jsonb(a) ORDER BY sequence) FROM audit_chain a) audit")).rows);
  const before=await snapshot(),r=await inspectHistoricalIntegrity(f.db,f.verifier,f.store);
  expect(r.issues).toEqual([]);expect(r.checkedFiles).toBeGreaterThan(0);expect(r.checkedRecords).toBe(1);expect(r.auditValid).toBe(true);
  const hash=(await f.db.query<{sha256:string}>("SELECT sha256 FROM historical_batch_file WHERE role='PDF' LIMIT 1")).rows[0].sha256;
  await unlink(path.join(f.store.root,'sha256',hash.slice(0,2),hash.slice(2,4),hash));
  const damaged=await inspectHistoricalIntegrity(f.db,f.verifier,f.store);
  expect(damaged.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'HISTORICAL_ORIGINAL_MISSING'})]));
  expect(await snapshot()).toBe(before);expect(JSON.stringify(damaged)).not.toContain('9901081');
  await expect(inspectHistoricalIntegrity(f.db,{...f.verifier,roles:['ANC_NURSE']},f.store)).rejects.toThrow('FORBIDDEN');
 }finally{await f.close();}
},60000);
