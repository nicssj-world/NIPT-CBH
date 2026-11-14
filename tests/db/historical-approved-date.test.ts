import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {ancInsights} from '../../packages/anc/insights';
import type {Staff} from '../../packages/lab/core';
import {approvedDateOf} from '../../packages/results/approved-date';
import {runHistoricalApprovedDate,main,type Deps} from '../../tools/migration/historical-approved-date-20261115';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,admin:{id:string;username:string};
const q=()=>db as unknown as Queryable;
// Wednesday 2026-11-11, 12:00 Bangkok; fiscal year 2570 began on 1 Oct 2026.
const NOW=new Date('2026-11-11T05:00:00Z');
// The text the previous system's ReadyGen PDF gives (signature block; the label is printed twice, with spaces around the dashes).
const PDF=(day:string)=>`Lab No. (LN): 26B261026142-1 HN: 1\nReported by : (A) Approved by: (B)\nApproved Date: ${day}\nApproved Date: ${day}\n`;
const texts=new Map<string,string>();
const pdfText=async(sha:string)=>{const t=texts.get(sha);if(t===undefined)throw new Error('ORIGINAL_UNREADABLE');return t;};
const v:Record<'oct'|'nov'|'none'|'conflict',{id:string;sha:string}>={} as never;

/** A previous-system result already in HIS: a linked version with an active "มีผลใน HIS แล้ว" attestation (fixture only; FKs and guards off). */
async function historical(t:Queryable,x:{caseId:string;roundId:string},importedAt:string,text:string){
 await t.query('SET LOCAL session_replication_role=replica');
 const id=randomUUID(),sha=id.replaceAll('-','').repeat(2);
 await t.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by,imported_at) VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1','{}','ValidationBlocked',$4,$5,$6,'MANUAL_REVIEWED',$7,$8)`,
  [id,randomUUID(),sha,x.caseId,x.roundId,randomUUID(),u.anc.id,importedAt]);
 await t.query(`INSERT INTO result_his_attestation(version_id,round_id,case_id,statement,his_state,effect,actor_id) VALUES($1,$2,$3,'มีผลใน HIS แล้ว','PRESENT_IN_HIS','SUPPRESSED_BEFORE_RELEASE',$4)`,[id,x.roundId,x.caseId,u.anc.id]);
 texts.set(sha,text);
 return {id,sha};
}
beforeAll(async()=>{
 db=await testDatabase();u=await labUsers(q());
 const username=`synthetic.admin.${randomUUID().slice(0,8)}`;
 const id=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash,must_change_password) VALUES($1,'ผู้ดูแลจำลอง','$argon2id$v=19$synthetic',false) RETURNING id",[username])).rows[0].id;
 await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[id]);
 admin={id,username};
 const make=(at:string)=>tx(q(),async t=>{const x=await syntheticCase(t,{staff:u.staff,unit:u.unit});await receiveS1(t,x,new Date(at),'2026-10-05');return x;});
 // All four imported on 8 Nov; their PDFs were approved on 30 Oct, 4 Nov, never, and on two different days.
 const add=async(received:string,text:string)=>{const x=await make(received);return tx(q(),t=>historical(t,x,'2026-11-08T04:00:00Z',text));};
 v.oct=await add('2026-10-26T03:00:00Z',PDF('30 - Oct - 2026'));
 v.nov=await add('2026-10-27T03:00:00Z',PDF('04 - Nov - 2026'));
 v.none=await add('2026-10-28T03:00:00Z','Reported by : (A)');
 v.conflict=await add('2026-10-29T03:00:00Z','Approved Date: 01 - Nov - 2026\nApproved Date: 02 - Nov - 2026');
});
afterAll(async()=>{await db?.close();});
const actor=()=>({id:admin.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]} as unknown as Staff);

describe('Approved Date on a previous-system PDF (Owner 2026-11-15)',()=>{
 it('reads the Approved Date with or without spaces around the dashes, and refuses two different days',()=>{
  expect(approvedDateOf(PDF('04 - Nov - 2026'))).toEqual({value:'2026-11-04',raw:'Approved Date: 04 - Nov - 2026'});
  expect(approvedDateOf('Approved Date: 4-Oct-2026')).toMatchObject({value:'2026-10-04'});
  expect(approvedDateOf('no date here')).toMatchObject({value:null,reason:'NOT_FOUND'});
  expect(approvedDateOf('Approved Date: 31 - Feb - 2026')).toMatchObject({value:null,reason:'UNREADABLE'});
  expect(approvedDateOf('Approved Date: 01 - Nov - 2026 Approved Date: 02 - Nov - 2026')).toMatchObject({value:null,reason:'CONFLICT'});
 });
 it('before the script: the statistics date the results by their import (all in November)',async()=>{
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.monthly.map(m=>[m.month,m.sent,m.released])).toEqual([['2026-10',4,0],['2026-11',0,4]]);
 });
 it('dry run reports what --apply would record and leaves nothing behind',async()=>{
  const {rows}=await runHistoricalApprovedDate(q(),actor(),pdfText,{apply:false});
  const by=Object.fromEntries(rows.map(r=>[r.versionId,r]));
  expect(by[v.oct.id]).toMatchObject({outcome:'RECORDED',approvedOn:'2026-10-30',importedDay:'2026-11-08'});
  expect(by[v.nov.id]).toMatchObject({outcome:'RECORDED',approvedOn:'2026-11-04'});
  expect(by[v.none.id]).toMatchObject({outcome:'NOT_FOUND',approvedOn:null});
  expect(by[v.conflict.id]).toMatchObject({outcome:'CONFLICT',approvedOn:null});
  expect((await db.query('SELECT 1 FROM historical_result_approved_date')).rows).toHaveLength(0);
 });
 it('--apply needs a fresh verified backup and an output folder, checked before any SQL',async()=>{
  const deps=(at:string|null):Deps=>({connect:async()=>{throw new Error('SHOULD_NOT_CONNECT');},pdfText,verifiedBackup:async()=>({at}),defaultOut:()=>'x',log:()=>{}});
  await expect(main(['--apply'],deps(new Date().toISOString()))).rejects.toThrow('OUT_DIR_REQUIRED_FOR_APPLY');
  const out=mkdtempSync(path.join(os.tmpdir(),'nipt-approved-'));
  await expect(main(['--apply','--out',path.join(out,'a')],deps(new Date(Date.now()-25*3600_000).toISOString()))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');
  await expect(main(['--apply','--out',path.join(out,'b')],deps(null))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');
 });
 it('apply records the readable dates once; the statistics then count each result in its approved month',async()=>{
  const out=mkdtempSync(path.join(os.tmpdir(),'nipt-approved-'));
  const deps:Deps={connect:async()=>({db:q(),close:async()=>{}}),pdfText,verifiedBackup:async()=>({at:new Date().toISOString()}),defaultOut:()=>out,log:()=>{}};
  const ap=await main(['--apply','--out',path.join(out,'applied'),'--actor',admin.username],deps);
  expect(ap.rows.filter(r=>r.outcome==='RECORDED')).toHaveLength(2);
  expect(readFileSync(path.join(out,'applied','historical-approved-date-apply.csv'),'utf8')).toContain('2026-10-30');
  expect((await db.query<{version_id:string;approved_on:string}>("SELECT version_id,approved_on::text FROM historical_result_approved_date ORDER BY approved_on")).rows)
   .toEqual([{version_id:v.oct.id,approved_on:'2026-10-30'},{version_id:v.nov.id,approved_on:'2026-11-04'}]);
  // A second run only looks at what still has no date.
  const again=await runHistoricalApprovedDate(q(),actor(),pdfText,{apply:true});
  expect(again.rows.map(r=>r.versionId).sort()).toEqual([v.none.id,v.conflict.id].sort());
  // October: the result approved on 30 Oct. November: approved 4 Nov, plus the two without a readable date (still their import day).
  const d=await ancInsights(q(),u.anc,{},NOW);
  expect(d.monthly.map(m=>[m.month,m.sent,m.released])).toEqual([['2026-10',4,1],['2026-11',0,3]]);
  // Received Mon 26 Oct -> approved Fri 30 Oct = 4 working days (not the 9 to the import day).
  expect(d.monthly[0].medianDays).toBe(4);
 });
 it('the recorded date is never changed or deleted, and must belong to the same PDF bytes',async()=>{
  await expect(db.query("UPDATE historical_result_approved_date SET approved_on='2026-10-01'")).rejects.toThrow('IMMUTABLE_RECORD');
  await expect(db.query('DELETE FROM historical_result_approved_date')).rejects.toThrow('IMMUTABLE_RECORD');
  await expect(db.query("INSERT INTO historical_result_approved_date(version_id,sha256,approved_on,raw,actor_id) VALUES($1,$2,'2026-11-01','x',$3)",[v.none.id,'f'.repeat(64),admin.id]))
   .rejects.toThrow('HISTORICAL_APPROVED_DATE_VERSION_MISMATCH');
 });
});
