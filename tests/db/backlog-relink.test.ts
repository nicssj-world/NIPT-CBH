import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {confirmImport,unlinkVersion,proposeLink,decideLink} from '../../packages/results/service';
import {runBacklogRelink,writeReport,BACKLOG_REASON_CODE} from '../../tools/migration/backlog-relink-20261107';
import type {Queryable} from '../../packages/db/connection';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
const count=async(f:F,table:string)=>(await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
const TABLES=['result_link_event','result_version_event','audit_chain','result_report_version','result_gate_evaluation','result_release','result_review','result_qc5_review','job_outbox','result_access_log'];
const snapshot=async(f:F)=>Object.fromEntries(await Promise.all(TABLES.map(async t=>[t,await count(f,t)])));

async function intake(f:F,spec:Parameters<typeof syntheticReportPdf>[0],name:string){
 const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},syntheticReportPdf(spec)));
 await f.run(t=>parseIntake(t,f.store,id,{maxBytes:10000000,acceptZip:true}));
 return id;
}
const spec=(f:F,i:number,extra:Record<string,unknown>={})=>({kind:(f.cases[i].pregnancy==='Twins'?'TWIN':'SINGLETON') as 'TWIN'|'SINGLETON',labNumber:f.cases[i].printed,hn:f.cases[i].hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null,...extra});
/** What the OLD rule left behind: an imported final PDF that was never linked and no person ever touched. Calling confirmImport outside a
 *  transaction makes the system link step skip itself (TRANSACTION_REQUIRED), which is exactly an Unlinked row with no link event. */
async function stuck(f:F,i:number,name:string,extra:Record<string,unknown>={}){
 const intakeId=await intake(f,spec(f,i,extra),name);
 const r=await confirmImport(f.db,f.admin,{intakeIds:[intakeId]});
 expect(r[0].outcome).toBe('Unlinked');
 return r[0].versionId!;
}
/** Records every statement so a dry run can be proven to issue no write. */
function spy(db:Queryable){const sql:string[]=[];return {sql,db:{query:(async(q:string,p?:unknown[])=>{sql.push(q);return db.query(q,p);}) as Queryable['query']} as Queryable};}
const CARRIES_WRITE=/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT\s+[^;]*\bFOR\s+UPDATE|SELECT\s+pg_advisory)/i;

it('dry run writes nothing: READ ONLY transaction, no write statement, every row count equal; apply then links the DOB-differing PDF, leaves the HN-only one, creates no release/review/QC5/outbox/void',async()=>{
 const f=await task3Fixture();const out=mkdtempSync(path.join(os.tmpdir(),'relink-'));try{
  const a=await stuck(f,0,'SYNTHETIC-backlog-a.pdf',{dob:'02-Feb-1985'});            // DOB differs from the request: the old rule refused it
  const b=await stuck(f,1,'SYNTHETIC-backlog-b.pdf',{labNumber:'26P77000001'});      // HN matches, lab number does not: never a match
  const before=await snapshot(f);
  const s=spy(f.db);
  const dry=await runBacklogRelink(s.db,f.admin,{apply:false});
  expect(await snapshot(f)).toEqual(before);
  expect(s.sql[0]).toBe('BEGIN TRANSACTION READ ONLY');expect(s.sql.at(-1)).toBe('ROLLBACK');
  expect(s.sql.filter(q=>CARRIES_WRITE.test(q))).toEqual([]);
  expect(dry.rows).toHaveLength(2);
  const da=dry.rows.find(r=>r.versionId===a)!,db_=dry.rows.find(r=>r.versionId===b)!;
  expect(da).toMatchObject({from:'Unlinked',wouldBecome:true,reason:null,match:{hn:f.cases[0].hn,ln:f.cases[0].ln},reviewed:false});
  expect(['PendingCertification','ValidationBlocked']).toContain(da.to);expect(da.board).toBe('READY');
  expect(db_).toMatchObject({from:'Unlinked',to:'Unlinked',match:null,board:'ACTION'});expect(db_.reason).toBeTruthy();
  expect(await stateOf(f,a)).toBe('Unlinked');

  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  expect(applied.rows).toHaveLength(2);
  const aa=applied.rows.find(r=>r.versionId===a)!,ab=applied.rows.find(r=>r.versionId===b)!;
  expect(aa).toMatchObject({from:'Unlinked',wouldBecome:false,reason:null,rule:'AUTO_UNIQUE',reviewed:false,board:'READY',match:{hn:f.cases[0].hn,ln:f.cases[0].ln}});
  expect(['PendingCertification','ValidationBlocked']).toContain(aa.to);expect(aa.to).toBe(da.to);
  expect(await stateOf(f,a)).toBe(aa.to);
  expect((await f.db.query('SELECT case_id,link_mode FROM result_report_version WHERE id=$1',[a])).rows[0]).toEqual({case_id:f.cases[0].caseId,link_mode:'AUTO_UNIQUE'});
  expect(ab).toMatchObject({to:'Unlinked',board:'ACTION',match:null});expect(ab.reason).toBe(db_.reason);
  expect(await stateOf(f,b)).toBe('Unlinked');
  const after=await snapshot(f);
  for(const t of ['result_release','result_review','result_qc5_review','job_outbox','result_access_log'])expect(after[t],t).toBe(before[t]);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_report_version WHERE state='Voided'")).rows[0].n).toBe(0);
  const audits=(await f.db.query<{resource_id:string;details:Record<string,unknown>}>("SELECT resource_id,details FROM audit_chain WHERE action='RESULT_BACKLOG_RELINK' ORDER BY sequence")).rows;
  expect(audits.map(x=>x.resource_id).sort()).toEqual([a,b].sort());
  expect(audits.every(x=>x.details.reasonCode===BACKLOG_REASON_CODE)).toBe(true);
  expect(audits.find(x=>x.resource_id===a)!.details).toMatchObject({previousState:'Unlinked',resultingState:aa.to,outcome:'RELINKED'});
  expect((await f.db.query("SELECT DISTINCT actor_id FROM audit_chain WHERE action='RESULT_BACKLOG_RELINK'")).rows).toEqual([{actor_id:f.admin.id}]);

  // The report lists every row, with HN/LN and without any patient name.
  const stem=writeReport(out,applied.rows,true);const csv=readFileSync(stem+'.csv','utf8'),md=readFileSync(stem+'.md','utf8');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(3);
  for(const id of [a,b]){expect(csv).toContain(id);expect(md).toContain(id);}
  expect(csv+md).toContain(f.cases[0].hn);expect(csv+md).not.toMatch(/SYNTHETIC PATIENT/);
 }finally{rmSync(out,{recursive:true,force:true});vi.unstubAllEnvs();await f.close();}
},600000);

it('a LinkConflict is unlinked (its only allowed exit) and a version a person already decided is left with HUMAN_DECISION_EXISTS; nothing is reviewed, certified, voided or sent',async()=>{
 const f=await task3Fixture();try{
  // LinkConflict: a person approved a link whose HN differs from the patient's.
  const conflictIntake=await intake(f,spec(f,0,{hn:'9900099999'}),'SYNTHETIC-backlog-conflict.pdf');
  const c=(await confirmImport(f.db,f.admin,{intakeIds:[conflictIntake]}))[0].versionId!;
  const c0=f.cases[0];
  await f.run(async t=>proposeLink(t,f.u.staff,{versionId:c,roundId:c0.roundId,attemptId:c0.attemptId,reason:'SYNTHETIC person links the PDF by hand',expectedRowVersion:await rowVersion(f,c)}));
  await f.run(async t=>decideLink(t,f.u.certifier,{versionId:c,decision:'APPROVE',reason:'SYNTHETIC second person approves',expectedRowVersion:await rowVersion(f,c)}));
  expect(await stateOf(f,c)).toBe('LinkConflict');
  // A matching PDF that a person unlinked for good.
  const decidedIntake=await intake(f,spec(f,1),'SYNTHETIC-backlog-decided.pdf');
  const d=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[decidedIntake]})))[0].versionId!;
  await f.run(async t=>unlinkVersion(t,f.admin,{versionId:d,reason:'SYNTHETIC person returned the link to the manual path',expectedRowVersion:await rowVersion(f,d)}));
  expect(await stateOf(f,d)).toBe('Unlinked');
  const before=await snapshot(f),events=await count(f,'result_link_event');

  const dry=await runBacklogRelink(f.db,f.admin,{apply:false});
  expect(await snapshot(f)).toEqual(before);
  expect(dry.rows.find(r=>r.versionId===c)).toMatchObject({from:'LinkConflict',to:'Unlinked',wouldBecome:true});
  expect(dry.rows.find(r=>r.versionId===d)).toMatchObject({from:'Unlinked',to:'Unlinked',reason:'HUMAN_DECISION_EXISTS'});

  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  const rc=applied.rows.find(r=>r.versionId===c)!,rd=applied.rows.find(r=>r.versionId===d)!;
  expect(rc).toMatchObject({from:'LinkConflict',to:'Unlinked',wouldBecome:false,reason:'HUMAN_DECISION_EXISTS',board:'ACTION'});
  expect(rd).toMatchObject({from:'Unlinked',to:'Unlinked',reason:'HUMAN_DECISION_EXISTS',board:'ACTION'});
  expect(await stateOf(f,c)).toBe('Unlinked');expect(await stateOf(f,d)).toBe('Unlinked');
  expect((await f.db.query("SELECT event FROM result_link_event WHERE version_id=$1 ORDER BY sequence DESC LIMIT 1",[c])).rows[0]).toEqual({event:'UNLINKED'});
  expect(await count(f,'result_link_event')).toBe(events+1);                       // only the one unlink
  const after=await snapshot(f);
  for(const t of ['result_release','result_review','result_qc5_review','job_outbox','result_access_log'])expect(after[t],t).toBe(before[t]);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_report_version WHERE state='Voided'")).rows[0].n).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
