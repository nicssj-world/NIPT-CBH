import {it,expect,describe,beforeAll,afterAll} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,TEST_PASSWORD} from '../helpers/database';
import {tx} from '../helpers/lab';
import {syntheticSignaturePng} from '../helpers/signature-png';
import {bootstrapAdministrators} from '../../packages/admin/bootstrap';
import {adminCommand,changePassword} from '../../packages/admin/service';
import {submitSignerProfile,decideSignerProfile,grantDelegation,listSigners,signerAuthority} from '../../packages/readygen/signers';
import {authorize,type Principal} from '../../packages/security/policy';
import {FileStore} from '../../packages/storage';

// Owner decision 2026-11-01: Production starts with ONE APP_ADMIN. The administrator selects Reported By and Approved By in one
// session; each named person's evidence (own verified profile + own standing delegation) is what allows their name and signature,
// and the operator stays recorded as the administrator. Synthetic people only.
describe('single APP_ADMIN with separate Reported By / Approved By personnel',()=>{
 let db:PGlite,root:string,store:FileStore,admin:Principal,reporter:Principal,approver:Principal;
 const run=<T>(fn:()=>Promise<T>)=>tx(db,fn);
 beforeAll(async()=>{
  db=await testDatabase();root=await mkdtemp(path.join(os.tmpdir(),'nipt-single-admin-'));store=new FileStore(path.join(root,'files'));
  await run(()=>bootstrapAdministrators(db,{admin:{username:'first.admin',displayName:'ผู้ดูแลระบบ (ทดสอบ)',password:TEST_PASSWORD}}));
  const id=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='first.admin'")).rows[0].id;
  admin={id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
  // the one-time password must be replaced before the account can act
  await expect(run(()=>adminCommand(db,admin,{operation:'saveUser',username:'synthetic.early',displayName:'synthetic.early',password:TEST_PASSWORD,jobPosition:'นักเทคนิคการแพทย์',phone:'',unitId:null,enabled:true,roles:['LAB_STAFF'],unitIds:[],permissions:[]}))).rejects.toThrow('FORBIDDEN');
  expect(await run(()=>changePassword(db,admin,TEST_PASSWORD,'Synthetic-Rotated-Admin-99!'))).toBe(true);
  // the administrator alone creates the personnel (normal user management, no second approver required)
  const person=async(username:string,role:'LAB_STAFF'|'LAB_CERTIFIER')=>({id:(await run(()=>adminCommand(db,admin,{operation:'saveUser',username,displayName:username,password:TEST_PASSWORD,jobPosition:'นักเทคนิคการแพทย์',phone:'',unitId:null,enabled:true,roles:[role],unitIds:[],permissions:[]}))).id,roles:[role],unitIds:[],permissions:[]} as Principal);
  reporter=await person('synthetic.reporter','LAB_STAFF');approver=await person('synthetic.approver','LAB_CERTIFIER');
 });
 afterAll(async()=>{await db?.close();await rm(root,{recursive:true,force:true});});

 it('installation has exactly one application account, APP_ADMIN, and no CLINICAL_APPROVER bootstrap account',async()=>{
  const rows=(await db.query<{username:string;role:string}>("SELECT u.username,a.role FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.username NOT LIKE 'synthetic.%'")).rows;
  expect(rows).toEqual([{username:'first.admin',role:'APP_ADMIN'}]);
  expect((await db.query("SELECT 1 FROM role_assignment WHERE role='CLINICAL_APPROVER'")).rows).toEqual([]);
 });

 it('APP_ADMIN reaches every module without the CLINICAL_APPROVER / LAB_CERTIFIER role',()=>{
  for(const action of ['user.manage','settings.read','case.register.anc','case.register.lab','batch.draft','qc.accept','pool.approve','observation.verify','result.review','result.revise','clinical.correct','integration.configure','audit.read','report.export'])
   expect(authorize(admin,action,{actorId:'someone-else'},action==='settings.read'||action==='audit.read'?'read':'approve'),action).toBe(true);
 });

 it('a selected name alone is not evidence: not usable and refused until that person has their own verified profile and delegation',async()=>{
  expect(await run(()=>listSigners(db,admin,{role:'APPROVED',q:''}))).toEqual([]);
  await expect(run(()=>signerAuthority(db,admin,approver.id,'APPROVED'))).rejects.toMatchObject({code:'SIGNER_PROFILE_NOT_VERIFIED'});
  // each person submits their OWN profile; the administrator verifies it (never their own)
  for(const [p,name,lic,seed] of [[reporter,'Synthetic Reporter','99001',1],[approver,'Synthetic Approver','99002',2]] as const){
   const prof=await run(()=>submitSignerProfile(db,p,store,{legalName:name,mtLicenseNo:lic,signature:syntheticSignaturePng(seed)}));
   await run(()=>decideSignerProfile(db,admin,{profileId:prof.id,decision:'VERIFY',reason:'SYNTHETIC identity and licence checked'}));
  }
  // verified, but the person has not authorised the administrator to apply their signature: listed as not usable, refused
  expect((await run(()=>listSigners(db,admin,{role:'APPROVED',q:''}))).map(s=>[s.legalName,s.usable])).toEqual([['Synthetic Approver',false]]);
  await expect(run(()=>signerAuthority(db,admin,approver.id,'APPROVED'))).rejects.toMatchObject({code:'SIGNATURE_DELEGATION_REQUIRED'});
  // the APP_ADMIN is not a signer itself and cannot be named
  await expect(run(()=>signerAuthority(db,admin,admin.id,'APPROVED'))).rejects.toMatchObject({code:'SIGNER_NOT_ELIGIBLE'});
 });

 it('after each person delegates, the administrator selects both in ONE session; personnel and operator are recorded separately',async()=>{
  await run(()=>grantDelegation(db,reporter,{granteeId:admin.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  await run(()=>grantDelegation(db,approver,{granteeId:admin.id,roles:['APPROVED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  const session=admin; // one authenticated principal for both selections
  const reported=await run(()=>signerAuthority(db,session,reporter.id,'REPORTED')),approved=await run(()=>signerAuthority(db,session,approver.id,'APPROVED'));
  expect(reported).toMatchObject({basis:'STANDING_DELEGATION',operatorId:admin.id,role:'REPORTED',profile:{user_id:reporter.id,legal_name:'Synthetic Reporter',mt_license_no:'99001'}});
  expect(approved).toMatchObject({basis:'STANDING_DELEGATION',operatorId:admin.id,role:'APPROVED',profile:{user_id:approver.id,legal_name:'Synthetic Approver',mt_license_no:'99002'}});
  expect(reported.delegationId).not.toBe(approved.delegationId);
  expect((await run(()=>listSigners(db,session,{role:'REPORTED',q:''}))).find(s=>s.userId===reporter.id)).toMatchObject({usable:true,basis:'STANDING_DELEGATION'});
  // a reporter-only delegation does not let the administrator name that person as Approved By
  await expect(run(()=>signerAuthority(db,session,reporter.id,'APPROVED'))).rejects.toMatchObject({code:'SIGNER_NOT_ELIGIBLE'});
 });

 it('the administrator still cannot approve its own work (maker-checker unchanged)',()=>{
  for(const action of ['observation.verify','handoff.verify','settings.approve','downtime.approve','result.link.manual','his.conflict.resolve'])
   expect(authorize(admin,action,{actorId:admin.id},'approve'),action).toBe(false);
 });
});
