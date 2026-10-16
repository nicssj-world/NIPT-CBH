import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {testDatabase,addUser} from '../helpers/database';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {verifyAuditChain} from '../../packages/db/audit';
import type {Principal} from '../../packages/security/policy';
import type {Queryable} from '../../packages/db/connection';
import {cancelObsoleteInboundScans,cancelObsoleteInboundScansAtStartup,withInboundConfigurationLease} from '../../packages/jobs/obsolete-scans';

let db:PGlite,maker:Principal,checker:Principal;
beforeAll(async()=>{db=await testDatabase();maker=await addUser(db);checker=await addUser(db,'CLINICAL_APPROVER','obsolete.scan.checker');});
afterAll(async()=>{await db?.close();});
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const value=await fn();await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}}
async function approvedRevision(){return tx(async()=>{const id=await proposeSetting(db,maker,'his_inbound',SETTINGS.his_inbound.default,'OBSOLETE_SCAN_TEST');await validateSetting(db,maker,id,async()=>true);await approveSetting(db,checker,id);return id;});}
async function job(payload:unknown,state='Pending',kind='synthetic_scan',receipt?:unknown){const id=randomUUID();await db.query('INSERT INTO job_outbox(id,kind,payload,idempotency_key,state,cancel_epoch) VALUES($1,$2,$3,$5,$4,2)',[id,kind,JSON.stringify(payload),state,id]);if(receipt)await db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[id,JSON.stringify(receipt)]);return id;}
async function rows(){return (await db.query<{id:string;state:string;cancel_epoch:number}>('SELECT id,state,cancel_epoch FROM job_outbox')).rows;}

it('real inbound activation cancels only obsolete unreceipted pending/dispatched scans, retaining failures and reconciliation evidence',async()=>{
 const first=await approvedRevision();await tx(()=>activateSetting(db,checker,first));const second=await approvedRevision();
 const obsolete=[await job({configurationId:first}),await job({configurationId:first},'Dispatched'),await job({configurationId:first,trigger:'INTERVAL'})];
 const kept=[await job({configurationId:second},'Dispatched'),await job({}),await job({configurationId:first},'Dispatched','synthetic_export'),await job({configurationId:first},'Dispatched','synthetic_scan',{state:'RECONCILIATION_REQUIRED'}),await job({configurationId:first},'Dispatched','synthetic_scan',{outcome:'COMPLETED'}),await job({configurationId:randomUUID()}),await job({configurationId:null}),await job({configurationId:first},'Cancelled'),...await Promise.all(['MANUAL','DEEP',null,'UNKNOWN'].map(trigger=>job({configurationId:first,trigger})))];
 kept.push(await job({configurationId:first,trigger:'INTERVAL',unexpected:'preserve'}),await job({configurationId:first,actorId:'invalid'}));
 await tx(()=>activateSetting(db,checker,second));
 for(const id of obsolete)expect((await rows()).find(r=>r.id===id)).toMatchObject({state:'Cancelled',cancel_epoch:3});
 for(const id of kept)expect((await rows()).find(r=>r.id===id)?.cancel_epoch).toBe(2);
 expect((await db.query('SELECT * FROM integration_job_receipt WHERE outbox_id=ANY($1::uuid[])',[obsolete])).rows).toHaveLength(0);
 const audit=await db.query<{resource_id:string;details:unknown}>('SELECT resource_id,details FROM audit_chain WHERE action=$1',['JOB_CANCELLED_CONFIGURATION_CHANGED']);expect(audit.rows.map(r=>r.resource_id).sort()).toEqual(obsolete.sort());
 expect(audit.rows[0].details).toMatchObject({outcome:'CANCELLED',reasonCode:'HIS_CONFIGURATION_CHANGED'});
 expect(verifyAuditChain((await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT * FROM audit_chain ORDER BY sequence')).rows)).toBe(true);
});

it('startup recovers preexisting obsolete dispatched jobs under worker_rw in its own locked transaction, without repeat audit',async()=>{
 await db.exec(await readFile('packages/db/roles.sql','utf8'));
 const old=(await db.query<{id:string}>("SELECT id FROM settings_revision WHERE setting_key='his_inbound' AND state='Archived' ORDER BY version LIMIT 1")).rows[0].id;
 const current=(await db.query<{revision_id:string}>("SELECT revision_id FROM setting_active WHERE setting_key='his_inbound'")).rows[0].revision_id;
 const pending=await job({configurationId:old}),dispatched=await job({configurationId:old},'Dispatched');
 const failedCurrent=await job({configurationId:current},'Dispatched'),legacy=await job({trigger:'INTERVAL'},'Dispatched');
 const statements:string[]=[];
 const traced:Queryable={async query<T>(sql:string,values?:unknown[]){statements.push(sql);return db.query<T>(sql,values);}};
 await db.query('SET ROLE worker_rw');
 try{
  expect((await cancelObsoleteInboundScansAtStartup(traced)).sort()).toEqual([pending,dispatched].sort());
  const before=(await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='JOB_CANCELLED_CONFIGURATION_CHANGED'")).rows[0].n;
  expect(await cancelObsoleteInboundScansAtStartup(traced)).toEqual([]);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='JOB_CANCELLED_CONFIGURATION_CHANGED'")).rows[0].n).toBe(before);
 }finally{await db.query('RESET ROLE');}
 expect(statements[0]).toBe('BEGIN');expect(statements[1]).toContain('pg_advisory_xact_lock_shared');expect(statements[2]).toContain('FROM setting_active');expect(statements.at(-1)).toBe('COMMIT');
 for(const id of [pending,dispatched])expect((await rows()).find(r=>r.id===id)).toMatchObject({state:'Cancelled',cancel_epoch:3});
 for(const id of [failedCurrent,legacy])expect((await rows()).find(r=>r.id===id)).toMatchObject({state:'Dispatched',cancel_epoch:2});
 expect((await db.query('SELECT * FROM integration_job_receipt WHERE outbox_id=ANY($1::uuid[])',[[pending,dispatched]])).rows).toHaveLength(0);
});

it('cancels an old-config enqueue after activation before dispatch, and rolls cancellation plus audit back together',async()=>{
 const old=(await db.query<{id:string}>("SELECT id FROM settings_revision WHERE setting_key='his_inbound' AND state='Archived' LIMIT 1")).rows[0].id;
 // Model the interval cycle that read old settings just before activation, then enqueued afterward.
 const late=await job({configurationId:old});
 const auditBefore=(await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n;
 await db.query('BEGIN');expect(await cancelObsoleteInboundScans(db)).toEqual([late]);
 expect((await db.query("SELECT id FROM job_outbox WHERE id=$1 AND state='Pending'",[late])).rows).toEqual([]);await db.query('ROLLBACK');
 expect((await rows()).find(r=>r.id===late)).toMatchObject({state:'Pending',cancel_epoch:2});
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n).toBe(auditBefore);
 await tx(async()=>{expect(await cancelObsoleteInboundScans(db)).toEqual([late]);});
});

it('does not infer obsolescence from a missing/unverified active pointer; startup rolls back a schema failure',async()=>{
 const old=(await db.query<{id:string}>("SELECT id FROM settings_revision WHERE setting_key='his_inbound' AND state='Archived' LIMIT 1")).rows[0].id;
 const target=await job({configurationId:old});
 await db.query('BEGIN');await db.query("DELETE FROM setting_active WHERE setting_key='his_inbound'");expect(await cancelObsoleteInboundScans(db)).toEqual([]);await db.query('ROLLBACK');
 await db.query('BEGIN');await db.query("UPDATE settings_revision SET test_passed=false WHERE id=(SELECT revision_id FROM setting_active WHERE setting_key='his_inbound')");expect(await cancelObsoleteInboundScans(db)).toEqual([]);await db.query('ROLLBACK');
 const active=(await db.query<{id:string;value:unknown}>("SELECT r.id,r.value FROM settings_revision r JOIN setting_active a ON a.revision_id=r.id WHERE a.setting_key='his_inbound'")).rows[0];
 // Adversarial stored JSON accepted by SQL constraints, without changing immutable revision payloads.
 const invalid=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,approved_by,test_passed,reason)
  SELECT setting_key,version+1000,category,risk,'{"invalid":true}','Active',created_by,approved_by,true,'CORRUPT_SCHEMA_TEST' FROM settings_revision WHERE id=$1 RETURNING id`,[active.id])).rows[0].id;
 await db.query("UPDATE setting_active SET revision_id=$1 WHERE setting_key='his_inbound'",[invalid]);
 try{await expect(cancelObsoleteInboundScansAtStartup(db)).rejects.toThrow();}
 finally{await db.query("UPDATE setting_active SET revision_id=$1 WHERE setting_key='his_inbound'",[active.id]);await db.query("UPDATE settings_revision SET state='Archived' WHERE id=$1",[invalid]);}
 expect((await rows()).find(r=>r.id===target)).toMatchObject({state:'Pending',cancel_epoch:2});
 expect((await db.query('SELECT * FROM audit_chain WHERE resource_id=$1 AND action=$2',[target,'JOB_CANCELLED_CONFIGURATION_CHANGED'])).rows).toEqual([]);
});

it('keeps the session lease from before job reads through actual receipt persistence, without an outer transaction',async()=>{
 const current=(await db.query<{revision_id:string}>("SELECT revision_id FROM setting_active WHERE setting_key='his_inbound'")).rows[0].revision_id;
 const id=await job({configurationId:current},'Dispatched'),statements:string[]=[];
 const traced:Queryable={async query<T>(sql:string,values?:unknown[]){statements.push(sql);return db.query<T>(sql,values);}};
 const result=await withInboundConfigurationLease(traced,async()=>{
  expect((await traced.query('SELECT id FROM job_outbox WHERE id=$1',[id])).rows).toHaveLength(1);
  await traced.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[id,JSON.stringify({outcome:'COMPLETED'})]);
  return 'COMPLETED';
 });
 expect(result).toBe('COMPLETED');expect(statements[0]).toContain('pg_advisory_lock_shared(');expect(statements[1]).toContain('SELECT id FROM job_outbox');expect(statements[2]).toContain('INSERT INTO integration_job_receipt');expect(statements[3]).toContain('pg_advisory_unlock_shared(');
 expect(statements.some(sql=>['BEGIN','COMMIT'].includes(sql))).toBe(false);
 expect((await rows()).find(r=>r.id===id)).toMatchObject({state:'Dispatched',cancel_epoch:2});
});

it('releases the session lease on handler failure, and never starts work if acquisition fails',async()=>{
 const statements:string[]=[];
 const traced:Queryable={async query<T>(sql:string,values?:unknown[]){statements.push(sql);return db.query<T>(sql,values);}};
 await expect(withInboundConfigurationLease(traced,async()=>{throw Error('CURRENT_SCAN_FAILED');})).rejects.toThrow('CURRENT_SCAN_FAILED');
 expect(statements).toHaveLength(2);expect(statements[1]).toContain('pg_advisory_unlock_shared(');
 let called=false;
 const unavailable:Queryable={async query(){throw Error('CONNECTION_UNAVAILABLE');}};
 await expect(withInboundConfigurationLease(unavailable,async()=>{called=true;})).rejects.toThrow('CONNECTION_UNAVAILABLE');expect(called).toBe(false);
});
