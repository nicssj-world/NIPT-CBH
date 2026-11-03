import {afterAll,beforeAll,expect,it} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../../tools/migrate';

const url=process.env.NIPT_ARCHIVE_TEST_DATABASE_URL;
let c:Client,actor:string,caseId:string,roundId:string,releaseId:string,versionId:string;
const open=async()=>{const x=new Client({connectionString:url});await x.connect();return x;};
const sha=()=>createHash('sha256').update(randomUUID()).digest('hex');
const as=async(role:string,sql:string,args:unknown[]=[])=>{
 const x=await open();
 try{await x.query('BEGIN');await x.query(`SET LOCAL ROLE ${role}`);await x.query(sql,args);await x.query('ROLLBACK');return 'OK';}
 catch(e){await x.query('ROLLBACK').catch(()=>{});return String((e as Error).message);}finally{await x.end();}
};
beforeAll(async()=>{
 if(!url)return;
 assertSyntheticDatabase(url);
 c=await open();await migrate(c);await c.query(await readFile('packages/db/roles.sql','utf8'));
 actor=(await c.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.eqa113','Synthetic','$argon2id$v=19$synthetic') RETURNING id")).rows[0].id;
 caseId=randomUUID();roundId=randomUUID();releaseId=randomUUID();versionId=randomUUID();
 await c.query('BEGIN');
 await c.query('SET LOCAL session_replication_role=replica');
 const ln=randomUUID();
 await c.query("INSERT INTO nipt_case(id,registration_origin,identity_key,current_round_id) VALUES($1,'LAB_DIRECT',$2,$3)",[caseId,sha(),roundId]);
 await c.query("INSERT INTO case_ln(id,case_id,ln) VALUES($1,$2,'0099113001')",[ln,caseId]);
 await c.query("INSERT INTO specimen_round(id,case_id,case_ln_id,round_number,state) VALUES($1,$2,$3,1,'Expected')",[roundId,caseId,ln]);
 await c.query('COMMIT');
 await c.query('SET session_replication_role=origin');
});
afterAll(async()=>{await c?.end();});

it.skipIf(!url)('restricted roles: web may register, nobody may edit; Worker cannot classify; guards fire under both roles',async()=>{
 const insert=`INSERT INTO eqa_case(case_id,round_id,organizer,program_year,sample_ref,surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,note,registered_by)
  VALUES($1,$2,'ORG',2026,'S-1','POLSON','Tonya','1988-08-23',11,1,'2026-10-19','Singleton',NULL,$3)`;
 expect(await as('worker_rw',insert,[caseId,roundId,actor])).toMatch(/permission denied/i);
 await c.query(insert,[caseId,roundId,actor]);
 expect(await as('app_rw','UPDATE eqa_case SET organizer=\'X\'')).toMatch(/permission denied/i);
 expect(await as('app_rw','DELETE FROM eqa_case')).toMatch(/permission denied/i);
 expect(await as('worker_rw','UPDATE eqa_case SET organizer=\'X\'')).toMatch(/permission denied/i);
});

it.skipIf(!url)('worker_rw and app_rw cannot enqueue or reserve a HIS outbound for an EQA release',async()=>{
 await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');
 await c.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/pdf',$1)",[versionId.replaceAll('-','').padEnd(64,'0')]);
 await c.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','f','f','{}',$4,$5,$6)",[versionId,randomUUID(),versionId.replaceAll('-','').padEnd(64,'0'),caseId,roundId,actor]);
 await c.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5)",[releaseId,versionId,caseId,roundId,actor]);
 await c.query('COMMIT');await c.query('SET session_replication_role=origin');
 const out="INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2)";
 for(const role of ['worker_rw','app_rw']){
  expect(await as(role,out,[JSON.stringify({releaseId}),randomUUID()])).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await as(role,out,[JSON.stringify({versionId}),randomUUID()])).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await as(role,out,[JSON.stringify({releaseId:randomUUID()}),randomUUID()])).toBe('OK');
 }
 const transfer=`INSERT INTO p6_transfer(authority,clinical_release_id,ln,ln_generation,report_version_id,sequence,res_destination,pdf_destination,res_name,pdf_name,plan,model,gate)
  VALUES('CERTIFIED_RESULT',$1,'1',1,'V',1,'r','p','a.res','a.pdf','{}','{"hisConfirmed":"false"}','{}')`;
 expect(await as('worker_rw',transfer,[releaseId])).toMatch(/EQA_NO_HIS_TRANSFER|permission denied/i);
 expect((await c.query<{ok:boolean}>('SELECT p6_release_eligible($1,0) ok',[releaseId])).rows[0].ok).toBe(false);
 expect(await as('worker_rw','SELECT p6_release_eligible($1,0)',[releaseId])).toBe('OK');
});

it.skipIf(!url)('a HIS receipt (his_order) for the EQA case is refused at the database',async()=>{
 const file=(await c.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES($1,'Applied(S1)') RETURNING id",[sha()])).rows[0].id;
 const lnId=(await c.query<{id:string}>('SELECT id FROM case_ln WHERE case_id=$1',[caseId])).rows[0].id;
 const x=await open();
 try{await expect(x.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at) VALUES($1,$2,now())',[lnId,file])).rejects.toThrow(/EQA_CASE_REJECTS_HIS_RECEIPT/);}finally{await x.end();}
});

it.skipIf(!url)('app_rw issues an EQA-block LN Halos and deletes an unused EQA through the SECURITY DEFINER functions; the patient range stays closed',async()=>{
 const id=randomUUID(),round=randomUUID(),ln=randomUUID();
 await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');
 await c.query("INSERT INTO nipt_case(id,registration_origin,identity_key,current_round_id) VALUES($1,'LAB_DIRECT',$2,$3)",[id,sha(),round]);
 await c.query("INSERT INTO case_ln(id,case_id,ln) VALUES($1,$2,'0099113002')",[ln,id]);
 await c.query("INSERT INTO specimen_round(id,case_id,case_ln_id,round_number,state) VALUES($1,$2,$3,1,'Expected')",[round,id,ln]);
 await c.query('COMMIT');await c.query('SET session_replication_role=origin');
 await c.query(`INSERT INTO eqa_case(case_id,round_id,organizer,program_year,sample_ref,surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,note,registered_by)
  VALUES($1,$2,'ORG',2026,'S-2','ESPOSITO','Alessia','1985-02-21',11,1,'2026-10-19','Twins',NULL,$3)`,[id,round,actor]);
 const x=await open();
 try{
  await x.query('BEGIN');await x.query('SET LOCAL ROLE app_rw');
  const code=(await x.query<{code:string}>('SELECT eqa_issue_ln_halos($1,NULL) code',[round])).rows[0].code;
  expect(Number(code.slice(-3))).toBeGreaterThanOrEqual(900);
  expect((await x.query('SELECT 1 FROM specimen_lab_number WHERE ln_halos=$1',[code])).rows).toHaveLength(1);
  await expect(x.query('SAVEPOINT s').then(()=>x.query('SELECT eqa_delete_registration($1,$2,$3)',[id,actor,'ลงทะเบียนผิด']))).rejects.toThrow(/FORBIDDEN/);   // no role, no delete
  await x.query('ROLLBACK TO s');
  await c.query("INSERT INTO role_assignment(user_id,role,effective_from) VALUES($1,'LAB_STAFF',now()-interval '1 hour') ON CONFLICT DO NOTHING",[actor]);
  const r=(await x.query<{r:{lnHalos:string;numberReusable:boolean}}>('SELECT eqa_delete_registration($1,$2,$3) r',[id,actor,'ลงทะเบียนผิด'])).rows[0].r;
  expect(r).toEqual({lnHalos:code,numberReusable:true});
  expect((await x.query('SELECT 1 FROM nipt_case WHERE id=$1',[id])).rows).toHaveLength(0);
  expect((await x.query('SELECT 1 FROM eqa_registration_deleted WHERE case_id=$1',[id])).rows).toHaveLength(1);
  await x.query('ROLLBACK');
 }finally{await x.query('ROLLBACK').catch(()=>{});await x.end();}
 // worker_rw has no business deleting or issuing.
 expect(await as('worker_rw','SELECT eqa_delete_registration($1,$2,$3)',[id,actor,'x'])).toMatch(/permission denied/i);
});
