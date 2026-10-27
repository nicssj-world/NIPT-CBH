import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {SETTINGS} from '../../packages/settings/catalog';
import {saveSystemSetting,inboundScanScope,isAdminDirectKey,ADMIN_DIRECT_KEYS} from '../../packages/settings/direct';
import {saveHisPaths,hisPathOverview} from '../../packages/settings/his-paths';
import {proposeSetting,readActiveSettings} from '../../packages/settings/service';
import {runHisSettingsTest} from '../../packages/jobs/his-settings-test';
import type {Principal} from '../../packages/security/policy';

// Owner 2026-10-27: system configuration is saved and Active in one step by the APP_ADMIN alone - no draft, no second approver, no mandatory reason,
// no worker test queue - and the value must still be there after a reload/restart. The clinical rules are untouched.
let db:PGlite,admin:Principal,lab:Principal,nurse:Principal,approver:Principal;
const inbound=(patch:Record<string,unknown>={})=>({...SETTINGS.his_inbound.default,...patch}) as Record<string,unknown>;
const active=async(key:string)=>(await readActiveSettings(db))[key] as Record<string,unknown>|undefined;
const count=async(sql:string)=>Number((await db.query<{n:string}>(sql)).rows[0].n);

describe('administrator saves system configuration in one step',()=>{
 beforeAll(async()=>{db=await testDatabase();admin=await addUser(db,'APP_ADMIN','synthetic.direct.admin');lab=await addUser(db,'LAB_STAFF','synthetic.direct.lab');nurse=await addUser(db,'ANC_NURSE','synthetic.direct.nurse');approver=await addUser(db,'CLINICAL_APPROVER','synthetic.direct.approver');});
 afterAll(async()=>{await db.close();});

 it('Auto Scan: first enable needs the scope confirmation, then it is Active at once, survives a reload and can be switched off again',async()=>{
  const jobsBefore=await count('SELECT count(*) n FROM job_outbox');
  await expect(saveSystemSetting(db,admin,'his_inbound',inbound({enabled:true}))).rejects.toThrow('SCAN_SCOPE_CONFIRMATION_REQUIRED');
  expect(await active('his_inbound')).toBeUndefined();                                    // nothing was saved by the refused attempt
  const saved=await saveSystemSetting(db,admin,'his_inbound',inbound({enabled:true,basePath:'D:\\HIS\\Request',intervalSeconds:60}),{confirmFirstScan:true});
  expect(saved).toMatchObject({saved:true,active:true,key:'his_inbound',version:1});
  expect(saved.changedFields).toEqual(['basePath','enabled','intervalSeconds']);
  expect(await active('his_inbound')).toMatchObject({enabled:true,basePath:'D:\\HIS\\Request',intervalSeconds:60});
  const row=(await db.query<{state:string;approved_by:string|null;reason:string;test_passed:boolean;created_by:string}>("SELECT state,approved_by,reason,test_passed,created_by FROM settings_revision WHERE id=$1",[saved.revisionId])).rows[0];
  expect(row).toMatchObject({state:'Active',approved_by:null,test_passed:true,created_by:admin.id});expect(row.reason.length).toBeGreaterThan(0);   // no approver, system-generated reason
  expect(await count('SELECT count(*) n FROM job_outbox')).toBe(jobsBefore);               // the save did not touch the worker queue
  // reload / runtime restart: the Active value is read again from the database and has not reverted
  expect(await active('his_inbound')).toMatchObject({enabled:true});
  // the path that was configured stays when only the switch changes; disabling needs no confirmation
  const off=await saveSystemSetting(db,admin,'his_inbound',inbound({enabled:false,basePath:'D:\\HIS\\Request',intervalSeconds:60}));
  expect(off.version).toBe(2);expect(await active('his_inbound')).toMatchObject({enabled:false,basePath:'D:\\HIS\\Request'});
  expect((await db.query<{state:string}>("SELECT state FROM settings_revision WHERE setting_key='his_inbound' ORDER BY version")).rows.map(r=>r.state)).toEqual(['Archived','Active']);
  // re-enabling an already configured scan asks again (it starts reading the folder); an unchanged save is a no-op
  await expect(saveSystemSetting(db,admin,'his_inbound',inbound({enabled:true,basePath:'D:\\HIS\\Request',intervalSeconds:60}))).rejects.toThrow('SCAN_SCOPE_CONFIRMATION_REQUIRED');
  expect(await saveSystemSetting(db,admin,'his_inbound',inbound({enabled:false,basePath:'D:\\HIS\\Request',intervalSeconds:60}))).toMatchObject({saved:false,unchanged:true,version:2});
 });

 it('records the actor, setting key, revision and outcome in the audit chain without values, paths or secrets; old and new values are the immutable revisions',async()=>{
  const a=(await db.query<{actor_id:string;action:string;resource_id:string;details:Record<string,unknown>}>("SELECT actor_id,action,resource_id,details FROM audit_chain WHERE action='SETTING_SAVED_ACTIVE' ORDER BY sequence")).rows;
  expect(a).toHaveLength(2);expect(a[0]).toMatchObject({actor_id:admin.id,details:{outcome:'ACTIVE',version:1,reasonCode:'his_inbound',count:3}});
  expect(JSON.stringify(a)).not.toMatch(/HIS\\|secret|password/i);
  const rev=(await db.query<{value:Record<string,unknown>;previous_revision_id:string|null}>("SELECT value,previous_revision_id FROM settings_revision WHERE id=$1",[a[1].resource_id])).rows[0];
  expect(rev.value.enabled).toBe(false);expect(rev.previous_revision_id).not.toBeNull();
  await expect(db.query("UPDATE settings_revision SET value='{}' WHERE id=$1",[a[1].resource_id])).rejects.toThrow(/IMMUTABLE/);
 });

 it('reason is optional everywhere; only an over-long one is refused',async()=>{
  expect(await saveSystemSetting(db,admin,'notifications',{...SETTINGS.notifications.default,staleSeconds:120})).toMatchObject({saved:true});
  expect(await saveSystemSetting(db,admin,'notifications',{...SETTINGS.notifications.default,staleSeconds:130},{reason:'x'.repeat(250)})).toMatchObject({saved:true});
  await expect(saveSystemSetting(db,admin,'notifications',{...SETTINGS.notifications.default,staleSeconds:140},{reason:'x'.repeat(251)})).rejects.toThrow('REASON_TOO_LONG');
  await expect(proposeSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,retryLimit:3},'')).resolves.toMatch(/^[0-9a-f-]{36}$/);   // draft flow: empty reason becomes a system reason
  await expect(proposeSetting(db,admin,'general',SETTINGS.general.default,'x'.repeat(251))).rejects.toThrow('REASON_TOO_LONG');
  expect(await count("SELECT count(*) n FROM settings_revision WHERE reason=''")).toBe(0);
 });

 it('only APP_ADMIN can use it - the API cannot be used to skip the permission, and the database does not trust the caller either',async()=>{
  for(const user of [lab,nurse,approver])await expect(saveSystemSetting(db,user,'general',{...SETTINGS.general.default,systemName:'ไม่ควรบันทึกได้'})).rejects.toThrow('FORBIDDEN');
  expect((await active('general'))?.systemName).not.toBe('ไม่ควรบันทึกได้');
  // a Validated integration revision written straight into the table by a non-administrator cannot be activated without the checker
  const value=JSON.stringify(inbound({enabled:true,basePath:'D:\\NotAdmin'}));
  const id=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,test_passed,previous_revision_id)
   VALUES('his_inbound',9,'HIS Inbound','INTEGRATION',$1,'Validated',$2,'x',true,(SELECT revision_id FROM setting_active WHERE setting_key='his_inbound')) RETURNING id`,[value,lab.id])).rows[0].id;
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('his_inbound',$1) ON CONFLICT(setting_key) DO UPDATE SET revision_id=excluded.revision_id",[id])).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  // an administrator whose assignment has expired loses the same authority in the database
  await db.query("UPDATE role_assignment SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[admin.id]);
  const stale=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,test_passed,previous_revision_id)
   VALUES('his_inbound',10,'HIS Inbound','INTEGRATION',$1,'Validated',$2,'x',true,(SELECT revision_id FROM setting_active WHERE setting_key='his_inbound')) RETURNING id`,[value,admin.id])).rows[0].id;
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('his_inbound',$1) ON CONFLICT(setting_key) DO UPDATE SET revision_id=excluded.revision_id",[stale])).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  await db.query("UPDATE role_assignment SET expires_at=NULL WHERE user_id=$1",[admin.id]);
 });

 it('clinical, consent, release and result rules keep their own approval; production authorisation of HIS outbound cannot be switched on by a direct save',async()=>{
  expect(ADMIN_DIRECT_KEYS).toEqual(['general','security','notifications','report_output','his_inbound','his_outbound','laboratory']);
  for(const key of ['request_consent','doctor_registry','result_management','historical_backfill','report_interpretation','go_live_cutoff','storage_backup'])expect(isAdminDirectKey(key)).toBe(false);
  await expect(saveSystemSetting(db,admin,'report_interpretation',{...SETTINGS.report_interpretation.default,interpretationApproved:true})).rejects.toThrow('SETTING_REQUIRES_APPROVAL');
  await expect(saveSystemSetting(db,admin,'request_consent',{...SETTINGS.request_consent.default,mode:'ELECTRONIC'})).rejects.toThrow('SETTING_REQUIRES_APPROVAL');
  await expect(saveSystemSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,productionAuthorized:true})).rejects.toThrow('PRODUCTION_AUTHORIZATION_REQUIRES_APPROVAL');
  // the database says the same even for a hand-written revision authored by an administrator
  const prod=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,test_passed)
   VALUES('his_outbound',(SELECT COALESCE(max(version),0)+1 FROM settings_revision WHERE setting_key='his_outbound'),'HIS Outbound/CFS','INTEGRATION',$1,'Validated',$2,'x',true) RETURNING id`,[JSON.stringify({...SETTINGS.his_outbound.default,productionAuthorized:true}),admin.id])).rows[0].id;
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('his_outbound',$1)",[prod])).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  const ri=(await db.query<{id:string}>(`INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,reason,test_passed)
   VALUES('report_interpretation',1,'Result Management','CLINICAL',$1,'Validated',$2,'x',true) RETURNING id`,[JSON.stringify(SETTINGS.report_interpretation.default),admin.id])).rows[0].id;
  await expect(db.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('report_interpretation',$1)",[ri])).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  // other HIS outbound fields (enable the export, retry limits) are plain system configuration
  expect(await saveSystemSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,retryLimit:4})).toMatchObject({saved:true,active:true});
  // the controlled laboratory template/formula versions stay read-only
  await expect(saveSystemSetting(db,admin,'laboratory',{...SETTINGS.laboratory.default,templateVersion:'changed'})).rejects.toThrow('CONTROLLED_METADATA_READ_ONLY');
 });

 it('a folder that cannot be used refuses the save with its real code and changes nothing; a usable one is Active at once',async()=>{
  const before=await active('his_outbound');
  const bad=async()=>{throw Error('SHARE_PERMISSION_DENIED');};
  await expect(saveSystemSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,resDestinationPath:'D:\\HIS\\Out',pdfDestinationPath:'D:\\HIS\\Pdf',backupPath:'D:\\HIS\\Bak'},{check:bad})).rejects.toThrow('SHARE_PERMISSION_DENIED');
  expect(await active('his_outbound')).toEqual(before);
  let checked=0;
  const ok=async()=>{checked++;};
  const r=await saveSystemSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,retryLimit:4,resDestinationPath:'D:\\HIS\\Out',pdfDestinationPath:'D:\\HIS\\Pdf',backupPath:'D:\\HIS\\Bak'},{check:ok});
  expect(r.saved).toBe(true);expect(checked).toBe(1);
  expect(await active('his_outbound')).toMatchObject({resDestinationPath:'D:\\HIS\\Out',pdfDestinationPath:'D:\\HIS\\Pdf',backupPath:'D:\\HIS\\Bak'});
  // no path field changed -> no folder check (toggling a switch must not depend on a share being reachable)
  await saveSystemSetting(db,admin,'his_outbound',{...SETTINGS.his_outbound.default,retryLimit:5,resDestinationPath:'D:\\HIS\\Out',pdfDestinationPath:'D:\\HIS\\Pdf',backupPath:'D:\\HIS\\Bak'},{check:ok});
  expect(checked).toBe(1);
 });

 it('HIS folders: save checks and activates in one step, keeps the other settings, refuses unusable result-PDF folders, and the active inbound path is never reset to a default',async()=>{
  const inboundBefore=await active('his_inbound');
  const checks:string[]=[];
  const deps={resultFolderValid:async(p:string)=>!p.includes('missing'),check:async(key:'his_inbound'|'his_outbound')=>{checks.push(key);}};
  const r=await saveHisPaths(db,admin,{paths:{res:'D:\\HIS\\Out2',externalPdf:'D:\\HIS\\External'}},deps);
  expect(r.saved.map(s=>s.key).sort()).toEqual(['his_outbound','result_management']);expect(checks).toEqual(['his_outbound']);
  expect(await active('his_inbound')).toEqual(inboundBefore);                                       // PET path/enabled untouched
  expect(await active('his_outbound')).toMatchObject({resDestinationPath:'D:\\HIS\\Out2',pdfDestinationPath:'D:\\HIS\\Pdf',retryLimit:5});
  expect(await active('result_management')).toMatchObject({pdfSourcePath:'D:\\HIS\\External'});
  await expect(saveHisPaths(db,admin,{paths:{externalPdf:'D:\\missing'}},deps)).rejects.toThrow('RESULT_FOLDER_NOT_ACCESSIBLE');
  expect(await active('result_management')).toMatchObject({pdfSourcePath:'D:\\HIS\\External'});
  await expect(saveHisPaths(db,admin,{paths:{}},deps)).rejects.toThrow('HIS_PATH_UNCHANGED');
  await expect(saveHisPaths(db,lab,{paths:{pet:'D:\\HIS\\Other'}},deps)).rejects.toThrow('FORBIDDEN');
  const overview=await hisPathOverview(db,admin) as {keys:Record<string,{paths:Record<string,string>;pending:unknown}>};
  expect(overview.keys.his_inbound.paths.pet).toBe('D:\\HIS\\Request');expect(overview.keys.his_outbound.pending).toBeNull();
 });

 it('first-scan scope reports what will be read and never fails the preview when the folder is unreachable',async()=>{
  const scope=await inboundScanScope(db,inbound({enabled:true,basePath:'D:\\HIS\\Request',lookbackDays:7}),async()=>({passed:true,dayFolders:7,petFiles:431,pairedPetFiles:431,sampleParse:'PASSED',errorCode:null}));
  expect(scope).toMatchObject({lookbackDays:7,pairedPetFiles:431,dayFolders:7,accessible:true,alreadyEnabled:false,errorCode:null});
  const down=await inboundScanScope(db,inbound({enabled:true}),async()=>{throw Error('SHARE_PATH_NOT_FOUND');});
  expect(down).toMatchObject({accessible:false,errorCode:'SHARE_PATH_NOT_FOUND',pairedPetFiles:null});
 });

 it('a queued settings test for a superseded revision finishes with a plain result instead of leaving a sticky worker error',async()=>{
  const id=(await db.query<{id:string;version:number}>("SELECT id,version FROM settings_revision WHERE setting_key='his_inbound' AND state='Archived' LIMIT 1")).rows[0];
  const report=await runHisSettingsTest(db,{revisionId:id.id,version:id.version,active:false});
  expect(report).toMatchObject({passed:false,errorCode:'HIS_CONFIGURATION_CHANGED',superseded:true});
 });
});
