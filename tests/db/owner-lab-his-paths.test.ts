import {it,expect} from 'vitest';
import {testDatabase,addUser} from '../helpers/database';
import {hisPathOverview,proposeHisPaths,applyHisPaths} from '../../packages/settings/his-paths';
import {readActiveSettings} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';

// OWNER-LAB-055/059: an administrator changes ONLY HIS folder paths; the change is applied only after the worker test passed.
const passWorkerTest=async(db:Awaited<ReturnType<typeof testDatabase>>,jobId:string,revisionId:string,version:number,passed=true)=>
 db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[jobId,JSON.stringify({passed,revisionId,version,...(passed?{}:{errorCode:'SHARE_PATH_NOT_FOUND'})})]);

it('admin path change: default → tested → applied, other fields unchanged, previous active archived and restorable',async()=>{
 const db=await testDatabase();try{
  const admin=await addUser(db,'APP_ADMIN','synthetic.his.admin');
  const before=await hisPathOverview(db,admin) as {keys:Record<string,{usingDefaults:boolean;paths:Record<string,string>}>};
  expect(before.keys.his_inbound.usingDefaults).toBe(true);expect(before.keys.his_inbound.paths.pet).toBe(SETTINGS.his_inbound.default.basePath);
  const proposed=await proposeHisPaths(db,admin,{paths:{pet:'D:\\HIS-A\\Request'},reason:'synthetic wrong default corrected'},async()=>true);
  expect(proposed.revisions).toHaveLength(1);const r=proposed.revisions[0];expect(r.key).toBe('his_inbound');
  await expect(applyHisPaths(db,admin,{ids:[r.id]})).rejects.toThrow('HIS_PATH_TEST_RUNNING');
  await passWorkerTest(db,r.jobId!,r.id,r.version);
  const applied=await applyHisPaths(db,admin,{ids:[r.id]});
  expect(applied.active.his_inbound).toEqual({pet:'D:\\HIS-A\\Request'});
  const active=(await readActiveSettings(db)).his_inbound as Record<string,unknown>;
  expect(active).toEqual({...SETTINGS.his_inbound.default,basePath:'D:\\HIS-A\\Request'});
  // A → B, then back to A; each change is a new audited version and the older one is archived.
  const toB=(await proposeHisPaths(db,admin,{paths:{pet:'D:\\HIS-B\\Request'},reason:'switch to B'},async()=>true)).revisions[0];
  await passWorkerTest(db,toB.jobId!,toB.id,toB.version);await applyHisPaths(db,admin,{ids:[toB.id]});
  const toA=(await proposeHisPaths(db,admin,{paths:{pet:'D:\\HIS-A\\Request'},reason:'back to A'},async()=>true)).revisions[0];
  await passWorkerTest(db,toA.jobId!,toA.id,toA.version);await applyHisPaths(db,admin,{ids:[toA.id]});
  const states=(await db.query<{version:number;state:string}>("SELECT version,state FROM settings_revision WHERE setting_key='his_inbound' ORDER BY version")).rows;
  expect(states).toEqual([{version:1,state:'Archived'},{version:2,state:'Archived'},{version:3,state:'Active'}]);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='HIS_PATH_CHANGE_APPLIED'")).rows[0].n).toBe(3);
 }finally{await db.close();}
});

it('a failed worker test is never applied; non-admins cannot change paths; non-path fields cannot ride along',async()=>{
 const db=await testDatabase();try{
  const admin=await addUser(db,'APP_ADMIN','synthetic.his.admin2'),lab=await addUser(db,'LAB_STAFF','synthetic.his.lab');
  const r=(await proposeHisPaths(db,admin,{paths:{res:'D:\\Wrong\\Res',cfsPdf:'D:\\Wrong\\Pdf',backup:'D:\\Wrong\\Backup'},reason:'wrong folders'},async()=>true)).revisions[0];
  expect(r.key).toBe('his_outbound');await passWorkerTest(db,r.jobId!,r.id,r.version,false);
  await expect(applyHisPaths(db,admin,{ids:[r.id]})).rejects.toThrow('HIS_PATH_TEST_NOT_PASSED');
  expect((await readActiveSettings(db)).his_outbound).toBeUndefined();
  await expect(proposeHisPaths(db,lab,{paths:{pet:'D:\\X'},reason:'not allowed'},async()=>true)).rejects.toThrow();
  // Enabling live I/O is not a path: the request is ignored by this flow and stays under the two-person approval.
  const only=await proposeHisPaths(db,admin,{paths:{pet:'D:\\Y'},reason:'path only',...{enabled:true}} as never,async()=>true);
  const value=(await db.query<{value:{enabled:boolean}}>('SELECT value FROM settings_revision WHERE id=$1',[only.revisions[0].id])).rows[0].value;
  expect(value.enabled).toBe(false);
  // External result PDF folder: only pdfSourcePath changes inside the CLINICAL result_management setting.
  const res=(await proposeHisPaths(db,admin,{paths:{externalPdf:'D:\\Application\\NIPTY\\NIPTPDFresult'},reason:'external PDF folder'},async()=>true)).revisions[0];
  await applyHisPaths(db,admin,{ids:[res.id]});
  expect((await readActiveSettings(db)).result_management).toEqual({...SETTINGS.result_management.default,pdfSourcePath:'D:\\Application\\NIPTY\\NIPTPDFresult'});
  const failed=(await proposeHisPaths(db,admin,{paths:{externalPdf:'D:\\Missing'},reason:'missing folder'},async()=>false)).revisions[0];
  await expect(applyHisPaths(db,admin,{ids:[failed.id]})).rejects.toThrow('HIS_PATH_TEST_NOT_PASSED');
 }finally{await db.close();}
});

// Owner 2026-10-27 (migration 157): an APP_ADMIN's validated HIS revision is system configuration and activates without a second person, so the
// guard is now tied to WHO authored the revision (a current APP_ADMIN assignment), not to the wording of the reason. Anyone else still needs the checker.
it('database guard: a "path change" revision that also switches on live I/O still needs the second approver unless an APP_ADMIN authored it',async()=>{
 const db=await testDatabase();try{
  const admin=await addUser(db,'LAB_STAFF','synthetic.his.admin3');
  const value={...SETTINGS.his_inbound.default,basePath:'D:\HIS-C',enabled:true};
  const id=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,test_passed)
   VALUES('his_inbound',1,'HIS Inbound','INTEGRATION',$1,'Validated',$2,'HIS path change: sneak',true) RETURNING id`,[JSON.stringify(value),admin.id])).rows[0].id;
  await expect(db.query('INSERT INTO setting_active(setting_key,revision_id) VALUES($1,$2)',['his_inbound',id])).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
 }finally{await db.close();}
});

it('path-only change on top of a live two-person outbound setting with nested profile/mappings (jsonb key order) is applied',async()=>{
 const {proposeSetting,validateSetting:validate,approveSetting,activateSetting}=await import('../../packages/settings/service');
 const {syntheticProfile}=await import('../../packages/p6/res');
 const db=await testDatabase();try{
  const admin=await addUser(db,'APP_ADMIN','synthetic.his.admin4'),approver=await addUser(db,'CLINICAL_APPROVER','synthetic.his.approver4');
  const live=await proposeSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,enabled:true,target:'AUTHORIZED_SHARE',productionAuthorized:true,resDestinationPath:'D:\Old\Res',pdfDestinationPath:'D:\Old\Pdf',backupPath:'D:\Old\Backup',
   resProfile:{...syntheticProfile,syntheticOnly:false,version:'SYNTHETIC-NESTED'},certifierHisMappings:{[approver.id]:'SYN^CERT'}},'live outbound');
  await validate(db,admin,live,async()=>true);await approveSetting(db,approver,live);await activateSetting(db,approver,live);
  const r=(await proposeHisPaths(db,admin,{paths:{res:'D:\New\Res',cfsPdf:'D:\New\Pdf',backup:'D:\New\Backup'},reason:'server folders'},async()=>true)).revisions[0];
  await passWorkerTest(db,r.jobId!,r.id,r.version);await applyHisPaths(db,admin,{ids:[r.id]});
  const active=(await readActiveSettings(db)).his_outbound as Record<string,unknown>;
  expect(active).toMatchObject({enabled:true,productionAuthorized:true,resDestinationPath:'D:\New\Res',resProfile:{version:'SYNTHETIC-NESTED'}});
 }finally{await db.close();}
});

it('inbound: an accessible but still-empty PET root passes with a warning; PET files that do not parse fail',async()=>{
 const db=await testDatabase();try{
  const admin=await addUser(db,'APP_ADMIN','synthetic.his.admin5');
  const receipt=(jobId:string,r:Record<string,unknown>)=>db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[jobId,JSON.stringify(r)]);
  const empty=(await proposeHisPaths(db,admin,{paths:{pet:'D:\New\Empty'},reason:'new empty root'},async()=>true)).revisions[0];
  await receipt(empty.jobId!,{passed:false,revisionId:empty.id,version:empty.version,petFiles:0,errorCode:null,checks:[{code:'INBOUND_DIRECTORY',passed:true},{code:'DAY_FOLDERS_FOUND',passed:false},{code:'PET_OK_PAIR_FOUND',passed:false},{code:'SAMPLE_PARSE',passed:false}]});
  const o=await hisPathOverview(db,admin) as unknown as {keys:{his_inbound:{pending:{test:{state:string;warning?:string}}}}};
  expect(o.keys.his_inbound.pending.test).toMatchObject({state:'PASSED',warning:'INBOUND_FOLDER_EMPTY'});
  await applyHisPaths(db,admin,{ids:[empty.id]});
  const bad=(await proposeHisPaths(db,admin,{paths:{pet:'D:\New\Bad'},reason:'unparseable PET'},async()=>true)).revisions[0];
  await receipt(bad.jobId!,{passed:false,revisionId:bad.id,version:bad.version,petFiles:2,errorCode:null,checks:[{code:'INBOUND_DIRECTORY',passed:true},{code:'DAY_FOLDERS_FOUND',passed:true},{code:'PET_OK_PAIR_FOUND',passed:true},{code:'SAMPLE_PARSE',passed:false}]});
  await expect(applyHisPaths(db,admin,{ids:[bad.id]})).rejects.toThrow('HIS_PATH_TEST_NOT_PASSED');
 }finally{await db.close();}
});
