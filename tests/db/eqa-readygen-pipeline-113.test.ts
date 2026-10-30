import {it,expect,vi} from 'vitest';
import {task3Fixture,halosWorkbook,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {prepareReport} from '../../packages/readygen/reports';
it('EQA travels through real Task List 1-3 and HALOS export without PET and resolves organizer identity for native PDF',async()=>{
 const f=await task3Fixture([
  {ln:'9900099521',hn:'9900099921',pregnancy:'Singleton',sheet:1,eqa:true},
  {ln:'9900099522',hn:'9900099922',pregnancy:'Singleton',sheet:2},
  {ln:'9900099523',hn:'9900099923',pregnancy:'Twins',sheet:3}
 ]);
 try{
  const eqa=f.cases[0];
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=$1',[eqa.caseId])).rows[0].n).toBe(0);
  const info=f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}));
  const bytes=halosWorkbook({result:f.cases.map(x=>({sample:x.printed,gender:'Male'})),sampleinfo:info});
  const preview=await f.run(db=>previewHalosImport(db,f.u.staff,f.store,{name:'EQA_S990000001_10242026.xlsx',bytes}));
  expect(preview.counts.PATIENT).toBe(3);
  const row=preview.rows.find(x=>x.sampleKey===eqa.printed&&x.sheet==='result');
  expect(row?.classification).toBe('PATIENT');
  await f.run(db=>decideHalosImport(db,f.u.staff,{importId:preview.id,decision:'CONFIRM',expectedRowVersion:preview.rowVersion}));
  const report=await f.run(db=>prepareReport(db,f.u.staff,{store:f.store,templates:masters()},{rowId:row!.id}));
  expect(report.values?.patientName).toBe('SYNTHETIC ORGANIZER PATIENT');
  expect(report.values?.hn).toBe(eqa.hn);
  expect(report.sources.petSha256).toBeNull();
  expect(report.holds.map(x=>x.code)).not.toContain('PET_EVIDENCE_REQUIRED');
  expect(report.holds.map(x=>x.code)).not.toContain('PET_CLOCKS_REQUIRED');
  expect(report.holds.map(x=>x.code)).not.toContain('CLINICAL_DATA_NOT_READY');
  expect(report.holds.map(x=>x.code)).not.toContain('REQUEST_DOB_NOT_RECORDED');
  expect(report.holds.map(x=>x.code)).not.toContain('REQUEST_EDD_NOT_RECORDED');
  expect(JSON.stringify(report.values)).not.toContain('EQA');
 }finally{vi.unstubAllEnvs();await f.close();}
},240000);
