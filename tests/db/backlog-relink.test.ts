import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {confirmImport,unlinkVersion,proposeLink,decideLink} from '../../packages/results/service';
import {runBacklogRelink,openReport,reportOf,main,BACKLOG_REASON_CODE,type RelinkRow,type Deps} from '../../tools/migration/backlog-relink-20261107';
import type {Queryable} from '../../packages/db/connection';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
const count=async(f:F,table:string)=>(await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
const TABLES=['result_link_event','result_version_event','audit_chain','result_report_version','result_gate_evaluation','result_release','result_review','result_qc5_review','job_outbox','result_access_log'];
const NEVER=['result_release','result_review','result_qc5_review','job_outbox','result_access_log'];
const snapshot=async(f:F)=>Object.fromEntries(await Promise.all(TABLES.map(async t=>[t,await count(f,t)])));
const voided=async(f:F)=>(await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_report_version WHERE state='Voided'")).rows[0].n;
const bypass=async(f:F,sql:string,p:unknown[]=[])=>{await f.db.query("SET session_replication_role=replica");try{await f.db.query(sql,p);}finally{await f.db.query("SET session_replication_role=origin");}};

async function intake(f:F,spec:Parameters<typeof syntheticReportPdf>[0],name:string){
 const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},syntheticReportPdf(spec)));
 await f.run(t=>parseIntake(t,f.store,id,{maxBytes:10000000,acceptZip:true}));
 return id;
}
const spec=(f:F,i:number,extra:Record<string,unknown>={})=>({kind:(f.cases[i].pregnancy==='Twins'?'TWIN':'SINGLETON') as 'TWIN'|'SINGLETON',labNumber:f.cases[i].printed,hn:f.cases[i].hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null,...extra});
/** What the OLD rule left behind: an imported final PDF that was never linked and no person ever touched. Calling confirmImport outside a
 *  transaction makes the system link step skip itself (TRANSACTION_REQUIRED), which is exactly an Unlinked row with no link event. */
async function stuck(f:F,i:number,name:string,extra:Record<string,unknown>={}){
 const r=await confirmImport(f.db,f.admin,{intakeIds:[await intake(f,spec(f,i,extra),name)]});
 expect(r[0].outcome).toBe('Unlinked');
 return r[0].versionId!;
}
/** A PDF linked by the new rule on import (Linked, then the gate decides). */
async function linkedOnImport(f:F,i:number,name:string){
 const id=await intake(f,spec(f,i),name),r=await f.run(t=>confirmImport(t,f.admin,{intakeIds:[id]}));
 expect(['PendingCertification','ValidationBlocked'],name+' '+r[0].outcome+' '+(r[0].autoLink??'')).toContain(r[0].outcome);
 return r[0].versionId!;
}
/** Records every statement so a dry run can be proven to issue no write. */
function spy(db:Queryable){const sql:string[]=[];return {sql,db:{query:(async(q:string,p?:unknown[])=>{sql.push(q);return db.query(q,p);}) as Queryable['query']} as Queryable};}
const CARRIES_WRITE=/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT\s+[^;]*\bFOR\s+UPDATE|SELECT\s+pg_advisory)/i;
/** Dry run and apply must agree on everything except the "would become" flag. */
const strip=(rs:RelinkRow[])=>rs.map(r=>({...r,wouldBecome:undefined}));
const untouched=async(f:F,before:Record<string,number>)=>{const after=await snapshot(f);for(const t of NEVER)expect(after[t],t).toBe(before[t]);expect(await voided(f)).toBe(0);};

it('dry run writes nothing (READ ONLY, no write statement, equal counts); apply links the DOB-differing PDF, leaves the HN-only one, and agrees with the dry run row for row',async()=>{
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
  expect(da).toMatchObject({from:'Unlinked',wouldBecome:true,reason:null,match:{hn:f.cases[0].hn,ln:f.cases[0].ln},reviewed:false,board:'READY'});
  expect(['PendingCertification','ValidationBlocked']).toContain(da.to);
  expect(db_).toMatchObject({from:'Unlinked',to:'Unlinked',match:null,board:'ACTION'});expect(db_.reason).toBeTruthy();
  expect(await stateOf(f,a)).toBe('Unlinked');

  const s2=spy(f.db),seen:RelinkRow[]=[];
  const applied=await runBacklogRelink(s2.db,f.admin,{apply:true,onRow:r=>seen.push(r)});
  expect(strip(applied.rows)).toEqual(strip(dry.rows));                               // parity: outcome, reason, match, rule, board, gate
  expect(applied.rows.every(r=>!r.wouldBecome)).toBe(true);expect(seen).toEqual(applied.rows);
  // one transaction per version, never one big one
  expect(s2.sql.filter(q=>q==='BEGIN')).toHaveLength(2);expect(s2.sql.filter(q=>q==='COMMIT')).toHaveLength(2);
  expect(await stateOf(f,a)).toBe(da.to);
  expect((await f.db.query('SELECT case_id,link_mode FROM result_report_version WHERE id=$1',[a])).rows[0]).toEqual({case_id:f.cases[0].caseId,link_mode:'AUTO_UNIQUE'});
  expect(await stateOf(f,b)).toBe('Unlinked');
  await untouched(f,before);
  const audits=(await f.db.query<{resource_id:string;details:Record<string,unknown>}>("SELECT resource_id,details FROM audit_chain WHERE action='RESULT_BACKLOG_RELINK' ORDER BY sequence")).rows;
  expect(audits.map(x=>x.resource_id).sort()).toEqual([a,b].sort());
  expect(audits.every(x=>x.details.reasonCode===BACKLOG_REASON_CODE)).toBe(true);
  expect(audits.find(x=>x.resource_id===a)!.details).toMatchObject({previousState:'Unlinked',resultingState:da.to,outcome:'RELINKED'});
  expect((await f.db.query("SELECT DISTINCT actor_id FROM audit_chain WHERE action='RESULT_BACKLOG_RELINK'")).rows).toEqual([{actor_id:f.admin.id}]);

  // The report lists every row, with HN/LN and without any patient name; cells with | or a leading = are escaped.
  const rep=openReport(out,true);for(const r of applied.rows)rep.append(r);rep.finish(applied.rows);
  const csv=readFileSync(rep.stem+'.csv','utf8'),md=readFileSync(rep.stem+'.md','utf8');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(3);
  for(const id of [a,b]){expect(csv).toContain(id);expect(md).toContain(id);}
  expect(csv+md).toContain(f.cases[0].hn);expect(csv+md).not.toMatch(/SYNTHETIC PATIENT/);expect(md).toContain('quiet period');
  expect(()=>openReport(out,true)).toThrow('REPORT_FILES_EXIST');
  const tricky={...applied.rows[0],reason:'a|b\nc',pdfHn:'=HYPERLINK("x")'};
  const t=reportOf([tricky],false);expect(t.md).toContain('a\\|b c');expect(t.csv).toContain("\"'=HYPERLINK");
 }finally{rmSync(out,{recursive:true,force:true});vi.unstubAllEnvs();await f.close();}
},600000);

it('a LinkConflict is reported and never touched; the older clean PDF of the same round gets the same SERIES_NOT_EMPTY in dry run and apply; a person-decided PDF stays',async()=>{
 const f=await task3Fixture();try{
  const older=await stuck(f,0,'SYNTHETIC-backlog-older.pdf');                       // clean, same round as the conflict below
  const conflictIntake=await intake(f,spec(f,0,{hn:'9900099999'}),'SYNTHETIC-backlog-conflict.pdf');
  const c=(await confirmImport(f.db,f.admin,{intakeIds:[conflictIntake]}))[0].versionId!;
  const c0=f.cases[0];
  await f.run(async t=>proposeLink(t,f.u.staff,{versionId:c,roundId:c0.roundId,attemptId:c0.attemptId,reason:'SYNTHETIC person links the PDF by hand',expectedRowVersion:await rowVersion(f,c)}));
  await f.run(async t=>decideLink(t,f.u.certifier,{versionId:c,decision:'APPROVE',reason:'SYNTHETIC second person approves',expectedRowVersion:await rowVersion(f,c)}));
  expect(await stateOf(f,c)).toBe('LinkConflict');
  const decidedIntake=await intake(f,spec(f,1),'SYNTHETIC-backlog-decided.pdf');
  const d=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[decidedIntake]})))[0].versionId!;
  await f.run(async t=>unlinkVersion(t,f.admin,{versionId:d,reason:'SYNTHETIC person returned the link to the manual path',expectedRowVersion:await rowVersion(f,d)}));
  const before=await snapshot(f);

  const dry=await runBacklogRelink(f.db,f.admin,{apply:false});
  expect(await snapshot(f)).toEqual(before);
  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  expect(strip(applied.rows)).toEqual(strip(dry.rows));
  for(const rows of [dry.rows,applied.rows]){
   expect(rows.find(r=>r.versionId===c)).toMatchObject({from:'LinkConflict',to:'LinkConflict',reason:'LINK_CONFLICT_NEEDS_HUMAN'});
   expect(rows.find(r=>r.versionId===older)).toMatchObject({from:'Unlinked',to:'Unlinked',reason:'SERIES_NOT_EMPTY',board:'ACTION'});
   expect(rows.find(r=>r.versionId===d)).toMatchObject({from:'Unlinked',to:'Unlinked',reason:'HUMAN_DECISION_EXISTS',match:null});
  }
  expect(await stateOf(f,c)).toBe('LinkConflict');expect(await stateOf(f,older)).toBe('Unlinked');
  const after=await snapshot(f);
  expect(after.result_link_event).toBe(before.result_link_event);                    // no unlink, no link
  await untouched(f,before);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);

it('Linked and ValidationBlocked rows are revalidated to the gate state (dry run = apply, reviewed=false, nothing reviewed or sent); a round that is no longer current is left',async()=>{
 const f=await task3Fixture();try{
  const blocked=await linkedOnImport(f,0,'SYNTHETIC-backlog-blocked.pdf');
  const legacyLinked=await linkedOnImport(f,1,'SYNTHETIC-backlog-linked.pdf');
  const stale=await linkedOnImport(f,2,'SYNTHETIC-backlog-stale.pdf');
  // Legacy states, set with triggers off as test set-up: a row that never got validated (Linked) and one whose round is no longer the case's current round.
  await bypass(f,"UPDATE result_report_version SET state='Linked' WHERE id=$1",[legacyLinked]);
  await bypass(f,'UPDATE nipt_case SET current_round_id=$2 WHERE id=$1',[f.cases[2].caseId,f.cases[0].roundId]);
  const before=await snapshot(f);
  const dry=await runBacklogRelink(f.db,f.admin,{apply:false});
  expect(await snapshot(f)).toEqual(before);
  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  expect(strip(applied.rows)).toEqual(strip(dry.rows));
  for(const id of [blocked,legacyLinked]){
   const r=applied.rows.find(x=>x.versionId===id)!;
   expect(['PendingCertification','ValidationBlocked']).toContain(r.to);expect(r.reviewed).toBe(false);expect(r.reason).toBeNull();
   expect(await stateOf(f,id)).toBe(r.to);expect(dry.rows.find(x=>x.versionId===id)!.to).toBe(r.to);
  }
  expect(applied.rows.find(x=>x.versionId===legacyLinked)!.from).toBe('Linked');
  expect(applied.rows.find(x=>x.versionId===stale)).toMatchObject({to:applied.rows.find(x=>x.versionId===stale)!.from,reason:'ROUND_NOT_CURRENT'});
  expect(await stateOf(f,stale)).toBe(applied.rows.find(x=>x.versionId===stale)!.from);
  await untouched(f,before);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);

it('dry run with a migration_record target for the lab number still issues no write under READ ONLY',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],h=(s:string)=>createHash('sha256').update(s).digest('hex'),sha=h('run-'+c.ln);
  await f.db.query("INSERT INTO file_asset(sha256,storage_key,byte_size,media_type) VALUES($1,$1,36,'application/octet-stream')",[sha]);
  const x=(await f.db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",[h('plan-'+c.ln),f.u.staff.id])).rows[0].id;
  await f.db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,7,'Run007/2026',$2)",[x,sha]);
  const src=(await f.db.query<{id:string}>("INSERT INTO migration_source(execution_id,kind,sha256,original_name,run_label) VALUES($1,'HALOS_RUN',$2,'synthetic.xlsx','Run007/2026') RETURNING id",[x,sha])).rows[0].id;
  const rec=(await f.db.query<{id:string}>("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,round_id,attempt_id,state) VALUES($1,'synthetic',2,$2,$3,'QUALIFIED_PDF_PENDING',$4,$5,$6,'IMPORTED') RETURNING id",[x,c.ln,c.printed,c.caseId,c.roundId,c.attemptId])).rows[0].id;
  await f.db.query("INSERT INTO migration_analysis(record_id,source_id,analysis_key,sheet,row_number,run_label,sample_raw,attempt_number,classification,advice_status,raw,values,is_current,attempt_id) VALUES($1,$2,'only','result',2,'Run007/2026',$3,1,'ANALYSIS','QUALIFIED','{}','{}',true,$4)",[rec,src,c.printed,c.attemptId]);
  const v=await stuck(f,0,'SYNTHETIC-backlog-migration.pdf');
  const before=await snapshot(f),s=spy(f.db);
  const dry=await runBacklogRelink(s.db,f.admin,{apply:false});
  expect(dry.rows.find(r=>r.versionId===v)).toBeTruthy();
  expect(s.sql[0]).toBe('BEGIN TRANSACTION READ ONLY');expect(s.sql.filter(q=>CARRIES_WRITE.test(q))).toEqual([]);
  expect(await snapshot(f)).toEqual(before);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);

it('CLI wrapper: no verified backup, no --out for apply, or existing report files fail before any SQL; no flags is a dry run; apply commits per version',async()=>{
 const f=await task3Fixture();const out=mkdtempSync(path.join(os.tmpdir(),'relink-cli-'));try{
  const a=await stuck(f,0,'SYNTHETIC-backlog-cli.pdf');
  const s=spy(f.db);let connects=0;const logs:string[]=[];
  const deps=(over:Partial<Deps>={}):Deps=>({connect:async()=>{connects++;return {db:s.db,close:async()=>{}};},verifiedBackup:async()=>({at:new Date().toISOString()}),defaultOut:()=>path.join(out,'default'),log:l=>logs.push(l),...over});
  const noSql=()=>{expect(connects).toBe(0);expect(s.sql).toEqual([]);};
  await expect(main(['--apply','--out',path.join(out,'x')],deps({verifiedBackup:async()=>{throw Error('no receipt');}}))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');noSql();
  await expect(main(['--apply','--out',path.join(out,'x')],deps({verifiedBackup:async()=>({at:new Date(Date.now()-48*3600000).toISOString()})}))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');noSql();
  await expect(main(['--apply'],deps())).rejects.toThrow('OUT_DIR_REQUIRED_FOR_APPLY');noSql();
await expect(main(['--apply','--out','--actor','x'],deps())).rejects.toThrow('OUT_DIR_INVALID');noSql();  await expect(main(['--out','--apply'],deps())).rejects.toThrow('OUT_DIR_INVALID');noSql();  // a connection failure leaves no empty INCOMPLETE report behind, so the same --out can be reused  const reuse=path.join(out,'reuse');  await expect(main(['--out',reuse],deps({connect:async()=>{throw Error('CONNECT_FAILED');}}))).rejects.toThrow('CONNECT_FAILED');  expect(existsSync(path.join(reuse,'backlog-relink-dry-run.csv'))).toBe(false);expect(existsSync(path.join(reuse,'backlog-relink-dry-run.md'))).toBe(false);
  expect(existsSync(path.join(out,'x'))).toBe(false);
  const taken=path.join(out,'taken');await main(['--out',taken,'--actor','synthetic.task3.admin'],deps());   // a dry run writes its report here
  s.sql.length=0;connects=0;
  await expect(main(['--out',taken,'--actor','synthetic.task3.admin'],deps())).rejects.toThrow('REPORT_FILES_EXIST');noSql();
  writeFileSync(path.join(taken,'backlog-relink-apply.csv'),'x');
  await expect(main(['--apply','--out',taken],deps())).rejects.toThrow('REPORT_FILES_EXIST');noSql();
  expect(await stateOf(f,a)).toBe('Unlinked');
  // no flags: dry run, default folder, nothing written to the database
  const before=await snapshot(f);
  const r=await main(['--actor','synthetic.task3.admin'],deps());
  expect(s.sql.some(q=>q==='BEGIN TRANSACTION READ ONLY')).toBe(true);expect(s.sql.some(q=>q==='BEGIN')).toBe(false);
  expect(existsSync(path.join(out,'default','backlog-relink-dry-run.csv'))).toBe(true);expect(r.rows).toHaveLength(1);
  expect(await snapshot(f)).toEqual(before);
  // apply with an injected fresh backup
  s.sql.length=0;
  const ra=await main(['--apply','--out',path.join(out,'applied'),'--actor','synthetic.task3.admin'],deps());
  expect(s.sql.filter(q=>q==='BEGIN')).toHaveLength(1);expect(s.sql.filter(q=>q==='COMMIT')).toHaveLength(1);
  expect(readFileSync(path.join(out,'applied','backlog-relink-apply.csv'),'utf8')).toContain(a);
  expect(ra.rows[0].to).not.toBe('Unlinked');expect(await stateOf(f,a)).toBe(ra.rows[0].to);
 }finally{rmSync(out,{recursive:true,force:true});vi.unstubAllEnvs();await f.close();}
},600000);

it('two clean Unlinked PDFs of one round: dry run and apply agree row for row (newest links, older is SERIES_NOT_EMPTY without a predicted match)',async()=>{
 const f=await task3Fixture();try{
  const older=await stuck(f,0,'SYNTHETIC-backlog-pair-1.pdf',{dob:'02-Feb-1985'});
  const newer=await stuck(f,0,'SYNTHETIC-backlog-pair-2.pdf',{dob:'03-Mar-1986'});
  const dry=await runBacklogRelink(f.db,f.admin,{apply:false});
  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  expect(strip(applied.rows)).toEqual(strip(dry.rows));
  expect(applied.rows.find(r=>r.versionId===older)).toMatchObject({to:'Unlinked',reason:'SERIES_NOT_EMPTY',match:null,rule:null,contract:null});
  expect(applied.rows.find(r=>r.versionId===newer)!.to).not.toBe('Unlinked');
  expect(await stateOf(f,older)).toBe('Unlinked');
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);

it('HALOS-generated (INTERNAL_GENERATED) versions are report-only in every state: no link, no revalidation, no audit, no event',async()=>{
 const f=await task3Fixture();try{
  const unl=await stuck(f,0,'SYNTHETIC-backlog-int-unlinked.pdf');
  const vb=await linkedOnImport(f,1,'SYNTHETIC-backlog-int-blocked.pdf');
  const lk=await linkedOnImport(f,2,'SYNTHETIC-backlog-int-linked.pdf');
  await bypass(f,"UPDATE result_report_version SET state='Linked' WHERE id=$1",[lk]);
  for(const id of [unl,vb,lk])await bypass(f,"UPDATE result_report_version SET origin='INTERNAL_GENERATED' WHERE id=$1",[id]);
  const states=await Promise.all([unl,vb,lk].map(i=>stateOf(f,i))),before=await snapshot(f);
  const dry=await runBacklogRelink(f.db,f.admin,{apply:false});
  const applied=await runBacklogRelink(f.db,f.admin,{apply:true});
  expect(strip(applied.rows)).toEqual(strip(dry.rows));
  const by=(id:string)=>applied.rows.find(r=>r.versionId===id)!;
  expect(by(unl)).toMatchObject({source:'HALOS',to:'Unlinked',reason:'INTERNAL_REPORT_LINKS_BY_FROZEN_EXPORT_ONLY',match:null});
  expect(by(vb)).toMatchObject({source:'HALOS',reason:'INTERNAL_REPORT_HANDLED_ON_BOARD'});
  expect(by(lk)).toMatchObject({source:'HALOS',from:'Linked',to:'Linked',reason:'INTERNAL_REPORT_HANDLED_ON_BOARD'});
  expect(await Promise.all([unl,vb,lk].map(i=>stateOf(f,i)))).toEqual(states);
  expect(await snapshot(f)).toEqual(before);                       // no link/version event, gate evaluation or audit row
  expect((await f.db.query("SELECT count(*)::int n FROM audit_chain WHERE action='RESULT_BACKLOG_RELINK'")).rows[0]).toEqual({n:0});
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
