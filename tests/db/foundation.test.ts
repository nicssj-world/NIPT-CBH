import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {registerCase} from '../../packages/db/registration';
import {verifyAuditChain} from '../../packages/db/audit';
let db:PGlite;
const actor='10000000-0000-4000-8000-000000000001';
async function register(ln:string,key:string){await db.query('BEGIN');try {const result=await registerCase(db,{ln,identityKey:'a'.repeat(64),origin:'ANC',actorId:actor,idempotencyKey:key});await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}}
describe('PostgreSQL foundation',()=>{
 beforeAll(async()=>{db=new PGlite();await migrate(db);});afterAll(async()=>{await db.close();});
 it('migration is idempotent',async()=>{await migrate(db);expect((await db.query('SELECT * FROM schema_migration')).rows.length).toBeGreaterThan(0);});
 it('registers atomically and reopens duplicate across origins',async()=>{const a=await register('000001','registration_000001');const b=await register('000001','registration_000002');expect(a.outcome).toBe('CREATED');expect(b).toEqual({caseId:a.caseId,outcome:'OPENED'});expect(await register('000001','registration_000001')).toEqual(a);const audit=await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT * FROM audit_chain ORDER BY sequence');expect(verifyAuditChain(audit.rows)).toBe(true);await expect(db.query("UPDATE audit_chain SET action='tamper'")).rejects.toThrow(/append-only/);});
 it('fails cross-case round reference and immutable origin',async()=>{const a=await register('000002','registration_000003');const b=await register('000003','registration_000004');const rounds=await db.query<{current_round_id:string}>('SELECT current_round_id FROM nipt_case WHERE id=$1',[b.caseId]);await expect(db.query('UPDATE nipt_case SET current_round_id=$1 WHERE id=$2',[rounds.rows[0].current_round_id,a.caseId])).rejects.toThrow();await expect(db.query("UPDATE nipt_case SET registration_origin='LAB_DIRECT' WHERE id=$1",[a.caseId])).rejects.toThrow(/immutable/);});
 it('blocks historical creation and forged PET verification',async()=>{await expect(db.query("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1)",['b'.repeat(64)])).rejects.toThrow(/disabled/);await expect(db.query("UPDATE case_ln SET verification='VERIFIED_BY_PET'")).rejects.toThrow(/PET/);await expect(db.query("UPDATE specimen_round SET state='ReceivedInHIS',received_source='HIS_PET_RECEIPT',received_at=now() WHERE round_number=1")).rejects.toThrow(/HIS order/);});
 it('enforces S2 redraw same LN, local receipt check, repeat same round and immutable receipt',async()=>{
 const a=await register('000004','registration_000005');const r=await db.query<{id:string;case_ln_id:string}>('SELECT id,case_ln_id FROM specimen_round WHERE case_id=$1',[a.caseId]);const s1=r.rows[0];
 await db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[s1.id]);
 const d=await db.query<{id:string}>('INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,$3) RETURNING id',[a.caseId,s1.id,'SYNTHETIC_REDRAW']);
 await expect(db.query('INSERT INTO specimen_round(case_id,case_ln_id,round_number) VALUES($1,$2,2)',[a.caseId,s1.case_ln_id])).rejects.toThrow();
 const s2=await db.query<{id:string}>('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[a.caseId,s1.case_ln_id,d.rows[0].id]);
 await expect(db.query("UPDATE specimen_round SET state='ReceivedInHIS',received_source='HIS_PET_RECEIPT',received_at=now() WHERE id=$1",[s2.rows[0].id])).rejects.toThrow();
 await expect(db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now() WHERE id=$1",[s2.rows[0].id])).rejects.toThrow();
 await db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,receipt_check='{\"identity\":true,\"label\":true}' WHERE id=$1",[s2.rows[0].id,actor]);
 await expect(db.query("UPDATE specimen_round SET received_at=received_at+interval '1 second' WHERE id=$1",[s2.rows[0].id])).rejects.toThrow(/immutable/);
 const repeat=await db.query<{id:string}>("INSERT INTO repeat_work_order(case_id,round_id,reason_code,state) VALUES($1,$2,'SYNTHETIC_REPEAT','RepeatRequested') RETURNING id",[a.caseId,s1.id]);
 await expect(db.query('INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id) VALUES($1,$2,2,$3)',[a.caseId,s2.rows[0].id,repeat.rows[0].id])).rejects.toThrow();
 });
 it('handles simultaneous queued registrations as one case with PostgreSQL uniqueness',async()=>{const requests=Array.from({length:8},(_,i)=>()=>register('000005',`concurrent_register_${i}`));let serial=Promise.resolve();const results=await Promise.all(requests.map(task=>{const next=serial.then(task);serial=next.then(()=>undefined);return next;}));expect(results.filter(r=>r.outcome==='CREATED')).toHaveLength(1);expect(new Set(results.map(r=>r.caseId)).size).toBe(1);});
});

