import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {PGlite} from '@electric-sql/pglite';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import type {Principal} from '../../packages/security/policy';
import {readActiveSettings} from '../../packages/settings/service';

const state=vi.hoisted(()=>({db:null as unknown,user:null as unknown}));
vi.mock('../../src/server/http',async(importOriginal)=>{
 const original=await importOriginal<typeof import('../../src/server/http')>();
 return {...original,protect:async()=>state.user,readJson:async(r:Request)=>r.json()};
});
vi.mock('../../packages/db/connection',async(importOriginal)=>{
 const original=await importOriginal<typeof import('../../packages/db/connection')>();
 return {...original,pool:()=>state.db,withTransaction:async (fn:(db:PGlite)=>Promise<unknown>)=>(state.db as PGlite).transaction(async db=>fn(db as unknown as PGlite))};
});
import {GET,POST} from '../../src/app/api/settings/his-paths/route';
let db:PGlite,admin:Principal,lab:Principal,root:string;
const post=(paths:Record<string,string>)=>POST(new NextRequest('https://nipt-cbh/api/settings/his-paths',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'save',paths})}));
const get=()=>GET(new NextRequest('https://nipt-cbh/api/settings/his-paths'));
beforeAll(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-p0-api-113-'));
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt-cbh');
 vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','0');
 db=await testDatabase();
 admin=await addUser(db,'APP_ADMIN','synthetic.p0.api.admin');
 lab=await addUser(db,'LAB_STAFF','synthetic.p0.api.lab');
 state.db=db;state.user=admin;
});
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
it('actual HIS API POST/GET: Save Backup only, get Active, preserve untouched RES/CFS',async()=>{
 const dir=path.join(root,'backup');await fs.mkdir(dir);
 const resp=await post({backup:dir});expect(resp.status).toBe(200);
 const value=await resp.json();expect(value.saved).toEqual([{key:'his_outbound',version:1}]);
 const reloaded=await get();expect(reloaded.status).toBe(200);
 const body=await reloaded.json();expect(body.keys.his_outbound.paths.backup).toBe(dir);
 expect(body.keys.his_outbound.paths.res).toBe('simulator/p6/res');
 expect(body.keys.his_outbound.paths.cfsPdf).toBe('simulator/p6/cfs');
 expect(await fs.readdir(dir)).toEqual([]);
});
it('actual HIS API: wrong CFS refuses with labelled 400 and does not change Active',async()=>{
 const invalid=path.join(root,'no-cfs');const before=(await readActiveSettings(db)).his_outbound;
 const resp=await post({cfsPdf:invalid});expect(resp.status).toBe(400);
 const json=await resp.json();
 expect(json).toMatchObject({code:'SHARE_PATH_NOT_FOUND',pathType:'CFS_PDF'});
 expect(json.error).toContain('CFS PDF');
 expect((await readActiveSettings(db)).his_outbound).toEqual(before);
});
it('actual HIS API: RES and CFS save sequentially and return active revision on reload',async()=>{
 for(const [name,key] of [['res','res'],['cfs','cfsPdf']] as const){
  const dir=path.join(root,name);await fs.mkdir(dir);const resp=await post({[key]:dir});
  expect(resp.status).toBe(200);
 }
 const json=await (await get()).json();
 expect(json.keys.his_outbound.paths.res).toBe(path.join(root,'res'));
 expect(json.keys.his_outbound.paths.cfsPdf).toBe(path.join(root,'cfs'));
 expect(json.keys.his_outbound.paths.backup).toBe(path.join(root,'backup'));
});
it('actual HIS API: invalid PET folder returns PET path label without activating',async()=>{
 const before=(await readActiveSettings(db)).his_inbound;
 const resp=await post({pet:path.join(root,'missing-pet')});expect(resp.status).toBe(400);
 const json=await resp.json();
 expect(json).toMatchObject({pathType:'PET'});
 expect(json.error).toContain('PET');
 expect((await readActiveSettings(db)).his_inbound).toEqual(before);
});
it('actual HIS API: valid RES + invalid Backup together atomically refuse both changes',async()=>{
 const before=(await readActiveSettings(db)).his_outbound;
 await fs.mkdir(path.join(root,'res2'));
 const resp=await post({res:path.join(root,'res2'),backup:path.join(root,'missing-backup')});
 expect(resp.status).toBe(400);
 expect((await resp.json()).pathType).toBe('BACKUP');
 expect((await readActiveSettings(db)).his_outbound).toEqual(before);
});
it('actual HIS API: invalid ReadyGen folder cannot activate and leaves previous revision intact',async()=>{
 const before=(await readActiveSettings(db)).result_management;
 const resp=await post({externalPdf:path.join(root,'missing-external')});
 expect(resp.status).toBe(400);
 expect((await resp.json()).code).toBe('RESULT_FOLDER_NOT_ACCESSIBLE');
 expect((await readActiveSettings(db)).result_management).toEqual(before);
});
it('actual HIS API transaction: two setting keys save together or none on failed ReadyGen',async()=>{
 const newPet=path.join(root,'new-pet');await fs.mkdir(newPet);
 const beforeIn=(await readActiveSettings(db)).his_inbound;
 const beforeRes=(await readActiveSettings(db)).result_management;
 const resp=await post({pet:newPet,externalPdf:path.join(root,'missing-final-pdf')});
 expect(resp.status).toBe(400);
 expect((await resp.json()).code).toBe('RESULT_FOLDER_NOT_ACCESSIBLE');
 expect((await readActiveSettings(db)).his_inbound).toEqual(beforeIn);
 expect((await readActiveSettings(db)).result_management).toEqual(beforeRes);
});
it('actual HIS API: unauthorized role cannot save or inspect paths',async()=>{
 state.user=lab;
 expect((await post({backup:path.join(root,'unauthorized')})).status).toBe(403);
 expect((await get()).status).toBe(403);
 state.user=admin;
});
