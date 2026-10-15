import {it,expect} from 'vitest';
import {Client} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import * as svc from '../../packages/results/service';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import * as intake from '../../packages/lab/intake';
import {tx,labUsers,syntheticCase,receiveS1} from '../helpers/lab';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';

// Explicitly opt-in; never DATABASE_URL/Production. Real app_rw / worker_rw sessions racing on PostgreSQL (AT-CONC-01/06/10).
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P5: idempotent certification, redraw vs certify, one approval, one version per file, role boundaries',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url});await owner.connect();const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p5-native-'));const store=new FileStore(path.join(base,'files'));
 const clients:Client[]=[];const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const o=owner as unknown as Queryable,u=await labUsers(o);const limits={maxBytes:1e7,acceptZip:true};
  const prepare=async()=>{
   const hn='99000'+String(Date.now()).slice(-7),c=await tx(o,t=>syntheticCase(t,u));
   const payload={draft:{patient:{dob:'1996-03-31'},pregnancy:{type:'Singleton',edd:'2027-04-22',fetalSex:'DoNotWant'}}};
   await tx(o,async t=>{await t.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[c.caseId,hn]);
    await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash('sha256').update(JSON.stringify(payload)+randomUUID()).digest('hex'),u.staff.id]);
    await receiveS1(t,c,new Date(Date.now()-3600000),'2026-10-10');});
   const attemptId=(await owner.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0].id;
   const bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:'26B'+randomUUID().slice(0,9),hn,collection:'10-Oct-2026'});
   return {...c,hn,attemptId,bytes};
  };
  const rv=async(id:string)=>(await owner.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
  const [w1,w2,a1,a2]=[await session('worker_rw'),await session('worker_rw'),await session('app_rw'),await session('app_rw')];

  // 1. The same file previewed twice by two worker sessions and confirmed twice concurrently: exactly one report version.
  const c=await prepare();
  const ids=await Promise.all([w1,w2].map(w=>tx(w,async t=>{const id=await registerIntake(t,store,{source:'UPLOAD',relativePath:null,originalName:`native-${c.hn}.pdf`,actorId:u.staff.id,jobId:null},c.bytes);await parseIntake(t,store,id,limits);return id;})));
  const confirmed=await Promise.allSettled(ids.map((id,i)=>tx([a1,a2][i],t=>svc.confirmImport(t,u.staff,{intakeIds:[id]}))));
  const versions=(await owner.query<{id:string}>('SELECT v.id FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id WHERE i.id=ANY($1)',[ids])).rows;
  expect(versions).toHaveLength(1);expect(confirmed.some(r=>r.status==='fulfilled')).toBe(true);
  const versionId=versions[0].id;

  // 2. Proposal by staff; two certifiers approve at the same moment: one APPROVED event, the other loses cleanly.
  const certifier2=(await labUsers(o)).certifier;
  const proposedAt=await rv(versionId);
  await tx(a1,t=>svc.proposeLink(t,u.staff,{versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง native เสนอการเชื่อมโยง',expectedRowVersion:proposedAt}));
  const version=await rv(versionId);
  const approvals=await Promise.allSettled([[a1,u.certifier],[a2,certifier2]].map(([s,user])=>tx(s as Queryable,t=>svc.decideLink(t,user as typeof u.certifier,{versionId,decision:'APPROVE',reason:'จำลอง native ยืนยัน',expectedRowVersion:version}))));
  expect(approvals.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await owner.query("SELECT count(*)::int n FROM result_link_event WHERE version_id=$1 AND event='APPROVED'",[versionId])).rows[0]).toEqual({n:1});
  await tx(a1,async t=>svc.recordReview(t,u.staff,{versionId,valuesMatchPdf:true,abnormalAcknowledged:false,expectedRowVersion:await rv(versionId)}));

  // 3. AT-CONC-06: the same certify click twice (same idempotency key) from two sessions → one evaluation, no release.
  const key=randomUUID().replaceAll('-','');const now=await rv(versionId);
  const twice=await Promise.all([a1,a2].map(s=>tx(s,t=>svc.certifyAttempt(t,u.certifier,{versionId,idempotencyKey:key,abnormalAcknowledged:false,expectedRowVersion:now}))));
  expect(twice.map(x=>x.outcome)).toEqual(['BLOCKED','BLOCKED']);expect(twice.filter(x=>x.replayed)).toHaveLength(1);
  expect((await owner.query('SELECT count(*)::int n FROM result_gate_evaluation WHERE idempotency_key=$1',[key])).rows[0]).toEqual({n:1});

  // 4. AT-CONC-10: Redraw and certification race on the same round; both serialize on the round lock and nothing is released.
  const race=await Promise.allSettled([tx(a1,t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง native สั่งเจาะซ้ำ'})),
   tx(a2,async t=>svc.certifyAttempt(t,u.certifier,{versionId,idempotencyKey:randomUUID().replaceAll('-',''),abnormalAcknowledged:false,expectedRowVersion:await rv(versionId)}))]);
  expect(race[0].status).toBe('fulfilled');
  const after=await tx(a1,async t=>svc.certifyAttempt(t,u.certifier,{versionId,idempotencyKey:randomUUID().replaceAll('-',''),abnormalAcknowledged:false,expectedRowVersion:await rv(versionId)}));
  expect(after.failed!.some(x=>x.startsWith('RG-05:'))).toBe(true);
  expect((await owner.query('SELECT count(*)::int n FROM result_release')).rows[0]).toEqual({n:0});

  // 5. Role boundaries: the web role cannot bypass the Synthetic AL5 release trigger; the worker role cannot create versions or links.
  await expect(a1.query("INSERT INTO result_release(version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW',$4)",[versionId,c.caseId,c.roundId,u.certifier.id])).rejects.toThrow('RELEASE_HOLD_AL5');
  await expect(w1.query("INSERT INTO result_link_event(version_id,event,round_id,case_id,reason,actor_id) VALUES($1,'PROPOSED',$2,$3,'จำลอง worker เสนอ',$4)",[versionId,c.roundId,c.caseId,u.staff.id])).rejects.toThrow(/permission denied/);
  await expect(w1.query("UPDATE result_report_version SET state='Voided' WHERE id=$1",[versionId])).rejects.toThrow(/permission denied/);
 }finally{for(const c of clients)await c.end();await owner.end();await rm(base,{recursive:true,force:true});}
},120000);
