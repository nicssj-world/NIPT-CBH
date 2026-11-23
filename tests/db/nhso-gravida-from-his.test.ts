import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {sendToHis} from '../../packages/results/send-his';
import {emptyRequest} from '../../packages/p2/schema';
import {identityLookup} from '../../packages/security/envelope';
import {nhsoDetail,confirmNhsoEntry} from '../../packages/results/nhso-entry';
import {runNhsoGravida,main,type Deps} from '../../tools/migration/nhso-gravida-from-his-20261123';
import {hisAncWorkbook,hisAncRow} from '../helpers/his-anc-workbook';

// Owner 2026-11-23: 42 released paper cases on ลงผลสปสช. had no ครรภ์ที่ although the HIS ANC export had it; the import skips checked cases.
type F=Awaited<ReturnType<typeof task3Fixture>>;
const CID=['1101700203451','1101700203462','1101700203473','1101700203484'];
const fixture=()=>task3Fixture([
 {ln:'9900099611',hn:'9900099961',pregnancy:'Singleton',sheet:1},
 {ln:'9900099612',hn:'9900099962',pregnancy:'Singleton',sheet:2},
 {ln:'9900099613',hn:'9900099963',pregnancy:'Singleton',sheet:3},
 {ln:'9900099614',hn:'9900099964',pregnancy:'Singleton',sheet:1}]);
/** The request draft as a saved check leaves it; gravida null = the check was saved without ครรภ์ที่. */
async function request(f:F,i:number,gravida:number|null){
 const c=f.cases[i],draft={...emptyRequest,pregnancy:{...emptyRequest.pregnancy,gravida}};
 await f.db.query(`INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Paper','Paper',$4)
  ON CONFLICT(round_id) DO UPDATE SET draft=EXCLUDED.draft,version=p2_workspace.version+1`,[c.roundId,c.caseId,JSON.stringify(draft),f.admin.id]);
}
/** The stored PET carries the CID as its identity key (as the real PET intake stores it). Fixture only: guards off. */
async function petIdentity(f:F,i:number){
 await f.run(async t=>{await t.query('SET LOCAL session_replication_role=replica');
  await t.query("UPDATE his_inbound_file SET parsed=parsed||jsonb_build_object('identityKey',$1::text) WHERE ln=$2",[identityLookup(CID[i],f.lookupKey),f.cases[i].ln]);});
}
async function release(f:F,i:number){
 const c=f.cases[i],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`SYNTHETIC-gravida-${i}.pdf`,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const versionId=(await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}))).items[0].versionId!;
 const rv=(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0].row_version;
 await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId,expectedRowVersion:rv}]}));
 return (await f.db.query<{id:string}>('SELECT id FROM result_release WHERE version_id=$1',[versionId])).rows[0].id;
}
const gravidaOf=async(f:F,releaseId:string)=>(await f.run(t=>nhsoDetail(t,f.store,f.admin,releaseId))).patient.gravida;

it('fills ครรภ์ที่ from the HIS export only for waiting cases that have none; dry run leaves nothing; a second run finds nothing to do',async()=>{
 const f=await fixture();try{
  for(const i of [0,1,2,3])await petIdentity(f,i);
  await request(f,0,null);await request(f,1,null);await request(f,2,4);await request(f,3,null);
  const [a,b,c,d]=[await release(f,0),await release(f,1),await release(f,2),await release(f,3)];
  await f.run(t=>confirmNhsoEntry(t,f.admin,{resultId:d}));   // already entered on ลงผลสปสช.: not touched
  const hn=(i:number)=>'0'+f.cases[i].hn;   // HIS writes the HN with a leading zero; matching ignores it, as the import does
  const file=hisAncWorkbook([
   hisAncRow({cid:CID[0],hn:hn(0),gravida:'3'}),hisAncRow({cid:CID[0],hn:hn(0),gravida:'3',date_serv:'01/11/2026'}),   // same value twice: fine
   hisAncRow({cid:CID[1],hn:hn(1),gravida:'2'}),hisAncRow({cid:CID[1],hn:hn(1),gravida:'5',date_serv:'01/11/2026'}),   // disagree: left empty
   hisAncRow({cid:CID[2],hn:hn(2),gravida:'1'}),   // the request already has 4: never overwritten
   hisAncRow({cid:CID[3],hn:hn(3),gravida:'2'}),
   hisAncRow({cid:CID[0],hn:'9900099999',gravida:'7'})]);   // right CID, other HN: not this patient
  const by=(rows:{caseId:string;outcome:string;gravida:number|null}[])=>Object.fromEntries(rows.map(r=>[r.caseId,[r.outcome,r.gravida]]));

  const dry=await runNhsoGravida(f.db,f.admin,file,f.lookupKey,{apply:false});
  expect(by(dry.rows)).toEqual({[f.cases[0].caseId]:['FILLED',3],[f.cases[1].caseId]:['CONFLICT',null]});
  expect(await gravidaOf(f,a)).toBeNull();   // rolled back

  const done=await runNhsoGravida(f.db,f.admin,file,f.lookupKey,{apply:true});
  expect(by(done.rows)).toEqual(by(dry.rows));
  expect(await gravidaOf(f,a)).toBe(3);expect(await gravidaOf(f,b)).toBeNull();expect(await gravidaOf(f,c)).toBe(4);
  const draftD=(await f.db.query<{g:unknown}>("SELECT draft#>'{pregnancy,gravida}' g FROM p2_workspace WHERE round_id=$1",[f.cases[3].roundId])).rows[0].g;
  expect(draftD).toBeNull();
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='NHSO_GRAVIDA_FROM_HIS'")).rows[0].n).toBe(1);
  // no check record or released result was written by the script
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM p2_paper_review")).rows[0].n).toBe(0);

  expect(by((await runNhsoGravida(f.db,f.admin,file,f.lookupKey,{apply:true})).rows)).toEqual({[f.cases[1].caseId]:['CONFLICT',null]});
 }finally{await f.close();}
},600000);

it('CLI: a file is required; --apply needs a report folder and a verified backup before any SQL; the report has LN, never HN or CID',async()=>{
 const f=await fixture();try{
  await petIdentity(f,0);await request(f,0,null);await release(f,0);
  const file=hisAncWorkbook([hisAncRow({cid:CID[0],hn:f.cases[0].hn,gravida:'2'})]);
  let connected=0;const logs:string[]=[];
  const deps=(backupAt:string|null):Deps=>({connect:async()=>{connected++;return {db:f.db,close:async()=>{}};},readFile:()=>file,lookupKey:()=>f.lookupKey,
   verifiedBackup:async()=>({at:backupAt}),defaultOut:()=>mkdtempSync(path.join(os.tmpdir(),'nhso-gravida-')),log:l=>{logs.push(l);}});
  await expect(main([],deps(null))).rejects.toThrow('FILE_REQUIRED');
  await expect(main(['--file','x.xlsx','--apply'],deps(null))).rejects.toThrow('OUT_DIR_REQUIRED_FOR_APPLY');
  const out=mkdtempSync(path.join(os.tmpdir(),'nhso-gravida-apply-'));
  await expect(main(['--file','x.xlsx','--apply','--out',out],deps(null))).rejects.toThrow('VERIFIED_BACKUP_REQUIRED');
  expect(connected).toBe(0);
  await f.db.query("UPDATE app_user SET username='admin' WHERE id=$1",[f.admin.id]);
  const dry=await main(['--file','x.xlsx'],deps(null));
  expect(dry.rows).toEqual([{caseId:f.cases[0].caseId,ln:f.cases[0].ln,gravida:2,outcome:'FILLED'}]);
  const csv=readFileSync(dry.report+'.csv','utf8');expect(csv).toContain(f.cases[0].ln);expect(csv).not.toContain(f.cases[0].hn);expect(csv).not.toContain(CID[0]);
  const applied=await main(['--file','x.xlsx','--apply','--out',out],deps(new Date().toISOString()));
  expect(applied.rows[0].outcome).toBe('FILLED');expect(readFileSync(applied.report+'.md','utf8')).toContain('APPLIED');
 }finally{await f.close();}
},600000);
