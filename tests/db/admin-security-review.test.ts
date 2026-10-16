import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {adminCommand,changePassword} from '../../packages/admin/service';
import {authenticate,readSession} from '../../packages/security/session';
import type {Principal} from '../../packages/security/policy';
import {completeTargetEnrollment} from '../../packages/admin/enrollment';
let db:PGlite,admin:Principal,checker:Principal,other:Principal;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker');other=await addUser(db,'LAB_STAFF','synthetic.other');});afterAll(async()=>db.close());
it('admin cannot choose checker credentials; recovery requires another checker and never returns secret to maker',async()=>{
 await expect(tx(()=>adminCommand(db,admin,{operation:'resetPassword',id:checker.id,version:1,password:'Attacker-known-12345'}))).rejects.toThrow('INDEPENDENT_RECOVERY_REQUIRED');
 expect(await tx(()=>authenticate(db,'synthetic.checker','Attacker-known-12345'))).toBeNull();
 const req=await tx(()=>adminCommand(db,admin,{operation:'requestPasswordReset',id:checker.id,version:1,reason:'Controlled recovery'}));expect(req).not.toHaveProperty('temporaryPassword');
 await expect(tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:req.id}))).rejects.toThrow('FORBIDDEN');
 const independent=await addUser(db,'CLINICAL_APPROVER','synthetic.independent');const result=await tx(()=>adminCommand(db,independent,{operation:'approveAccess',id:req.id}));expect(result).toEqual({id:req.id,state:'AwaitingEnrollment'});expect(result).not.toHaveProperty('temporaryPassword');
 expect(await tx(()=>authenticate(db,'synthetic.checker',TEST_PASSWORD))).toBeNull();
 await tx(()=>completeTargetEnrollment(db,{requestId:req.id,username:'synthetic.checker',password:'Target-only-enrollment-123456',targetIdentityConfirmed:true}));
 const login=await tx(()=>authenticate(db,'synthetic.checker','Target-only-enrollment-123456'));expect((await readSession(db,login!.token))?.mustChangePassword).toBe(true);
 await expect(tx(()=>adminCommand(db,independent,{operation:'approveAccess',id:req.id}))).rejects.toThrow();
 expect(JSON.stringify((await db.query('SELECT * FROM admin_access_request')).rows)).not.toContain('Target-only-enrollment');
 expect(JSON.stringify((await db.query('SELECT * FROM audit_chain')).rows)).not.toContain('Target-only-enrollment');
});
it('elevated approval gives NO usable target credential to maker/checker; operator activates target-only enrollment',async()=>{
 const req=await tx(()=>adminCommand(db,admin,{operation:'requestAccess',id:other.id,version:1,roles:['APP_ADMIN'],unitIds:[],permissions:[],reason:'Admin assignment'}));
 const independent=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.independent'")).rows[0];
 const result=await tx(()=>adminCommand(db,{...checker,id:independent.id},{operation:'approveAccess',id:req.id}));expect(result).toEqual({id:req.id,state:'AwaitingEnrollment'});expect(await tx(()=>authenticate(db,'synthetic.other',TEST_PASSWORD))).toBeNull();
 expect((await db.query("SELECT role FROM role_assignment WHERE user_id=$1",[other.id])).rows).toEqual([{role:'LAB_STAFF'}]);
 await tx(()=>completeTargetEnrollment(db,{requestId:req.id,username:'synthetic.other',password:'Target-other-only-123456',targetIdentityConfirmed:true}));expect((await db.query('SELECT role FROM role_assignment WHERE user_id=$1',[other.id])).rows).toEqual([{role:'APP_ADMIN'}]);
});
it('revalidates originating session after lock, and refuses revoked/expired/suspended sessions',async()=>{
 const login=await tx(()=>authenticate(db,'synthetic.admin',TEST_PASSWORD));const user=await readSession(db,login!.token);await db.query('UPDATE app_session SET revoked_at=now() WHERE id=$1',[user!.sessionId]);
 await expect(tx(()=>adminCommand(db,user!,{operation:'saveUnit',code:'REVOKED',name:'denied',active:true}))).rejects.toThrow('UNAUTHENTICATED');expect((await db.query("SELECT * FROM unit WHERE code='REVOKED'")).rows).toHaveLength(0);
 for(const column of ['idle_expires_at','absolute_expires_at','signing_suspended']){const next=await tx(()=>authenticate(db,'synthetic.admin',TEST_PASSWORD));const p=await readSession(db,next!.token);await db.query(`UPDATE app_session SET ${column}=${column==='signing_suspended'?'true':"clock_timestamp()-interval '1 second'"} WHERE id=$1`,[p!.sessionId]);await expect(tx(()=>adminCommand(db,p!,{operation:'saveUnit',code:'EXPIRED',name:'denied',active:true}))).rejects.toThrow('UNAUTHENTICATED');}
});
it('future sensitive assignments cannot be reset to maker-known credentials',async()=>{const future=await addUser(db,'LAB_STAFF','synthetic.future');await db.query("INSERT INTO role_assignment(user_id,role,effective_from) VALUES($1,'CLINICAL_APPROVER',clock_timestamp()+interval '1 day')",[future.id]);await expect(tx(()=>adminCommand(db,admin,{operation:'resetPassword',id:future.id,version:1,password:'Known-before-activation-12345'}))).rejects.toThrow('INDEPENDENT_RECOVERY_REQUIRED');});
it('persists current-password failed attempts and enforces five-attempt lockout without storing guesses',async()=>{
 const staff=await addUser(db,'LAB_STAFF','synthetic.lockout');const login=await tx(()=>authenticate(db,'synthetic.lockout',TEST_PASSWORD));const user=await readSession(db,login!.token);
 for(let i=0;i<5;i++)expect(await tx(()=>changePassword(db,user!,'Wrong-current-password','New-test-password-123'))).toBe(false);
 expect((await db.query<{failed_count:number;locked_until:Date}>('SELECT failed_count,locked_until FROM app_user WHERE id=$1',[staff.id])).rows[0].failed_count).toBe(5);
 expect(await tx(()=>changePassword(db,user!,TEST_PASSWORD,'New-test-password-123'))).toBe(false);expect(await readSession(db,login!.token)).toBeNull();
});
