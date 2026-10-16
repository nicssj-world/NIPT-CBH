import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {hashPassword} from '../../packages/security/password';
import {readSession,authenticate} from '../../packages/security/session';
import {verifyAuditChain} from '../../packages/db/audit';
import {adminCommand,changePassword,listUsers,listUnits,listAudit} from '../../packages/admin/service';
import type {Principal} from '../../packages/security/policy';
let db:PGlite,admin:Principal,checker:Principal,target:string;
const password='Admin-test-strong-789';
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
beforeAll(async()=>{db=new PGlite();await migrate(db);const hash=await hashPassword(password);
 for(const [name,role] of [['admin','APP_ADMIN'],['checker','CLINICAL_APPROVER']]){const r=await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$1,$2) RETURNING id',[name,hash]);await db.query('INSERT INTO role_assignment(user_id,role) VALUES($1,$2)',[r.rows[0].id,role]);const p={id:r.rows[0].id,roles:[role],unitIds:[],permissions:[]} as Principal;if(name==='admin')admin=p;else checker=p;}
});
afterAll(async()=>db?.close());
it('creates no implicit access, normalizes usernames, never returns hashes; denies duplicate and non-admin',async()=>{
 const r=await tx(()=>adminCommand(db,admin,{operation:'createUser',username:'Test.User',displayName:'ผู้ใช้ทดสอบ',password}));target=r.id!;
 const rows=await listUsers(db,admin,{search:'test.user'});expect(rows.rows[0].username).toBe('test.user');expect(JSON.stringify(rows)).not.toContain('$argon');expect(rows.rows[0].roles).toEqual([]);
 await expect(tx(()=>adminCommand(db,admin,{operation:'createUser',username:'TEST.USER',displayName:'duplicate',password}))).rejects.toThrow();
 await expect(tx(()=>adminCommand(db,checker,{operation:'createUser',username:'denied',displayName:'denied',password}))).rejects.toThrow('FORBIDDEN');
});
it('requires independent approval for roles, scope and permissions; rejects self escalation and stale requests',async()=>{
 const unit=await tx(()=>adminCommand(db,admin,{operation:'saveUnit',code:'TEST',name:'ทดสอบ',active:true}));
 const req=await tx(()=>adminCommand(db,admin,{operation:'requestAccess',id:target,version:1,roles:['ANC_NURSE'],unitIds:[unit.id],permissions:['ANC_VIEW_ALL_UNITS'],reason:'UAT access'}));
 expect((await listUsers(db,admin,{search:'test.user'})).rows[0].roles).toEqual([]);
 await expect(tx(()=>adminCommand(db,admin,{operation:'approveAccess',id:req.id}))).rejects.toThrow('FORBIDDEN');
 await tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:req.id}));
 expect((await listUsers(db,admin,{search:'test.user'})).rows[0].roles).toEqual(['ANC_NURSE']);
 await expect(tx(()=>adminCommand(db,admin,{operation:'requestAccess',id:admin.id,version:1,roles:['CLINICAL_APPROVER'],unitIds:[],permissions:[],reason:'self'}))).rejects.toThrow();
 await expect(tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:req.id}))).rejects.toThrow();
 await expect(tx(()=>adminCommand(db,admin,{operation:'saveUnit',id:unit.id,version:1,code:'CHANGED',name:'changed',active:true}))).rejects.toThrow();
 expect((await listUnits(db,admin)).rows[0].code).toBe('TEST');
});
it('reset forces password change, revokes sessions, rejects weak policy and wrong current password',async()=>{
 const login=await tx(()=>authenticate(db,'test.user',password));expect(login).not.toBeNull();
 await tx(()=>adminCommand(db,admin,{operation:'resetPassword',id:target,version:2,password:'Temporary-test-98765'}));
 expect(await readSession(db,login!.token)).toBeNull();
 const fresh=await tx(()=>authenticate(db,'test.user','Temporary-test-98765'));const p=await readSession(db,fresh!.token);expect(p?.mustChangePassword).toBe(true);
 expect(await tx(()=>changePassword(db,p!,'wrong','New-strong-123456'))).toBe(false);
 await expect(tx(()=>changePassword(db,p!,'Temporary-test-98765','password123'))).rejects.toThrow();
 await tx(()=>changePassword(db,p!,'Temporary-test-98765','New-strong-123456'));
 expect(await readSession(db,fresh!.token)).toBeNull();
 const next=await tx(()=>authenticate(db,'test.user','New-strong-123456'));expect((await readSession(db,next!.token))?.mustChangePassword).toBe(false);
});
it('rejects stale profile update, disables without deleting, revokes access immediately and preserves audit chain',async()=>{
 await expect(tx(()=>adminCommand(db,admin,{operation:'updateUser',id:target,version:1,username:'test.user',displayName:'stale',unitId:null,enabled:true}))).rejects.toThrow();
 const u=(await listUsers(db,admin,{search:'test.user'})).rows[0];
 await tx(()=>adminCommand(db,admin,{operation:'updateUser',id:target,version:u.version,username:'test.user',displayName:'disabled',unitId:null,enabled:false}));
 expect(await tx(()=>authenticate(db,'test.user','New-strong-123456'))).toBeNull();
 const chain=await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT * FROM audit_chain ORDER BY sequence');expect(verifyAuditChain(chain.rows)).toBe(true);
 const audit=await listAudit(db,admin,{search:'USER'});expect(audit.rows.length).toBeGreaterThan(0);expect(JSON.stringify(audit)).not.toContain('Temporary-test');
});
it('allows correcting an unused department code and protects referenced codes',async()=>{const unit=await tx(()=>adminCommand(db,admin,{operation:'saveUnit',code:'UNUSED',name:'ยังไม่ใช้งาน',active:true}));await tx(()=>adminCommand(db,admin,{operation:'saveUnit',id:unit.id,version:1,code:'UNUSED-FIXED',name:'แก้รหัส',active:true}));expect((await listUnits(db,admin,{search:'UNUSED-FIXED'})).rows).toHaveLength(1);});
it('paginates filtered users without duplicates and retains disabled role filters',async()=>{
 await db.query("INSERT INTO app_user(username,display_name,password_hash) SELECT 'pagination.'||lpad(g::text,2,'0'),'แบ่งหน้า',(SELECT password_hash FROM app_user WHERE id=$1) FROM generate_series(1,23) g",[admin.id]);
 const first=await listUsers(db,admin,{search:'pagination.',page:1}),second=await listUsers(db,admin,{search:'pagination.',page:2});expect(first.total).toBe(23);expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(3);expect(new Set([...first.rows,...second.rows].map(u=>u.id)).size).toBe(23);
 expect((await listUsers(db,admin,{search:'test.user',role:'ANC_NURSE',status:'Disabled'})).rows).toHaveLength(1);
});
