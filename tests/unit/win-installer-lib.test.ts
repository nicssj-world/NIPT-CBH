import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
 parseVersion,compareVersions,layout,validateConfig,assertSafeRoot,directoryHashes,verifyPackage,schemaCompatibility,canRollbackApplicationOnly,
 healthVerdict,backoffMs,parseLedgerOutput,sha256Bytes,INSTALLER_FORMAT,writeJson,readJson,portFree
} from '../../tools/win-installer/lib.mjs';

// The Windows installer's decisions that must never depend on a live machine: version order, configuration limits, package authenticity,
// schema-compatibility gates for upgrade/rollback and what counts as healthy.
let dir:string;
beforeAll(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'nipt-win-lib-'));});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});

const goodConfig=()=>({instance:'nipt-test',mode:'operational',database:'nipt_operational_nipt_test',ports:{postgres:19850,web:19851,https:19852,renderer:19853},origin:'https://localhost:19852',taskMode:'user',testEnvironmentOnly:true});

describe('versions',()=>{
 it('orders releases, with a label before the plain release and strict syntax',()=>{
  expect(compareVersions('1.2.3','1.2.3')).toBe(0);
  expect(compareVersions('1.2.3','1.10.0')).toBe(-1);
  expect(compareVersions('2.0.0','1.99.99')).toBe(1);
  expect(compareVersions('1.0.0-rc1','1.0.0')).toBe(-1);
  expect(compareVersions('1.0.0','1.0.0-rc1')).toBe(1);
  for(const bad of ['1.2','v1.2.3','1.2.3.4','','1.2.3-','01x.2.3'])expect(()=>parseVersion(bad),bad).toThrow('VERSION_INVALID');
 });
});

describe('configuration and install root',()=>{
 it('accepts the intended test configuration and nothing looser',()=>{
  expect(validateConfig(goodConfig()).instance).toBe('nipt-test');
  const bad=(patch:Record<string,unknown>,code:string)=>expect(()=>validateConfig({...goodConfig(),...patch}),code).toThrow(code);
  bad({testEnvironmentOnly:false},'CONFIG_TEST_ENVIRONMENT_ONLY_REQUIRED');
  bad({testEnvironmentOnly:undefined},'CONFIG_TEST_ENVIRONMENT_ONLY_REQUIRED');
  bad({instance:'X'},'CONFIG_INSTANCE_INVALID');
  bad({mode:'production'},'CONFIG_MODE_INVALID');
  bad({database:'postgres'},'CONFIG_DATABASE_INVALID');
  bad({database:'nipt_synthetic_x'},'CONFIG_DATABASE_INVALID');       // database name must carry the mode
  bad({ports:{postgres:1,web:1,https:2,renderer:3}},'CONFIG_PORTS_DUPLICATE');
  bad({ports:{postgres:0,web:1,https:2,renderer:3}},'CONFIG_PORT_INVALID');
  bad({ports:{postgres:70000,web:1,https:2,renderer:3}},'CONFIG_PORT_INVALID');
  bad({taskMode:'service'},'CONFIG_TASK_MODE_INVALID');
  bad({origin:'http://localhost:1'},'CONFIG_ORIGIN_INVALID');
  expect(()=>validateConfig(null)).toThrow('CONFIG_INVALID');
 });
 it('refuses a drive root, a root inside the package and a package inside the root',()=>{
  expect(()=>assertSafeRoot('C:\\','D:\\pkg')).toThrow('INSTALL_ROOT_IS_DRIVE_ROOT');
  expect(()=>assertSafeRoot('D:\\pkg\\root','D:\\pkg')).toThrow('INSTALL_ROOT_INSIDE_PACKAGE');
  expect(()=>assertSafeRoot('D:\\install-root','D:\\install-root\\pkg')).toThrow('PACKAGE_INSIDE_INSTALL_ROOT');
  expect(assertSafeRoot('D:\\NIPT-CBH','D:\\media\\pkg')).toBe(path.resolve('D:\\NIPT-CBH'));
 });
 it('derives every owned path from one root',()=>{
  const L=layout('D:\\NIPT-CBH');
  for(const [k,v] of Object.entries(L))expect(v.startsWith(path.resolve('D:\\NIPT-CBH')),k).toBe(true);
  expect(L.node).toMatch(/runtime[\\/]node[\\/]node\.exe$/);expect(L.secrets).not.toBe(L.config);
 });
 it('detects a port that is already in use',async()=>{
  const net=await import('node:net');const s=net.createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));
  const port=(s.address() as import('node:net').AddressInfo).port;
  try{expect(await portFree(port)).toBe(false);}finally{await new Promise(r=>s.close(r));}
  expect(await portFree(port)).toBe(true);
 });
});

describe('package authenticity',()=>{
 const keys=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const other=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 let n=0;
 async function makePackage(mutate?:(root:string)=>Promise<void>,manifestPatch:Record<string,unknown>={}){
  const root=path.join(dir,'pkg'+(n++));await mkdir(path.join(root,'payload','release'),{recursive:true});await mkdir(path.join(root,'installer'));
  await writeFile(path.join(root,'payload','release','a.txt'),'alpha');await writeFile(path.join(root,'installer','nipt-admin.mjs'),'// admin');
  const files=await directoryHashes(root);
  const manifest={format:INSTALLER_FORMAT,version:'1.0.0',revision:'a'.repeat(40),migrationsSha256:'b'.repeat(64),testEnvironmentOnly:true,runtimeIncluded:false,files,...manifestPatch};
  const raw=Buffer.from(JSON.stringify(manifest));await writeFile(path.join(root,'manifest.json'),raw);await writeFile(path.join(root,'manifest.sig'),sign(null,raw,keys.privateKey));
  if(mutate)await mutate(root);return root;
 }
 const pub=()=>{const f=path.join(dir,'pub.pem');return writeFile(f,keys.publicKey).then(()=>f);};
 it('verifies an untouched package',async()=>{expect((await verifyPackage(await makePackage(),await pub())).version).toBe('1.0.0');});
 it('rejects a changed file, an added file, a removed file and a wrong key',async()=>{
  const key=await pub();
  await expect(verifyPackage(await makePackage(r=>writeFile(path.join(r,'payload','release','a.txt'),'ALPHA')),key)).rejects.toThrow('PACKAGE_CHECKSUM_MISMATCH');
  await expect(verifyPackage(await makePackage(r=>writeFile(path.join(r,'payload','release','extra.txt'),'x')),key)).rejects.toThrow('PACKAGE_FILESET_MISMATCH');
  await expect(verifyPackage(await makePackage(r=>rm(path.join(r,'payload','release','a.txt'))),key)).rejects.toThrow('PACKAGE_FILESET_MISMATCH');
  const otherKey=path.join(dir,'other.pem');await writeFile(otherKey,other.publicKey);
  await expect(verifyPackage(await makePackage(),otherKey)).rejects.toThrow('SIGNATURE_INVALID');
 });
 it('rejects a tampered manifest even when the file hashes still match',async()=>{
  const key=await pub();
  const root=await makePackage();const m=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root,'manifest.json'),'utf8'));
  m.version='9.9.9';await writeFile(path.join(root,'manifest.json'),JSON.stringify(m));
  await expect(verifyPackage(root,key)).rejects.toThrow('SIGNATURE_INVALID');
 });
 it('requires the test-environment flag, provenance, a valid version and safe relative paths',async()=>{
  const key=await pub();
  await expect(verifyPackage(await makePackage(undefined,{testEnvironmentOnly:false}),key)).rejects.toThrow('PACKAGE_MANIFEST_INVALID');
  await expect(verifyPackage(await makePackage(undefined,{format:'OTHER'}),key)).rejects.toThrow('PACKAGE_MANIFEST_INVALID');
  await expect(verifyPackage(await makePackage(undefined,{revision:'abc'}),key)).rejects.toThrow('PACKAGE_PROVENANCE_REQUIRED');
  await expect(verifyPackage(await makePackage(undefined,{version:'latest'}),key)).rejects.toThrow('VERSION_INVALID');
  await expect(verifyPackage(await makePackage(undefined,{files:{'../evil':'0'.repeat(64)}}),key)).rejects.toThrow('PACKAGE_UNSAFE_PATH');
 });
 it('refuses a symbolic link inside the package',async()=>{
  const key=await pub();
  const root=await makePackage();
  try{await symlink(path.join(root,'payload','release','a.txt'),path.join(root,'payload','release','link.txt'));}catch{return;} // symlink creation needs a privilege on some Windows hosts
  await expect(verifyPackage(root,key)).rejects.toThrow('PACKAGE_SYMLINK');
 });
});

describe('schema compatibility gates',()=>{
 const rel={'001_a.sql':'h1','002_b.sql':'h2','003_c.sql':'h3'};
 const row=(name:string,checksum:string)=>({name,checksum});
 it('reports pending migrations for an upgrade and refuses a database that knows more or differently',()=>{
  expect(schemaCompatibility({ledger:[row('001_a.sql','h1')],releaseMigrations:rel})).toMatchObject({compatibleWithDatabase:true,pending:['002_b.sql','003_c.sql']});
  expect(schemaCompatibility({ledger:[row('001_a.sql','h1'),row('009_new.sql','x')],releaseMigrations:rel})).toMatchObject({compatibleWithDatabase:false,unknown:['009_new.sql']});
  expect(schemaCompatibility({ledger:[row('001_a.sql','CHANGED')],releaseMigrations:rel})).toMatchObject({compatibleWithDatabase:false,changed:['001_a.sql']});
 });
 it('allows an application-only rollback only when the database is not newer than the target release',()=>{
  const ledger=[row('001_a.sql','h1'),row('002_b.sql','h2')];
  expect(canRollbackApplicationOnly({ledger,targetMigrations:rel}).ok).toBe(true);                       // target knows everything applied (and one more)
  expect(canRollbackApplicationOnly({ledger,targetMigrations:{'001_a.sql':'h1','002_b.sql':'h2'}}).ok).toBe(true);
  const newer=canRollbackApplicationOnly({ledger:[...ledger,row('004_d.sql','h4')],targetMigrations:rel});
  expect(newer).toMatchObject({ok:false,reason:'DATABASE_NEWER_THAN_TARGET'});
  expect(canRollbackApplicationOnly({ledger:[row('001_a.sql','OTHER')],targetMigrations:rel})).toMatchObject({ok:false,reason:'MIGRATION_CHECKSUM_DIFFERS'});
 });
});

describe('ledger parsing',()=>{
 it('is not fooled by Windows CRLF line endings (a trailing CR once turned every matching checksum into a mismatch)',()=>{
  const lf=parseLedgerOutput('001_a.sql|h1
002_b.sql|h2
'),crlf=parseLedgerOutput('001_a.sql|h1
002_b.sql|h2
');
  expect(crlf).toEqual(lf);expect(crlf).toEqual([{name:'001_a.sql',checksum:'h1'},{name:'002_b.sql',checksum:'h2'}]);
  expect(schemaCompatibility({ledger:crlf,releaseMigrations:{'001_a.sql':'h1','002_b.sql':'h2'}}).compatibleWithDatabase).toBe(true);
  expect(parseLedgerOutput('')).toEqual([]);expect(parseLedgerOutput('
')).toEqual([]);
 });
});

describe('health verdict and supervisor policy',()=>{
 const healthy={databaseReachable:true,webReachable:true,rendererReachable:true,fileStorageAccessible:true,workerAlive:true,workerError:false,migrationsMatch:true,auditValid:true,rolesRestricted:true,quarantined:false,technicalReady:true,backupStatus:'CHECKSUM_VERIFIED'};
 it('is healthy only when every probe passes; a missing probe fails',()=>{
  expect(healthVerdict(healthy,{supervisor:true,https:true})).toMatchObject({ok:true,failed:[],technicalReady:true});
  for(const [k,v] of Object.entries<boolean>({webReachable:false,rendererReachable:false,workerAlive:false,workerError:true,migrationsMatch:false,auditValid:false,rolesRestricted:false,quarantined:true,databaseReachable:false,fileStorageAccessible:false})){
   expect(healthVerdict({...healthy,[k]:v},{supervisor:true,https:true}).ok,k).toBe(false);
  }
  expect(healthVerdict(healthy,{supervisor:false,https:true}).failed).toEqual(['supervisor']);
  expect(healthVerdict(healthy,{supervisor:true,https:false}).failed).toEqual(['https']);
  expect(healthVerdict({},{}).ok).toBe(false);expect(healthVerdict(undefined,undefined).ok).toBe(false);
 });
 it('keeps services healthy before the first backup but does not call them technically ready',()=>{
  const v=healthVerdict({...healthy,technicalReady:false,backupStatus:'NOT_CONFIGURED'},{supervisor:true,https:true});
  expect(v).toMatchObject({ok:true,technicalReady:false,backupStatus:'NOT_CONFIGURED'});
 });
 it('restarts a crashing service with a bounded backoff',()=>{
  expect([0,1,2,3,4,5,6,20].map(backoffMs)).toEqual([1000,2000,4000,8000,16000,30000,30000,30000]);
 });
});

describe('state files',()=>{
 it('writes JSON atomically and reads a fallback for a missing file',async()=>{
  const f=path.join(dir,'state','x.json');
  expect(await readJson(f,{none:true})).toEqual({none:true});
  await writeJson(f,{a:1});expect(await readJson(f)).toEqual({a:1});
  await expect(readJson(path.join(dir,'missing.json'))).rejects.toThrow();
  expect(sha256Bytes(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 });
});
