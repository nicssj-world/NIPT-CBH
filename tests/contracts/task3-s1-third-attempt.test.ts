import {it,expect} from 'vitest';
import {task3Fixture,halosWorkbook} from '../helpers/task3';
import {previewHalosImport} from '../../packages/readygen/halos-import';

// Owner 2026-11-13: S1 may be repeated twice (-1 → -2 → -3). The -3 attempt goes through a real Batch, the HALOS/NIFTY export pair,
// and the HALOS result import must map its result row to exactly that attempt (and its sample-info row through the NIFTY vendor ID).
it('the S1 third attempt (-3) is filled into a Batch, exported and its HALOS result maps to that attempt',async()=>{
 const f=await task3Fixture([{ln:'9900099521',hn:'9900099961',pregnancy:'Singleton',sheet:1,s1ThirdAttempt:true},{ln:'9900099522',hn:'9900099962',pregnancy:'Singleton',sheet:2},{ln:'9900099523',hn:'9900099963',pregnancy:'Twins',sheet:3}]);
 try{
  const [third,other]=f.cases;
  expect(third.printed).toMatch(/^\d{2}B\d{9}-3$/);expect(other.printed).toMatch(/-1$/);
  const attempt=(await f.db.query<{attempt_number:number;state:string}>('SELECT attempt_number,state FROM analytical_attempt WHERE id=$1',[third.attemptId])).rows[0];
  expect(attempt.attempt_number).toBe(3);
  // NIFTY drops the analytical suffix as for -1/-2; the HALOS task mapping keeps the printed -3 ID.
  expect(third.vendorId).toBe(third.printed.slice(0,-2));
  const halos=(await f.db.query<{sample:string}>("SELECT m->>'sampleId' sample FROM lab_bench_export h CROSS JOIN LATERAL jsonb_array_elements(h.mapping) m WHERE h.kind='HALOS_TASK_XLSX' AND m->>'attemptId'=$1",[third.attemptId])).rows;
  expect(halos).toEqual([{sample:third.printed}]);
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000021_11132026.xlsx',bytes:halosWorkbook({result:[{sample:third.printed},{sample:other.printed}],sampleinfo:[{id:third.vendorId,fetus:third.pregnancy,ga:'17,6'},{id:other.vendorId,fetus:other.pregnancy,ga:'17,6'}]})}));
  const row=imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===third.printed)!;
  expect(row).toMatchObject({classification:'PATIENT',reason:'FROZEN_EXPORT_MEMBER',attemptId:third.attemptId,caseId:third.caseId});
  // The result row is joined to its HALOS sample-info row through the NIFTY vendor ID (suffix dropped).
  const info=(await f.db.query<{info:string|null}>('SELECT sampleinfo_row_id info FROM halos_import_row WHERE id=$1',[row.id])).rows[0];expect(info.info).not.toBeNull();
  const otherRow=imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===other.printed)!;
  expect(otherRow).toMatchObject({classification:'PATIENT',attemptId:other.attemptId});
 }finally{await f.close();}
},300000);
