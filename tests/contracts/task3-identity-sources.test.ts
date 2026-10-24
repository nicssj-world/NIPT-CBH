import {it,expect} from 'vitest';
import {task3Fixture,halosWorkbook,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport,resolveSample} from '../../packages/readygen/halos-import';
import {reportCandidate} from '../../packages/readygen/reports';
import {ancCaseResults} from '../../packages/results/service';
import type {Principal} from '../../packages/security/policy';

// Printed identity comes from the authoritative HIS PET of the round: P[23] = collection^receipt, P[33] = Ward^ID/Passport.
// Ward is HIS order data only; access scope is the case's unit (case_unit_scope), never the Ward text. No Word rendering here.
it('report identity: P[23] collection before ^ and receipt after ^, P[33] ID after ^; Ward never scopes access; Backup -3 is not an attempt',async()=>{
 const f=await task3Fixture([{ln:'9900099561',hn:'9900099961',pregnancy:'Singleton',sheet:1,pet:{specimenAt:'20261020080000',receivedAt:'20261022093000',ward:'WARD-ANC-7',identity:'SYNTHETIC-ID-T3-0001'}},{ln:'9900099562',hn:'9900099962',pregnancy:'Singleton',sheet:2},{ln:'9900099563',hn:'9900099963',pregnancy:'Twins',sheet:3}]);
 try{
  const [a]=f.cases,deps={store:f.store,templates:masters()};
  expect(a.printed).toMatch(/-1$/);
  const backup=a.printed.replace(/-1$/,'-3'),second=a.printed.replace(/-1$/,'-2');
  const bytes=halosWorkbook({result:[{sample:a.printed,gender:'Female'},{sample:backup},{sample:second}],sampleinfo:[{id:a.vendorId,fetus:'Singleton',ga:'17,6'}]});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_IDENTITY.xlsx',bytes}));
  const by=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!;
  // Exact frozen-export membership only: the storage Backup "-3" and an unexported "-2" never fall back to the "-1" attempt.
  expect(by(a.printed)).toMatchObject({classification:'PATIENT',attemptId:a.attemptId});
  for(const k of [backup,second]){expect(by(k)).toMatchObject({classification:'UNMATCHED',attemptId:null});expect(await resolveSample(f.db,k)).toMatchObject({classification:'UNMATCHED',reason:'NOT_IN_ANY_FROZEN_EXPORT'});}
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-ID'});
  await recordPaperRequest(f,a,'Want');
  const c=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:by(a.printed).id}));
  // Collection (before ^) 20 Oct; receipt (after ^) 22 Oct; ID/Passport after ^ of P[33]; the Ward text is printed nowhere.
  expect(c.values).toMatchObject({collectDate_cbh:'20-Oct-2026',receivedDate_cbh:'22-Oct-2026',patientIDCard:'SYNTHETIC-ID-T3-0001',hn:'9900099961',sampleID:a.printed,ga:'17W 6D'});
  expect(JSON.stringify(c.values)).not.toContain('WARD-ANC-7');
  expect(c.holds.map(h=>h.code)).not.toContain('COLLECTION_DATE_SOURCES_DISAGREE');
  // Access follows the case unit only: a principal whose unit equals the Ward text sees nothing; the case's own unit does.
  const wardScoped={...f.u.anc,unitIds:['WARD-ANC-7']} as Principal;
  await expect(f.run(t=>ancCaseResults(t,wardScoped,a.caseId))).rejects.toThrow('NOT_FOUND');
  await expect(f.run(t=>ancCaseResults(t,f.u.anc,a.caseId))).resolves.toBeTruthy();
  expect((await f.db.query<{unit_id:string}>('SELECT unit_id FROM case_unit_scope WHERE case_id=$1',[a.caseId])).rows.map(r=>r.unit_id)).toEqual([f.u.unit]);
 }finally{await f.close();}
},300_000);
