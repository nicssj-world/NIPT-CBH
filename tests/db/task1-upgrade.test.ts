import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {migrate} from '../../tools/migrate';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import {createBatch} from '../../packages/lab/batch';
import {FileStore} from '../../packages/storage';

it('Task1 migration preserves pre123 legacy R, frozen synthetic evidence and Pool status across a disk database reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nipt-task1-upgrade-')),bundle=join(root,'pre123'),disk=join(root,'database');
 const {mkdir}=await import('node:fs/promises');await mkdir(bundle);
 let db:PGlite|null=new PGlite(disk);
 try{
  for(const file of await readdir('db/migrations'))if(file.endsWith('.sql')&&Number(file.slice(0,3))<123)await copyFile(join('db/migrations',file),join(bundle,file));
  await migrate(db,bundle);const u=await labUsers(db),c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c,new Date('2026-10-20T01:00:00Z')));
  const first=(await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0];
  const base=(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[c.roundId])).rows[0].ln_halos;
  // Seed the former genuine PET-backed S2 receipt contract through its original SQL guards.
  const request=(await db.query<{id:string}>("INSERT INTO redraw_request(case_id,source_round_id,reason_code,note,requested_by,prior_round_state) VALUES($1,$2,'OTHER','SYNTHETIC pre123 redraw',$3,'ReceivedInHIS') RETURNING id",[c.caseId,c.roundId,u.staff.id])).rows[0].id;
  await db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[first.id]);await db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[c.roundId]);
  const round=(await db.query<{id:string}>('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[c.caseId,c.lnId,request])).rows[0].id;await db.query('UPDATE nipt_case SET current_round_id=$2 WHERE id=$1',[c.caseId,round]);
  const file=(await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES($1,'Applied(Redraw)') RETURNING id",[createHash('sha256').update('SYNTHETIC-PRE123-PET').digest('hex')])).rows[0].id;
  await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,round_id,his_received_at) VALUES($1,$2,$3,$4)',[c.lnId,file,round,new Date('2026-10-21T01:00:00Z')]);
  await db.query("UPDATE specimen_round SET state='ReceivedInHIS',received_source='HIS_PET_RECEIPT',received_at=$2,collection_date='2026-10-21' WHERE id=$1",[round,new Date('2026-10-21T01:00:00Z')]);
  const second=(await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[round])).rows[0];await db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[second.id,base+'R']);
  const batch=await tx(db,t=>createBatch(t,u.staff));await db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,2,$2,$3)',[batch.batchId,second.id,u.staff.id]);await db.query("UPDATE analytical_attempt SET state='Assigned' WHERE id=$1",[second.id]);
  const hash=createHash('sha256').update('SYNTHETIC frozen provenance only').digest('hex');
  // Minimal synthetic ledger row: this upgrade test does not assert clinical Pool readiness.
  const pool=(await db.query<{id:string}>("INSERT INTO p4b_pool_attempt(batch_id,attempt_number,reason,payload,sha256,source_sha256,seed,selected_slots,created_by) VALUES($1,1,'SYNTHETIC upgrade ledger','{\"synthetic\":true}',$2,$2,'SYNTHETIC',ARRAY[2],$3) RETURNING id",[batch.batchId,hash,u.staff.id])).rows[0].id;
  const store=new FileStore(join(root,'files')),bytes=Buffer.from('%PDF-1.4\n% SYNTHETIC immutable byte fixture only'),fileHash=await store.put(bytes);
  await db.query("INSERT INTO p4b_document(pool_id,kind,snapshot,file_sha256,issued_by) VALUES($1,'PRE_WORK','{\"form\":\"F4\",\"synthetic\":true,\"clinicalUsable\":false,\"preview\":false}',$2,$3)",[pool,fileHash,u.staff.id]);
  const tables=['specimen_round','specimen_lab_number','his_order','lab_slot_assignment','p4b_pool_attempt','p4b_pool_event','p4b_document','audit_chain'];
  const before=await Promise.all(tables.map(t=>db!.query('SELECT * FROM '+t+' ORDER BY 1'))),attemptsBefore=(await db.query('SELECT * FROM analytical_attempt ORDER BY id')).rows,ledger=(await db.query('SELECT * FROM schema_migration ORDER BY name')).rows;
  await migrate(db);
  for(let i=0;i<tables.length;i++)expect((await db.query('SELECT * FROM '+tables[i]+' ORDER BY 1')).rows).toEqual(before[i].rows);
  const attempts=(await db.query<Record<string,unknown>>('SELECT * FROM analytical_attempt ORDER BY id')).rows;expect(attempts.map(({overall_ordinal,historical_source_id,...row})=>{void overall_ordinal;expect(historical_source_id).toBeNull();return row;})).toEqual(attemptsBefore);expect(attempts.find(a=>a.id===second.id)).toMatchObject({printed_sample_id:base+'R',overall_ordinal:2});
  expect((await db.query("SELECT * FROM p4b_pool_event WHERE event_type='STOP_USE'")).rows).toHaveLength(0);expect(await store.get(fileHash)).toEqual(bytes);
  expect((await db.query('SELECT * FROM schema_migration WHERE name<$1 ORDER BY name',['123'])).rows).toEqual(ledger);
  await db.close();db=new PGlite(disk);await migrate(db);
  expect((await db.query('SELECT printed_sample_id,overall_ordinal FROM analytical_attempt WHERE id=$1',[second.id])).rows[0]).toEqual({printed_sample_id:base+'R',overall_ordinal:2});
  for(let i=0;i<tables.length;i++)expect((await db.query('SELECT * FROM '+tables[i]+' ORDER BY 1')).rows).toEqual(before[i].rows);expect(await store.get(fileHash)).toEqual(bytes);
  await expect(db.query('UPDATE analytical_attempt SET overall_ordinal=99 WHERE id=$1',[second.id])).rejects.toThrow('ATTEMPT_ORDINAL_IMMUTABLE');
 }finally{await db?.close();await rm(root,{recursive:true,force:true});}
},180000);
