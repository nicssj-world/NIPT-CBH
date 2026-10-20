import {beforeAll,afterAll,it,expect} from 'vitest';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {adminCommand,listUsers} from '../../packages/admin/service';
import {authenticate,readSession} from '../../packages/security/session';
import type {PGlite} from '@electric-sql/pglite';
import type {Principal} from '../../packages/security/policy';
import {ROLES} from '../../packages/security/policy';
import {completeTargetEnrollment} from '../../packages/admin/enrollment';
let db:PGlite,admin:Principal,anc:Principal,checker:Principal,unit:string;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
beforeAll(async()=>{db=await testDatabase();admin=await addUser(db);anc=await addUser(db,'ANC_NURSE','synthetic.anc');checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker');unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC','ANC') RETURNING id")).rows[0].id;});
afterAll(async()=>db.close());
it('Admin creates a user with immediate roles, scopes and separate position/contact fields',async()=>{
 const user=await tx(()=>adminCommand(db,admin,{operation:'saveUser',username:'synthetic.newanc',displayName:'พยาบาลทดสอบ',password:TEST_PASSWORD,jobPosition:'พยาบาลวิชาชีพ',phone:'',unitId:unit,enabled:true,roles:['ANC_NURSE'],unitIds:[],permissions:[]}));
 const found=(await listUsers(db,admin,{search:'synthetic.newanc'})).rows[0];expect(found.id).toBe(user.id);expect(found).toMatchObject({job_position:'พยาบาลวิชาชีพ',phone:'',roles:['ANC_NURSE'],unit_ids:[unit]});
 expect((await db.query('SELECT id FROM admin_access_request WHERE user_id=$1',[user.id])).rows).toHaveLength(0);
 const login=await tx(()=>authenticate(db,'synthetic.newanc',TEST_PASSWORD));expect((await readSession(db,login!.token))?.roles).toEqual(['ANC_NURSE']);
});
it('direct changes revoke sessions and supersede legacy role requests, including approved enrollment',async()=>{
 const pending=await tx(()=>adminCommand(db,admin,{operation:'requestAccess',id:anc.id,version:1,roles:['APP_ADMIN'],unitIds:[],permissions:[],reason:'Legacy request'}));
 await tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:pending.id}));
 const login=await tx(()=>authenticate(db,'synthetic.checker',TEST_PASSWORD));
 const r=await tx(()=>adminCommand(db,admin,{operation:'saveUser',id:anc.id,version:2,username:'synthetic.anc',displayName:'พยาบาล',jobPosition:'พยาบาล',phone:'0123456789',unitId:unit,enabled:true,roles:['ANC_NURSE'],unitIds:[unit],permissions:[]}));
 expect(r.id).toBe(anc.id);expect((await db.query('SELECT request_id FROM admin_access_supersession WHERE request_id=$1',[pending.id])).rows).toHaveLength(1);
 await expect(tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:pending.id}))).rejects.toThrow('ACCESS_REQUEST_SUPERSEDED');
 await expect(tx(()=>completeTargetEnrollment(db,{requestId:pending.id,username:'synthetic.anc',password:TEST_PASSWORD,targetIdentityConfirmed:true}))).rejects.toThrow('ACCESS_REQUEST_SUPERSEDED');
 expect((await readSession(db,login!.token))?.roles).toEqual(['CLINICAL_APPROVER']);
});
it('supports every existing role, revokes target sessions and rejects legacy Pending replay',async()=>{
 for(const [i,role] of ROLES.entries()){
  const user=await tx(()=>adminCommand(db,admin,{operation:'saveUser',username:'synthetic.role'+i,displayName:'Test role',password:TEST_PASSWORD,unitId:unit,enabled:true,roles:[role],unitIds:[unit],permissions:[]}));
  const login=await tx(()=>authenticate(db,'synthetic.role'+i,TEST_PASSWORD));expect((await readSession(db,login!.token))?.roles).toEqual([role]);
  const pending=await tx(()=>adminCommand(db,admin,{operation:'requestAccess',id:user.id,version:1,roles:['AUDITOR'],unitIds:[],permissions:[],reason:'Legacy pending'}));
  await tx(()=>adminCommand(db,admin,{operation:'saveUser',id:user.id,version:1,username:'synthetic.role'+i,displayName:'Updated role',unitId:unit,enabled:true,roles:['ANC_NURSE'],unitIds:[unit],permissions:[]}));
  expect(await readSession(db,login!.token)).toBeNull();
  await expect(tx(()=>adminCommand(db,checker,{operation:'approveAccess',id:pending.id}))).rejects.toThrow('ACCESS_REQUEST_SUPERSEDED');
 }
});
it('denies non-admin and stale versions; protects last administrator',async()=>{
 const input={operation:'saveUser',id:admin.id,version:1,username:'synthetic.admin',displayName:'Admin',jobPosition:'',phone:'',unitId:null,enabled:true,roles:['ANC_NURSE'],unitIds:[unit],permissions:[]};
 await expect(tx(()=>adminCommand(db,checker,input))).rejects.toThrow('FORBIDDEN');
 await expect(tx(()=>adminCommand(db,admin,input))).rejects.toThrow('LAST_ADMIN_REQUIRED');
 await expect(tx(()=>adminCommand(db,admin,{...input,version:99}))).rejects.toThrow('STALE_VERSION');
});
