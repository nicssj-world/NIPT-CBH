import {it,expect,describe} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {resultFixture,receivedCase,importReport,pdfDate,rowVersion,type ResultFixture} from '../helpers/results';
import {docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput} from '../helpers/sequencing';
import {bangkokToday} from '../../packages/lab/core';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';
import {f5Html} from '../../packages/pdf/f5';
import * as s from '../../packages/sequencing/service';
import * as docs5 from '../../packages/sequencing/documents';
import * as svc from '../../packages/results/service';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import * as intake from '../../packages/lab/intake';

// P4b + P5 integration regression (integration worktree only). Real services from both phases on one disposable PGlite database:
// a 47-member Pool → DNB/QC3 → verified handoff → sequencing → QC4 → simulated ANALYSIS_COMPLETE → F5, then the P5 import/link/gate path
// for one of the pooled attempts. Nothing here weakens a clinical gate; every assertion is a negative or a conservative-direction check.
async function chain(f:ResultFixture){
 const docs=await docDeps(),u=f.u;
 const p=await completedPool(f.db,u,docs.deps,45,'PATIENT_PC_NC'),created=await tx(f.db,async t=>s.createDnb(t,u.staff,dnbInput(p.batchId,p.poolSnapshotId,await version(t,p.batchId),u.staff.id))),dnbId=created.id!;
 const call=(fn:(t:Queryable,u:Principal,d:unknown)=>Promise<unknown>,extra:Record<string,unknown>={},actor=u.staff)=>tx(f.db,async t=>fn(t,actor,{batchId:p.batchId,dnbId,expectedVersion:await version(t,p.batchId),requestId:randomUUID(),...extra}));
 const deps5={store:docs.deps.store,render:async(d:Parameters<typeof f5Html>[0])=>Buffer.from('%PDF-1.4\n'+f5Html(d))};
 const issue=async(kind:'PRE_WORK'|'COMPLETED')=>{const input=async(t:Queryable)=>({batchId:p.batchId,dnbId,expectedVersion:await version(t,p.batchId),kind,purpose:'SYNTHETIC_SIMULATION'});
  await tx(f.db,async t=>docs5.issueF5(t,u.staff,await input(t),deps5,true));return tx(f.db,async t=>docs5.issueF5(t,u.staff,await input(t),deps5));};
 await issue('PRE_WORK');
 await call(s.transition,{transition:'DNB_START',reason:'จำลอง เริ่ม DNB'});await call(s.transition,{transition:'DNB_END',reason:'จำลอง จบ DNB'});
 for(const field of ['STD1','STD2','QC3'])await call(s.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
 for(const o of await s.observations(f.db,dnbId))await call(s.reviewObservation,{observationId:o.id,result:'Confirmed',note:'จำลอง ทวนสอบค่า DNB'},u.certifier);
 await call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง QC3 ไม่มี Clinical Pass'},u.certifier);
 const stored=await s.storedPool(f.db,p.batchId,p.poolSnapshotId),source=s.orderedSourceMembers(stored.snapshot);
 const members=source.map((m,i)=>({memberKey:m.memberKey,physicalPosition:m.physicalPosition,role:m.role,exportSampleId:`SYN-EXPLICIT-A-${i+1}`,printedSampleId:m.printedSampleId!,
  lnHalos:m.lnHalos??`SYN-EXPLICIT-CONTROL-${m.physicalPosition}`,barcodeIndex:BARCODE_ORDER[i],barcodeType:'SYN-EXPLICIT-UNVERIFIED'}));
 const handoff=await call(s.createHandoff,{mapping:{status:'synthetic-fixture-unverified',evidenceReference:'Explicit simulation fixture only; unapproved mapping and column A',members},reason:'จำลอง Mapping ที่ไม่รับรอง'}) as {id:string;fileHash:string};
 return {docs,p,dnbId,call,issue,members,handoff,deps5};
}
const makeRecord=()=>({purpose:'SYNTHETIC_SIMULATION',equipmentModel:'DNBSEQ-G50',equipmentId:'SYN-G50-01',sequencingId:'SYN-SEQUENCE-001',cartridgeId:'SYN-CARTRIDGE-001',flowCellId:'SYN-FLOW-001',idSource:'SCAN',barcodeType:'SYN-EXPLICIT-UNVERIFIED',barcodeRange:{from:1,to:128},recipe:'FCL-SE35',configuration:{readMode:'SE',readCycles:35,barcodeCycles:10,assay:'NIPT'},pressureKpa:'-81',diskSpaceGb:'501',wash:{lot:'SYN-WASH',preparedOn:bangkokToday(),expiry:'2099-12-31',preWash:true},reason:'จำลอง Sequencing record'});

async function toAnalysisComplete(f:ResultFixture){
 const c=await chain(f),{call,p,dnbId,members,handoff}=c,u=f.u;
 const record=makeRecord();
 const sequence=await call(s.createSequencing,record) as {id:string};
 const transfer=await call(s.transferHandoff,{handoffId:handoff.id,fileHash:handoff.fileHash,status:'Complete',evidenceHash:'a'.repeat(64),evidenceReference:'Synthetic transfer evidence; no real vendor import',purpose:'SYNTHETIC_SIMULATION'}) as {id:string};
 const verification={handoffId:handoff.id,transferId:transfer.id,observedRows:members,observedDnbId:`DNB${bangkokToday().replaceAll('-','')}`,lane:'L01',fileHash:handoff.fileHash,status:'Complete',evidenceHash:'b'.repeat(64),note:'จำลอง ทวนสอบ 1 ต่อ 1'};
 expect((await call(s.verifyHandoff,verification,u.certifier) as {result:string}).result).toBe('MATCH');
 await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_START',reason:'จำลอง เริ่ม Sequencing'});
 await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_END',reason:'จำลอง จบ Sequencing',firstCycle:{loadedDnb:'100',q30:'90',bic:'90',fit:'90'},postWash:true});
 return {...c,sequence,call,p,dnbId,u};
}
const finishQc4=async(c:Awaited<ReturnType<typeof toAnalysisComplete>>)=>{
 const {call,sequence,members,u,dnbId}=c,f=c;void f;
 const qc4={sequencingId:sequence.id,lane:'L01',metrics:{totalReads:'100000',uniqueReads:'90000',q30:'90',gcPercent:'40',fetalFraction:'10',dim:'1'},source:'DIRECT_ENTRY',evidenceHash:'d'.repeat(64)};
 await call(s.recordQc4,{...qc4,scope:'LANE'});for(const m of members)await call(s.recordQc4,{...qc4,scope:'SAMPLE',memberKey:m.memberKey});
 return {qc4,u,dnbId};
};
const hnOf=()=>`9900000${String(Math.floor(Math.random()*1e5)).padStart(5,'0')}`;
/** Gives a pooled case the same immutable HN + electronic Request the P5 cross-check reads (what P2 provides in the integrated app). */
async function enrich(f:ResultFixture,c:{caseId:string;roundId:string},collection='2026-10-10'){
 const hn=hnOf(),edd=new Date(Date.parse(collection)+194*86400000).toISOString().slice(0,10),payload={draft:{patient:{dob:'1996-03-31'},pregnancy:{type:'Singleton',edd,fetalSex:'DoNotWant'}}};
 await f.run(async t=>{await t.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[c.caseId,hn]);
  await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.u.staff.id]);});
 return hn;
}
const rv=async(f:ResultFixture,id:string)=>(await rowVersion(f,id)).row_version;
async function p5Link(f:ResultFixture,hn:string,attempt:{id:string;printed_sample_id:string|null},c:{roundId:string}){
 const {versionId}=await importReport(f,{kind:'SINGLETON',labNumber:attempt.printed_sample_id!,hn,collection:pdfDate('2026-10-10')});
 await f.run(async t=>svc.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:attempt.id,reason:'จำลอง ตรวจคู่ตามรอบและ Attempt',expectedRowVersion:await rv(f,versionId)}));
 await f.run(async t=>svc.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'จำลอง ยืนยันการเชื่อมโยง',expectedRowVersion:await rv(f,versionId)}));
 await f.run(async t=>svc.recordReview(t,f.u.staff,{versionId,valuesMatchPdf:true,abnormalAcknowledged:false,expectedRowVersion:await rv(f,versionId)}));
 return versionId;
}
const certify=async(f:ResultFixture,versionId:string)=>f.run(async t=>svc.certifyAttempt(t,f.u.certifier,{versionId,idempotencyKey:randomUUID().replaceAll('-',''),abnormalAcknowledged:false,expectedRowVersion:await rv(f,versionId)}));
const attemptRow=async(f:ResultFixture,id:string)=>(await f.db.query<{state:string;printed_sample_id:string;attempt_number:number}>('SELECT state,printed_sample_id,attempt_number FROM analytical_attempt WHERE id=$1',[id])).rows[0];
const releaseRows=async(f:ResultFixture)=>(await f.db.query<{n:number}>("SELECT (SELECT count(*) FROM result_release)::int+(SELECT count(*) FROM result_report_version WHERE state='CertifiedReleased')::int n")).rows[0].n;

describe('P4b → P5 interface on one integrated database',()=>{
 it('full P4b chain through QC4 + simulated ANALYSIS_COMPLETE never advances the analytical attempt; P5 stays BLOCKED on RG-06/RG-07; nothing releasable',async()=>{
  const f=await resultFixture();
  try{
   const c=await toAnalysisComplete(f),{u,call,sequence,p}=c,{qc4}=await finishQc4(c);
   const before=await attemptRow(f,p.attempts[0].id),attempt0={id:p.attempts[0].id,printed_sample_id:before.printed_sample_id};expect(before.printed_sample_id).toMatch(/^[0-9]{2}B[0-9]{9}-1$/);
   // QC4 reviewed (SyntheticReviewed) is evidence, not a clinical acceptance.
   for(const o of (await s.qc4Evidence(f.db,c.dnbId,sequence.id)).observations)await call(s.reviewQc4,{qc4Id:o.id,result:'SyntheticReviewed',criteriaVersion:s.QC4_CRITERIA,note:'จำลอง ตรวจ QC4 ไม่ใช่ Clinical Pass'},u.certifier);
   await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'ANALYSIS_COMPLETE',reason:'จำลอง วิเคราะห์เสร็จ ยัง HOLD'});
   await c.issue('COMPLETED');
   const w=await tx(f.db,t=>s.workspace(t,u.staff,p.batchId));expect(w.current).toMatchObject({state:'SYNTHETIC_COMPLETED',acceptance:'HOLD',clinicalUsable:false});
   // Attempt identity: no P4b step touches analytical_attempt.state; the simulation never becomes AnalysisComplete/FinalQcAccepted/Final.
   const after=await attemptRow(f,attempt0.id);expect(after).toEqual(before);
   expect((await f.db.query("SELECT count(*)::int n FROM analytical_attempt WHERE state IN ('AnalysisComplete','FinalQcAccepted','Final')")).rows[0]).toEqual({n:0});
   // P5 import/link/review of the pooled attempt's report uses the same attempt id and Printed Sample ID as the Pool member.
   const hn=await enrich(f,p.cases[0]);expect(after.printed_sample_id).toBe(attempt0.printed_sample_id);
   const member=s.orderedSourceMembers((await s.storedPool(f.db,p.batchId,p.poolSnapshotId)).snapshot).find(m=>m.printedSampleId===attempt0.printed_sample_id);expect(member).toBeTruthy();
   const versionId=await p5Link(f,hn,attempt0,p.cases[0]);
   const link=(await f.db.query<{attempt_id:string;round_id:string;state:string}>('SELECT attempt_id,round_id,state FROM result_report_version WHERE id=$1',[versionId])).rows[0];
   expect(link).toMatchObject({attempt_id:attempt0.id,round_id:p.cases[0].roundId,state:'ValidationBlocked'});
   const r=await certify(f,versionId);
   expect(r.outcome).toBe('BLOCKED');expect(r.waitsForP4b).toBe(true);
   expect(r.failed).toEqual(expect.arrayContaining(['RG-06:ANALYSIS_COMPLETION_NOT_RECORDED','RG-07:QC1_ONLY_NOT_FINAL_QC_ACCEPTED']));
   expect(await releaseRows(f)).toBe(0);void qc4;
  }finally{await f.close();}
 },300000);

 it('even if an upstream writer forced AnalysisComplete/FinalQcAccepted, the database release HOLD still refuses any release or CertifiedReleased state (RELEASE_HOLD_AL5)',async()=>{
  const f=await resultFixture();
  try{
   const c=await toAnalysisComplete(f),{p}=c,attempt0={id:p.attempts[0].id,printed_sample_id:(await attemptRow(f,p.attempts[0].id)).printed_sample_id};
   const hn=await enrich(f,p.cases[0]),versionId=await p5Link(f,hn,attempt0,p.cases[0]);
   // Emulates a future (unreviewed) adapter or a privileged mistake. RG-06/RG-07 become satisfiable, which is exactly why the DB hold must be independent.
   await f.db.query("UPDATE analytical_attempt SET state='AnalysisComplete' WHERE id=$1",[attempt0.id]);
   await f.db.query("UPDATE analytical_attempt SET state='FinalQcAccepted' WHERE id=$1",[attempt0.id]);
   const r=await certify(f,versionId);
   expect(r.failed.filter(x=>/^RG-0[67]:/.test(x))).toEqual([]);          // upstream gates now pass …
   expect(r.outcome).not.toBe('CertifiedReleased');
   expect(r.pending.length+r.failed.length).toBeGreaterThan(0);          // … but governance gates (OD-05/07/08) remain open
   expect(await releaseRows(f)).toBe(0);
   await expect(f.db.query("UPDATE result_report_version SET state='CertifiedReleased',row_version=row_version+1 WHERE id=$1",[versionId])).rejects.toThrow('RELEASE_HOLD_AL5');
   await expect(f.db.query("INSERT INTO result_release(version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW',$4)",[versionId,p.cases[0].caseId,p.cases[0].roundId,f.u.certifier.id])).rejects.toThrow('RELEASE_HOLD_AL5');
   expect(await releaseRows(f)).toBe(0);
  }finally{await f.close();}
 },300000);

 it('P4 guards survive the merge: a measured Pool member cannot be redrawn; Redraw / Stop+Repeat on a linked attempt keep P5 BLOCKED on RG-05 (identity never substituted)',async()=>{
  const f=await resultFixture();
  try{
   const c=await toAnalysisComplete(f),{p,u}=c,a0={id:p.attempts[0].id,printed_sample_id:(await attemptRow(f,p.attempts[0].id)).printed_sample_id};
   const hn0=await enrich(f,p.cases[0]),pooledVersion=await p5Link(f,hn0,a0,p.cases[0]);
   const beforeState=(await attemptRow(f,a0.id)).state;
   await expect(f.run(t=>intake.orderRedraw(t,u.certifier,{caseId:p.cases[0].caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง สั่งเจาะซ้ำหลัง Pool'}))).rejects.toThrow('MEASURED_SLOT_DISPOSITION_CONFLICT');
   expect((await attemptRow(f,a0.id)).state).toBe(beforeState);
   const r0=await certify(f,pooledVersion);expect(r0.outcome).toBe('BLOCKED');
   // A second, un-pooled case with a linked report: Redraw makes its round/attempt non-current.
   const redrawCase=await receivedCase(f),vRedraw=await p5Link(f,redrawCase.hn,{id:redrawCase.attemptId,printed_sample_id:(await attemptRow(f,redrawCase.attemptId)).printed_sample_id},redrawCase);
   await f.run(t=>intake.orderRedraw(t,u.certifier,{caseId:redrawCase.caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง สั่งเจาะซ้ำ'}));
   const rr=await certify(f,vRedraw);expect(rr.outcome).toBe('BLOCKED');expect(rr.failed.some(x=>x.startsWith('RG-05:'))).toBe(true);
   // A third case: Stop then Repeat creates attempt 2; the report stays bound to attempt 1 and cannot be certified.
   const repeatCase=await receivedCase(f),a1={id:repeatCase.attemptId,printed_sample_id:(await attemptRow(f,repeatCase.attemptId)).printed_sample_id},vRepeat=await p5Link(f,repeatCase.hn,a1,repeatCase);
   await f.db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[a1.id]);
   const rep=await f.run(t=>intake.orderRepeat(t,u.staff,{attemptId:a1.id,level:'RE_LIBRARY',reasonCode:'STOPPED_BY_LAB',note:'จำลอง ตรวจซ้ำ'}));
   expect(rep.attemptNumber).toBe(2);
   const bound=(await f.db.query<{attempt_id:string}>('SELECT attempt_id FROM result_report_version WHERE id=$1',[vRepeat])).rows[0];expect(bound.attempt_id).toBe(a1.id);
   const rp=await certify(f,vRepeat);expect(rp.outcome).toBe('BLOCKED');expect(rp.failed,JSON.stringify(rp)).toEqual(expect.arrayContaining([expect.stringMatching(/^RG-05:/)]));
   expect(await releaseRows(f)).toBe(0);
  }finally{await f.close();}
 },300000);

 it('F5 / F4 task-form originals are never accepted as clinical result PDFs by the P5 parser',async()=>{
  const f=await resultFixture();
  try{
   const c=await toAnalysisComplete(f),{p}=c;void p;
   const docs=(await f.db.query<{file_sha256:string}>("SELECT file_sha256 FROM p4c_document UNION ALL SELECT file_sha256 FROM p4b_document")).rows;expect(docs.length).toBeGreaterThan(0);
   for(const d of docs){
    const bytes=await c.docs.deps.store.get(d.file_sha256);
    const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'task-form.pdf',actorId:f.u.staff.id,jobId:null},bytes));
    await f.run(t=>parseIntake(t,f.store,id,{maxBytes:10*1024*1024,acceptZip:true}));
    const row=(await f.db.query<{state:string;template_kind:string|null}>('SELECT state,template_kind FROM result_intake_file WHERE id=$1',[id])).rows[0];
    expect(row.state).not.toBe('Imported');expect(['Rejected','Duplicate','Parsed']).toContain(row.state);
    if(row.state==='Parsed')expect(row.template_kind).toBe('UNKNOWN');
    const imported=await f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:[id]})).catch((e:Error)=>e);
    if(!(imported instanceof Error))expect(imported[0].outcome).not.toMatch(/Linked|Imported.*RESULT/);
    expect((await f.db.query("SELECT count(*)::int n FROM result_report_version WHERE kind='RESULT' AND intake_file_id=$1",[id])).rows[0]).toEqual({n:0});
   }
  }finally{await f.close();}
 },300000);
});
