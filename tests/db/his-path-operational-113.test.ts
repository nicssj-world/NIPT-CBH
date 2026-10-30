import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import type {Principal} from '../../packages/security/policy';
import {saveHisPaths,hisPathOverview} from '../../packages/settings/his-paths';
import {checkHisSetting} from '../../packages/settings/his-check';
import {resultFolderSettingValid} from '../../packages/results/folder';
import {readActiveSettings} from '../../packages/settings/service';

let db:PGlite,admin:Principal,lab:Principal,root:string;
const dirs:Record<'pet'|'res'|'cfsPdf'|'backup'|'externalPdf',string>={} as never;
const deps={resultFolderValid:(directory:string)=>resultFolderSettingValid('unused',directory),check:checkHisSetting};
const active=async(key:string)=>(await readActiveSettings(db))[key] as Record<string,unknown>|undefined;
const revisionCount=async()=>Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM settings_revision WHERE setting_key='his_outbound'")).rows[0].n);
beforeAll(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-113-path-'));
 for(const key of ['pet','res','cfsPdf','backup','externalPdf'] as const){
  dirs[key]=path.join(root,key);await fs.mkdir(dirs[key]);
 }
 vi.stubEnv('NIPT_MODE','operational');
 vi.stubEnv('APP_ORIGIN','https://nipt-cbh');
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','0');
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE','');
 db=await testDatabase();
 admin=await addUser(db,'APP_ADMIN','synthetic.path.integration.admin');
 lab=await addUser(db,'LAB_STAFF','synthetic.path.integration.lab');
});
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();if(root)await fs.rm(root,{recursive:true,force:true});});
it('P0 actual Save route service: backup-only succeeds even when RES and CFS were never configured on this host',async()=>{
 const prev=await active('his_outbound');const c=await revisionCount();
 const saved=await saveHisPaths(db,admin,{paths:{backup:dirs.backup}},deps);
 expect(saved.saved).toEqual([{key:'his_outbound',version:c+1}]);
 const now=await active('his_outbound');
 expect(now?.backupPath).toBe(dirs.backup);
 expect(now?.resDestinationPath).toBe(prev?.resDestinationPath??'simulator/p6/res');
 expect(now?.pdfDestinationPath).toBe(prev?.pdfDestinationPath??'simulator/p6/cfs');
 expect(await revisionCount()).toBe(c+1);
 expect((await fs.readdir(dirs.backup)).filter(x=>x.startsWith('.nipt-connection-probe-'))).toEqual([]);
 const overview=await hisPathOverview(db,admin);
 expect((overview.keys.his_outbound as {paths:{backup:string}}).paths.backup).toBe(dirs.backup);
});
it('P0 RES and CFS can each be saved independently; a failed changed path leaves active revision unchanged',async()=>{
 const old=await active('his_outbound');
 const prev=await revisionCount();
 const missing=path.join(root,'does-not-exist');
 await expect(saveHisPaths(db,admin,{paths:{res:missing}},deps)).rejects.toMatchObject({message:'SHARE_PATH_NOT_FOUND',pathType:'RES'});
 expect(await revisionCount()).toBe(prev);
 expect(await active('his_outbound')).toEqual(old);
 await saveHisPaths(db,admin,{paths:{res:dirs.res}},deps);
 expect((await active('his_outbound'))?.resDestinationPath).toBe(dirs.res);
 await saveHisPaths(db,admin,{paths:{cfsPdf:dirs.cfsPdf}},deps);
 const now=await active('his_outbound');
 expect(now?.resDestinationPath).toBe(dirs.res);
 expect(now?.pdfDestinationPath).toBe(dirs.cfsPdf);
 expect(now?.backupPath).toBe(dirs.backup);
 await expect(checkHisSetting('his_outbound',now!)).resolves.toBeUndefined();
 for(const d of [dirs.res,dirs.cfsPdf,dirs.backup])expect(await fs.readdir(d)).toEqual([]);
});
it('P0 PET inbound existing empty folder is accepted without inventing a .pet or .ok',async()=>{
 await saveHisPaths(db,admin,{paths:{pet:dirs.pet}},deps);
 expect((await active('his_inbound'))?.basePath).toBe(dirs.pet);
});
it('P0 external ReadyGen PDF path can be saved and the folder is readable',async()=>{
 expect(await resultFolderSettingValid('unused',dirs.externalPdf)).toBe(true);
 await saveHisPaths(db,admin,{paths:{externalPdf:dirs.externalPdf}},deps);
 expect((await active('result_management'))?.pdfSourcePath).toBe(dirs.externalPdf);
});
it('P0 a non-admin cannot change HIS paths and direct save preserves full outbound validation',async()=>{
 await expect(saveHisPaths(db,lab,{paths:{backup:dirs.backup+'2'}},deps)).rejects.toThrow('FORBIDDEN');
 const now=(await active('his_outbound'))!;
 await expect(checkHisSetting('his_outbound',{...now,resDestinationPath:path.join(root,'missing-res')})).rejects.toMatchObject({pathType:'RES'});
 const logs=(await db.query<{action:string;details:Record<string,unknown>}>("SELECT action,details FROM audit_chain WHERE action='SETTING_SAVED_ACTIVE'")).rows;
 expect(logs.length).toBeGreaterThanOrEqual(5);
 expect(JSON.stringify(logs)).not.toContain(root);
});
