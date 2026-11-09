import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {confirmImport,ancCaseResults} from '../../packages/results/service';
import {releaseQueue} from '../../packages/results/release-queue';
import {runBacklogHisPresent,main,reportOf,type Deps} from '../../tools/migration/backlog-his-present-20261109';

// Owner 2026-11-09: the one-time script that links the stuck PDFs the previous system already sent to HIS and marks them "มีผลใน HIS แล้ว".
type F=Awaited<ReturnType<typeof task3Fixture>>;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
async function importPdf(f:F,index:number,name:string,hn?:string){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:hn??c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 return {c,intakeId};
}
async function pending(f:F,index:number){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-bhp-pending-${index}.pdf`);
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 expect(done.items[0].outcome).toBe('PendingCertification');
 return {c,id:done.items[0].versionId!};
}
/** What the OLD rule left behind: an imported final PDF that was never linked and that no person touched. confirmImport outside a transaction makes the system link
 *  step skip itself, which is exactly an Unlinked row with no link event (a person's unlink would count as a human decision and the script would leave it). */
async function unlinked(f:F,index:number,hn?:string){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-bhp-unlinked-${index}.pdf`,hn);
 const r=await confirmImport(f.db,f.admin,{intakeIds:[intakeId]});
 expect(r[0].outcome).toBe('Unlinked');
 return {c,id:r[0].versionId!};
}
const snapshot=async(f:F,ids:string[])=>({states:await Promise.all(ids.map(i=>stateOf(f,i))),
 attestations:(await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_his_attestation')).rows[0].n,
 audit:(await f.db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n,
 events:(await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_link_event')).rows[0].n});
const shown=async(f:F,caseId:string)=>(await f.run(t=>ancCaseResults(t,f.admin,caseId))).rounds.map(r=>r.result).filter(Boolean);

it('dry run and apply decide the same; the clean PDF is linked and shown, an unclean one is left for a person, a result waiting to be sent is never touched',async()=>{
 const f=await task3Fixture();try{
  const clean=await unlinked(f,0),unclean=await unlinked(f,1,f.cases[2].hn),waiting=await pending(f,2);
  const ids=[clean.id,unclean.id,waiting.id],before=await snapshot(f,ids);

  const dry=await runBacklogHisPresent(f.db,f.admin,{apply:false});
  const byId=(rows:typeof dry.rows,id:string)=>rows.find(r=>r.versionId===id);
  expect(byId(dry.rows,clean.id)).toMatchObject({from:'Unlinked',outcome:'LINKED_AND_SHOWN'});
  expect(byId(dry.rows,unclean.id)).toMatchObject({from:'Unlinked',outcome:'NOT_CHANGED'});expect(byId(dry.rows,unclean.id)!.reason).toBeTruthy();
  expect(byId(dry.rows,waiting.id)).toBeUndefined();                                    // "รอส่ง HIS" is not in scope
  expect(await snapshot(f,ids)).toEqual(before);                                        // a dry run leaves nothing behind (states, attestations, audit, link events)
  expect(await shown(f,clean.c.caseId)).toEqual([]);

  const apply=await runBacklogHisPresent(f.db,f.admin,{apply:true});
  expect(apply.rows.map(r=>[r.versionId,r.outcome,r.reason])).toEqual(dry.rows.map(r=>[r.versionId,r.outcome,r.reason]));   // same decisions, row for row
  const s=await shown(f,clean.c.caseId);expect(s).toHaveLength(1);expect(s[0]).toMatchObject({state:'HistoricalReported',historical:true});
  expect(await stateOf(f,clean.id)).not.toBe('Unlinked');
  expect(await stateOf(f,unclean.id)).toBe('Unlinked');
  expect(await stateOf(f,waiting.id)).toBe('PendingCertification');
  expect((await f.run(t=>releaseQueue(t,f.admin,{store:f.store},{tab:'READY'}))).rows.map(r=>r.versionId)).toEqual([waiting.id]);   // still waiting to be sent
  expect((await f.db.query("SELECT 1 FROM result_release")).rows).toHaveLength(0);
  expect((await f.db.query("SELECT 1 FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM p6_transfer')).rows).toHaveLength(0);
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='RESULT_BACKLOG_HIS_PRESENT'")).rows.length).toBe(apply.rows.length);

  // a second run finds only what is still stuck: nothing is changed twice
  const again=await runBacklogHisPresent(f.db,f.admin,{apply:true});
  expect(again.rows.map(r=>r.versionId)).toEqual([unclean.id]);expect(again.rows[0].outcome).toBe('NOT_CHANGED');
  const rep=reportOf(apply.rows,true);expect(rep.csv).toContain(clean.id);expect(rep.md).toContain('APPLIED');
 }finally{await f.close();}
},600000);

it('CLI wrapper: apply needs a fresh verified backup and --out before any SQL; a dry run writes a report and changes nothing; apply writes its own report',async()=>{
 const f=await task3Fixture();const out=mkdtempSync(path.join(os.tmpdir(),'bhp-cli-'));try{
  const clean=await unlinked(f,0);
  let connects=0;const logs:string[]=[];
  const deps=(over:Partial<Deps>={}):Deps=>({connect:async()=>{connects++;return {db:f.db,close:async()=>{}};},verifiedBackup:async()=>({at:new Date().toISOString()}),defaultOut:()=>path.join(out,'default'),log:l=>logs.push(l),...over});
  await expect(main(['--apply','--out',path.join(out,'x')],deps({verifiedBackup:async()=>{throw Error('no receipt');}}))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');
  await expect(main(['--apply','--out',path.join(out,'x')],deps({verifiedBackup:async()=>({at:new Date(Date.now()-48*3600000).toISOString()})}))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');
  await expect(main(['--apply'],deps())).rejects.toThrow('OUT_DIR_REQUIRED_FOR_APPLY');
  expect(connects).toBe(0);expect(existsSync(path.join(out,'x'))).toBe(false);
  // no flags = dry run
  const before=await snapshot(f,[clean.id]);
  const dry=await main(['--out',path.join(out,'dry'),'--actor','synthetic.task3.admin'],deps());
  expect(dry.rows).toHaveLength(1);expect(readFileSync(path.join(out,'dry','backlog-his-present-dry-run.csv'),'utf8')).toContain(clean.id);
  expect(await snapshot(f,[clean.id])).toEqual(before);
  await expect(main(['--out',path.join(out,'dry'),'--actor','synthetic.task3.admin'],deps())).rejects.toThrow('REPORT_FILES_EXIST');
  // apply
  const ap=await main(['--apply','--out',path.join(out,'applied'),'--actor','synthetic.task3.admin'],deps());
  expect(ap.rows[0].outcome).toBe('LINKED_AND_SHOWN');expect(readFileSync(path.join(out,'applied','backlog-his-present-apply.csv'),'utf8')).toContain(clean.id);
  expect(await shown(f,clean.c.caseId)).toHaveLength(1);
  await expect(main(['--out',path.join(out,'z'),'--actor','nobody.here'],deps())).rejects.toThrow('APP_ADMIN_ACTOR_NOT_AVAILABLE');
  expect(existsSync(path.join(out,'z','backlog-his-present-dry-run.csv'))).toBe(false);          // a failed run leaves no empty report behind
 }finally{rmSync(out,{recursive:true,force:true});await f.close();}
},600000);
