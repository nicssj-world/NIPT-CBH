import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {sendToHis} from '../../packages/results/send-his';
import {confirmBoard,confirmDetail,saveConfirm,confirmReport,confirmScreeningReport} from '../../packages/confirm/service';
import {confirmStats} from '../../packages/confirm/stats';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const fixture=()=>task3Fixture([
 {ln:'9900099611',hn:'9900099961',pregnancy:'Singleton',sheet:1},
 {ln:'9900099612',hn:'9900099962',pregnancy:'Singleton',sheet:2},
 {ln:'9900099613',hn:'9900099963',pregnancy:'Singleton',sheet:3}]);
type Hr={risks?:[string,string,string];sca?:[string,string,string,string]};
/** One synthetic PDF taken through review and "ส่ง HIS": a certified, Active release (risks order: T21, T18, T13). */
async function release(f:F,index:number,hr?:Hr){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null,...hr});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`SYNTHETIC-confirm-${index}.pdf`,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:!!hr,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 const versionId=done.items[0].versionId!,rv=(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0].row_version;
 const sent=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:!!hr,items:[{versionId,expectedRowVersion:rv}]}));
 expect(sent.items[0].outcome).toBe('CertifiedReleased');
 return versionId;
}
const PDF=Buffer.from('%PDF-1.4\n% SYNTHETIC outlab karyotype report\n%%EOF\n');
const T21:Hr={risks:['High Risk','Low Risk','Low Risk']};
const T21_XO:Hr={risks:['High Risk','Low Risk','Low Risk'],sca:['Detected','Not Detected','Not Detected','Not Detected']};
const T18:Hr={risks:['Low Risk','High Risk','Low Risk']};
const base=(caseId:string,versionId:string,expectedSequence:number|null=null)=>({caseId,versionId,expectedSequence});

it('lists only High Risk cases with their screening findings; a result needs the PDF and every finding; corrections are new revisions',async()=>{
 const f=await fixture();try{
  const v0=await release(f,0,T21_XO);await release(f,1);const v2=await release(f,2,T18);
  const c0=f.cases[0].caseId,c2=f.cases[2].caseId;
  let b=await f.run(t=>confirmBoard(t,f.admin,{fy:null}));
  // the Low Risk case 1 is not followed
  expect(b.counts).toEqual({ALL:2,PENDING:2,RESULTED:0,NOT_DONE:0});
  expect(b.rows.map(r=>r.caseId).sort()).toEqual([c0,c2].sort());
  const r0=b.rows.find(r=>r.caseId===c0)!;
  expect(r0).toMatchObject({versionId:v0,screen:['t21','xo'],status:'PENDING',record:null,concordant:null});
  expect(r0.waitingDays).toBeGreaterThanOrEqual(0);

  // a result without its PDF, with a missing finding, without a method, or with a file that is not a PDF is refused
  const result={...base(c0,v0),status:'RESULTED',method:'KARYOTYPE',specimen:'AMNIOTIC_FLUID',outlabName:'SYNTHETIC outlab',procedureDate:'2026-11-01',reportDate:'2026-11-15',resultText:'47,XX,+21'};
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE'}}))).rejects.toMatchObject({code:'CONFIRM_PDF_REQUIRED'});
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE'}},PDF))).rejects.toMatchObject({code:'CONFIRM_FINDINGS_INCOMPLETE'});
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE',t13:'FALSE_POSITIVE'}},PDF))).rejects.toMatchObject({code:'CONFIRM_FINDINGS_INCOMPLETE'});
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,method:null,findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE'}},PDF))).rejects.toMatchObject({code:'CONFIRM_METHOD_REQUIRED'});
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE'}},Buffer.from('not a pdf')))).rejects.toMatchObject({code:'CONFIRM_NOT_PDF'});
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,procedureDate:'2026-11-20',findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE'}},PDF))).rejects.toThrow(/CONFIRM_DATE_ORDER/);

  const s1=await f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE',xo:'FALSE_POSITIVE'}},PDF));
  expect(s1.status).toBe('RESULTED');
  // a stale screen (expectedSequence null after a revision exists) is refused
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...result,findings:{t21:'TRUE_POSITIVE',xo:'TRUE_POSITIVE'}},PDF))).rejects.toMatchObject({code:'CONFIRM_CHANGED'});
  // a correction keeps the recorded PDF when no new file is sent
  const s2=await f.run(t=>saveConfirm(t,f.store,f.admin,{...result,expectedSequence:s1.sequence,findings:{t21:'TRUE_POSITIVE',xo:'TRUE_POSITIVE'}}));
  const d=await f.run(t=>confirmDetail(t,f.admin,c0));
  expect(d.row).toMatchObject({status:'RESULTED',concordant:true,waitingDays:null});
  expect(d.row.record).toMatchObject({sequence:s2.sequence,method:'KARYOTYPE',specimen:'AMNIOTIC_FLUID',resultText:'47,XX,+21',hasReport:true,reportDate:'2026-11-15',findings:{t21:'TRUE_POSITIVE',xo:'TRUE_POSITIVE'}});
  expect(d.history.map(h=>h.sequence)).toEqual([s2.sequence,s1.sequence]);
  expect((await f.run(t=>confirmReport(t,f.store,f.admin,c0))).bytes.equals(PDF)).toBe(true);
  // the full screening report is the exact released PDF (not the outlab file); an unfollowed Low Risk case is refused
  const shown=await f.run(t=>confirmScreeningReport(t,f.store,f.admin,c0));
  const releasedSha=(await f.db.query<{sha256:string}>('SELECT sha256 FROM result_report_version WHERE id=$1',[v0])).rows[0].sha256;
  expect(shown.bytes.equals(await f.store.get(releasedSha))).toBe(true);expect(shown.bytes.equals(PDF)).toBe(false);
  await expect(f.run(t=>confirmScreeningReport(t,f.store,f.admin,f.cases[1].caseId))).rejects.toMatchObject({code:'NOT_FOUND'});

  // a status without a result keeps only the note; a PDF or findings with it are refused
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...base(c2,v2),status:'DECLINED',note:'x'},PDF))).rejects.toMatchObject({code:'CONFIRM_PDF_ONLY_WITH_RESULT'});
  await f.run(t=>saveConfirm(t,f.store,f.admin,{...base(c2,v2),status:'DECLINED',method:'KARYOTYPE',note:'SYNTHETIC ปฏิเสธการเจาะ'}));
  const r2=(await f.run(t=>confirmDetail(t,f.admin,c2))).row;
  expect(r2.record).toMatchObject({status:'DECLINED',method:null,note:'SYNTHETIC ปฏิเสธการเจาะ',hasReport:false,findings:{}});

  b=await f.run(t=>confirmBoard(t,f.admin,{fy:null,tab:'RESULTED'}));
  expect(b.counts).toEqual({ALL:2,PENDING:0,RESULTED:1,NOT_DONE:1});
  expect(b.rows.map(r=>r.caseId)).toEqual([c0]);
  // the Low Risk case cannot be recorded
  await expect(f.run(t=>saveConfirm(t,f.store,f.admin,{...base(f.cases[1].caseId,v0),status:'DECLINED'}))).rejects.toMatchObject({code:'NOT_FOUND'});
  // revisions are insert-only
  await expect(f.db.query('UPDATE confirm_result_revision SET note=$1',['x'])).rejects.toThrow();
  const audits=(await f.db.query<{action:string}>("SELECT action FROM audit_chain WHERE action='CONFIRM_RESULT_RECORDED'")).rows;
  expect(audits).toHaveLength(3);
 }finally{await f.close();}
},600000);

it('concordance: True positive over findings with a result; Mosaic-other is not concordant; declined cases stay out of the %',async()=>{
 const f=await fixture();try{
  const v0=await release(f,0,T21_XO),v1=await release(f,1,T21),v2=await release(f,2,T18);
  const [c0,c1,c2]=f.cases.map(c=>c.caseId);
  const res={status:'RESULTED',method:'QF_PCR',specimen:'AMNIOTIC_FLUID'};
  await f.run(t=>saveConfirm(t,f.store,f.admin,{...base(c0,v0),...res,findings:{t21:'TRUE_POSITIVE',xo:'MOSAIC_OTHER'}},PDF));
  await f.run(t=>saveConfirm(t,f.store,f.admin,{...base(c1,v1),...res,status:'POSTNATAL',findings:{t21:'TRUE_POSITIVE'}},PDF));
  await f.run(t=>saveConfirm(t,f.store,f.admin,{...base(c2,v2),status:'DECLINED'}));
  const s=await f.run(t=>confirmStats(t,f.admin,{fy:'all'}));
  expect(s.cases).toEqual({followed:3,withResult:2,concordant:1});
  expect(s.status).toMatchObject({RESULTED:1,POSTNATAL:1,DECLINED:1,PENDING:0});
  // findings with a result: t21 ×2 (TP), xo ×1 (Mosaic-other) → 2/3; T18 of the declined case is screened but not confirmed
  expect(s.overall).toEqual({screened:4,confirmed:3,truePositive:2,falsePositive:0,mosaicOther:1,ppv:66.7});
  expect(s.byFinding.t21).toMatchObject({screened:2,confirmed:2,truePositive:2,ppv:100});
  expect(s.byFinding.t18).toMatchObject({screened:1,confirmed:0,ppv:null});
  expect(s.sca).toMatchObject({confirmed:1,mosaicOther:1,ppv:0});
  expect(s.trisomy).toMatchObject({screened:3,confirmed:2,ppv:100});
  // the current fiscal year holds these results; another year is empty
  const now=await f.run(t=>confirmStats(t,f.admin,{}));expect(now.cases.followed).toBe(3);
  expect((await f.run(t=>confirmStats(t,f.admin,{fy:now.fiscalYear!-1}))).overall.ppv).toBeNull();
  // ANC may read; ANC and the clinical approver may not record
  for(const roles of [['ANC_NURSE'],['CLINICAL_APPROVER']] as const)
   await expect(f.run(t=>saveConfirm(t,f.store,{...f.admin,roles:[...roles]},{...base(c2,v2),expectedSequence:1,status:'PENDING'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(f.run(t=>confirmStats(t,{...f.admin,roles:['IT_OPERATOR']},{}))).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.close();}
},600000);
