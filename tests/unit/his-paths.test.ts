import {it,expect,afterEach,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {openAuthorizedDirectory,shareError,workerServiceAccount,isWithinShareRoot} from '../../packages/integrations/authorized-share';
import {SETTINGS} from '../../packages/settings/catalog';
import {openInboundSource} from '../../packages/inbound/source';
import {testInboundConnection} from '../../packages/inbound/connection-test';
import {lookbackFolders} from '../../packages/inbound/discovery';
import {testResultFolder,scanResultFolder} from '../../packages/results/folder';
const cleanup:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const p of cleanup.splice(0))await fs.rm(p,{recursive:true,force:true});});
async function setup(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-his-'));cleanup.push(root);const folder=path.join(root,'inbound');await fs.mkdir(folder);await fs.writeFile(path.join(root,'.nipt-authorized-test-root'),'NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1\n');const policy=path.join(root,'policy.json');await fs.writeFile(policy,JSON.stringify({version:1,grants:[{root,purposes:['INBOUND','OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null}]}));vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',policy);return {root,folder,policy};}
it('reads an explicitly allowed local test directory and refuses traversal, siblings and linked files',async()=>{
 const {root,folder}=await setup();const d=await openAuthorizedDirectory(folder,'INBOUND',null);await fs.writeFile(path.join(folder,'sample.pet'),'SYNTHETIC');expect(await fs.readFile(await d.file('sample.pet'),'utf8')).toBe('SYNTHETIC');await expect(d.file('../policy.json')).rejects.toThrow('UNSAFE_SHARE_PATH');await expect(openAuthorizedDirectory(root+'-other','INBOUND',null)).rejects.toThrow('SHARE_ROOT_NOT_ALLOWED');await fs.link(path.join(folder,'sample.pet'),path.join(folder,'twin.pet'));await expect(d.file('twin.pet')).rejects.toThrow('SHARE_LINK_PROHIBITED');
});
it('rechecks deployment authorization, service identity and secret reference for every operation',async()=>{
 const {folder,policy}=await setup();await expect(openAuthorizedDirectory(folder,'INBOUND','00000000-0000-4000-8000-000000000001')).rejects.toThrow('SHARE_CREDENTIAL_REFERENCE_MISMATCH');const d=await openAuthorizedDirectory(folder,'INBOUND',null);const p=JSON.parse(await fs.readFile(policy,'utf8'));p.grants[0].serviceAccount='wrong-account';await fs.writeFile(policy,JSON.stringify(p));await expect(d.file('sample.pet')).rejects.toThrow('SHARE_SERVICE_ACCOUNT_MISMATCH');
});
it('operational paths require an explicit operational policy grant and no test marker on a hospital share (IT lockdown: NIPT_HIS_SHARE_POLICY_ENFORCE=1)',async()=>{
 const {root,folder,policy}=await setup();vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','1');
 await expect(openAuthorizedDirectory(folder,'INBOUND',null)).rejects.toThrow('SHARE_MODE_NOT_ALLOWED');
 const p=JSON.parse(await fs.readFile(policy,'utf8'));p.grants[0].mode='operational';await fs.writeFile(policy,JSON.stringify(p));
 await fs.unlink(path.join(root,'.nipt-authorized-test-root'));
 const d=await openAuthorizedDirectory(folder,'INBOUND',null);
 await expect(d.file('probe',true)).rejects.toThrow('INBOUND_READ_ONLY');
 expect(d.base).toBe(folder);
});
it('OWNER-LAB-055/059 operational default: the folder an Admin saves in Settings is authorized without any policy file; unsafe targets are still refused',async()=>{
 const {folder}=await setup();vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE','');
 const d=await openAuthorizedDirectory(folder,'INBOUND',null);
 await fs.writeFile(path.join(folder,'a.pet'),'X');expect(await fs.readFile(await d.file('a.pet'),'utf8')).toBe('X');
 await expect(d.file('probe',true)).rejects.toThrow('INBOUND_READ_ONLY');                                   // PET root stays read-only
 const out=await openAuthorizedDirectory(folder,'OUTBOUND',null);                                            // RES/CFS/backup destinations are writable
 expect((await out.file('x.res',true)).endsWith('x.res')).toBe(true);
 await expect(openAuthorizedDirectory(path.join(folder,'missing'),'INBOUND',null)).rejects.toThrow(/SHARE_PATH_NOT_FOUND|ENOENT/);
 await expect(openAuthorizedDirectory('relative/folder','INBOUND',null)).rejects.toThrow('UNSAFE_SHARE_PATH');
 if(process.platform==='win32'){await expect(openAuthorizedDirectory(process.env.SystemRoot!,'OUTBOUND',null)).rejects.toThrow('SHARE_SYSTEM_PATH_PROHIBITED');
  const store=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-store-'));cleanup.push(store);vi.stubEnv('FILE_STORE_ROOT',store);
  await expect(openAuthorizedDirectory(store,'OUTBOUND',null)).rejects.toThrow('SHARE_SYSTEM_PATH_PROHIBITED');}
 vi.stubEnv('NIPT_MODE','production');await expect(openAuthorizedDirectory(folder,'INBOUND',null)).rejects.toThrow('HIS_SYNTHETIC_ONLY');
});
it('requires synthetic environment and marker; surfaces OS permission/path errors without raw paths',async()=>{
 const {root,folder}=await setup();await fs.unlink(path.join(root,'.nipt-authorized-test-root'));await expect(openAuthorizedDirectory(folder,'OUTBOUND',null)).rejects.toThrow('SHARE_TEST_MARKER_REQUIRED');vi.stubEnv('NIPT_MODE','production');await expect(openAuthorizedDirectory(folder,'INBOUND',null)).rejects.toThrow('HIS_SYNTHETIC_ONLY');expect(shareError(Object.assign(Error('private path'),{code:'EACCES'}))).toBe('SHARE_PERMISSION_DENIED');expect(shareError(Object.assign(Error('private path'),{code:'ENOENT'}))).toBe('SHARE_PATH_NOT_FOUND');
});
it('operational result folders use a separate read-only grant and hash actual nested PDFs (IT lockdown)',async()=>{
 const {folder,policy}=await setup();vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('NIPT_HIS_SHARE_POLICY_ENFORCE','1');
 expect((await testResultFolder('',folder,{recursive:true,maxFiles:10})).passed).toBe(false);
 const p=JSON.parse(await fs.readFile(policy,'utf8'));p.grants[0].mode='operational';p.grants[0].purposes=['RESULTS'];await fs.writeFile(policy,JSON.stringify(p));
 await fs.mkdir(path.join(folder,'nested'));await fs.writeFile(path.join(folder,'nested','report.pdf'),'%PDF-test');
 expect(await testResultFolder('',folder,{recursive:true,maxFiles:10})).toMatchObject({passed:true,files:1,folders:1});
 const db={query:async()=>({rows:[]})};const scan=await scanResultFolder(db,'',folder,{recursive:true,maxFiles:10,maxBytes:100,acceptZip:true});
 expect(scan.files[0]).toMatchObject({path:'nested/report.pdf',status:'NEW'});expect(scan.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
 const share=await openAuthorizedDirectory(folder,'RESULTS',null);await expect(share.file('new/sub/report.pdf',true)).rejects.toThrow('INBOUND_READ_ONLY');
 await expect(openAuthorizedDirectory(folder,'INBOUND',null)).rejects.toThrow('SHARE_ROOT_NOT_ALLOWED');
});
it('outbound settings retain old revisions and expose all transport fields without clinical authority',()=>{
 const s=SETTINGS.his_outbound.schema.parse(SETTINGS.his_outbound.default);expect(s).toMatchObject({resDestinationPath:'simulator/p6/res',pdfDestinationPath:'simulator/p6/cfs',backupPath:'simulator/p6/backup',secretRef:null,retryDelaySeconds:5,confirmationTimeoutSeconds:300,productionAuthorized:false,resProfile:null});expect(SETTINGS.his_outbound.schema.parse({...s,productionAuthorized:true}).productionAuthorized).toBe(true);
});
it.skipIf(process.platform!=='win32')('actual Windows file ACL denial surfaces as a file access failure and is restored',async()=>{
 const {folder}=await setup(),file=path.join(folder,'denied.pet'),user=os.userInfo().username;await fs.writeFile(file,'SYNTHETIC');const d=await openAuthorizedDirectory(folder,'INBOUND',null);
 try{execFileSync('icacls',[file,'/deny',user+':(R)'],{windowsHide:true,stdio:'pipe'});await expect((async()=>fs.readFile(await d.file('denied.pet')))().catch(e=>{throw Error(shareError(e));})).rejects.toThrow('SHARE_PERMISSION_DENIED');}
 finally{execFileSync('icacls',[file,'/remove:d',user],{windowsHide:true,stdio:'pipe'});}
 expect(await fs.readFile(file,'utf8')).toBe('SYNTHETIC');
});
it('a named PET/OK pair without a successfully parsed synthetic sample cannot validate Settings',async()=>{
 const {folder}=await setup(),day=lookbackFolders(1,new Date())[0],dir=path.join(folder,day);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'99000812-7.pet'),'MALFORMED');await fs.writeFile(path.join(dir,'99000812-7.ok'),'');const source=await openInboundSource(folder,null);const r=await testInboundConnection(folder,{lookbackDays:1,source});expect(r.sampleParse).toBe('NO_SAMPLE');expect(r.passed).toBe(false);
 await fs.unlink(path.join(dir,'99000812-7.ok'));await fs.mkdir(path.join(dir,'99000812-7.ok'));expect(await testInboundConnection(folder,{source})).toMatchObject({passed:false,errorCode:'SHARE_NOT_FILE'});
});
it('junction escape is refused without reading outside the authorized root',async()=>{
 const {root,folder}=await setup(),outside=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-his-outside-'));cleanup.push(outside);await fs.writeFile(path.join(outside,'outside.pet'),'SYNTHETIC');await fs.symlink(outside,path.join(folder,'escape'),process.platform==='win32'?'junction':'dir');const d=await openAuthorizedDirectory(root,'INBOUND',null);await expect(d.file('inbound/escape/outside.pet')).rejects.toThrow('SHARE_LINK_PROHIBITED');
});
it.skipIf(process.platform!=='win32')('UNC and drive-root containment accepts descendants and refuses sibling prefixes without contacting a server',()=>{
 expect(isWithinShareRoot('\\\\test-server\\share\\','\\\\test-server\\share\\inbound')).toBe(true);expect(isWithinShareRoot('\\\\test-server\\share\\','\\\\test-server\\share-other\\inbound')).toBe(false);expect(isWithinShareRoot('D:\\','D:\\synthetic')).toBe(true);expect(isWithinShareRoot('D:\\synthetic','D:\\synthetic-other')).toBe(false);
});
