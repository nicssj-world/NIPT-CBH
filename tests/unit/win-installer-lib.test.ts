import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import os from 'node:os';
import {thaiError,thaiStep,thaiLanWarnings,thaiCheck,THAI_WARNING,STEP_TEXTS,stepIndex,errorKey,warningKey,pascalTables} from '../../tools/win-installer/setup-messages.mjs';
import path from 'node:path';
import {
 parseVersion,compareVersions,layout,validateConfig,assertSafeRoot,directoryHashes,verifyPackage,schemaCompatibility,canRollbackApplicationOnly,
 healthVerdict,classifyUpgradeHealthOutcome,recordedProcessState,backoffMs,parseLedgerOutput,isValidHost,isIPv4,originFor,sanEntries,sanText,normalizeLanAllow,normalizeLanProfiles,pickLanAddress,sha256Bytes,INSTALLER_FORMAT,writeJson,readJson,portFree
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
  bad({httpsHost:'localhost'},'CONFIG_HTTPS_HOST_INVALID');
  expect(validateConfig({...goodConfig(),httpsHost:'0.0.0.0'}).httpsHost).toBe('0.0.0.0');
  expect(validateConfig({...goodConfig(),httpsHost:'10.20.30.40'}).httpsHost).toBe('10.20.30.40');
  bad({excelMode:'service'},'CONFIG_EXCEL_MODE_INVALID');
  bad({taskMode:'system',excelMode:'direct'},'CONFIG_SYSTEM_TASK_REQUIRES_EXCEL_BRIDGE'); // Excel automation is unsupported in session 0
  expect(validateConfig({...goodConfig(),taskMode:'system'}).taskMode).toBe('system');            // excelMode defaults to the bridge for a SYSTEM task
  expect(validateConfig({...goodConfig(),taskMode:'system',excelMode:'bridge'}).excelMode).toBe('bridge');
  expect(validateConfig({...goodConfig(),taskMode:'user',excelMode:'direct'}).excelMode).toBe('direct');
  expect(()=>validateConfig(null)).toThrow('CONFIG_INVALID');
 });
 it('refuses a drive root, a root inside the package and a package inside the root',()=>{
  expect(()=>assertSafeRoot('C:\\','D:\\pkg')).toThrow('INSTALL_ROOT_IS_DRIVE_ROOT');
  expect(()=>assertSafeRoot('D:\\pkg\\root','D:\\pkg')).toThrow('INSTALL_ROOT_INSIDE_PACKAGE');
  expect(()=>assertSafeRoot('D:\\install-root','D:\\install-root\\pkg')).toThrow('PACKAGE_INSIDE_INSTALL_ROOT');
  expect(()=>assertSafeRoot('D:\\โรงพยาบาล\\NIPT','D:\\media\\pkg')).toThrow('INSTALL_ROOT_MUST_BE_ASCII'); // PostgreSQL on Windows cannot start from it
  expect(assertSafeRoot('D:\\NIPT-CBH','D:\\media\\pkg')).toBe(path.resolve('D:\\NIPT-CBH'));
  expect(assertSafeRoot('D:\\Program Files\\NIPT CBH','D:\\media\\pkg')).toBe(path.resolve('D:\\Program Files\\NIPT CBH')); // spaces are fine
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
  const LF=String.fromCharCode(10),CRLF=String.fromCharCode(13,10);
  const rows=['001_a.sql|h1','002_b.sql|h2'];
  const lf=parseLedgerOutput(rows.join(LF)+LF),crlf=parseLedgerOutput(rows.join(CRLF)+CRLF);
  expect(crlf).toEqual(lf);expect(crlf).toEqual([{name:'001_a.sql',checksum:'h1'},{name:'002_b.sql',checksum:'h2'}]);
  expect(schemaCompatibility({ledger:crlf,releaseMigrations:{'001_a.sql':'h1','002_b.sql':'h2'}}).compatibleWithDatabase).toBe(true);
  expect(parseLedgerOutput('')).toEqual([]);expect(parseLedgerOutput(CRLF)).toEqual([]);
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
  expect(healthVerdict(healthy,{supervisor:true,https:true,excelBridge:false}).failed).toEqual(['excelBridge']); // bridge mode, bridge down
  expect(healthVerdict(healthy,{supervisor:true,https:true,excelBridge:true}).ok).toBe(true);
  expect(healthVerdict(healthy,{supervisor:true,https:true}).ok).toBe(true);                                    // direct mode: not applicable
  expect(healthVerdict({},{}).ok).toBe(false);expect(healthVerdict(undefined,undefined).ok).toBe(false);
 });
 it('keeps services healthy before the first backup but does not call them technically ready',()=>{
  const v=healthVerdict({...healthy,technicalReady:false,backupStatus:'NOT_CONFIGURED'},{supervisor:true,https:true});
  expect(v).toMatchObject({ok:true,technicalReady:false,backupStatus:'NOT_CONFIGURED'});
 });
 it('classifies health failure by the actual rollback result and verifies Windows Node PIDs against the install root',()=>{
  expect(classifyUpgradeHealthOutcome({rolledBack:true})).toBe('UPGRADE_FAILED_HEALTH');
  expect(classifyUpgradeHealthOutcome({rolledBack:false,error:'ROLLBACK_REQUIRES_DATABASE_RESTORE'})).toBe('UPGRADE_FAILED_HEALTH_RESTORE_REQUIRED');
  expect(classifyUpgradeHealthOutcome({rolledBack:false,error:'NO_PREVIOUS_RELEASE'})).toBe('UPGRADE_FAILED_HEALTH_RECOVERY_REQUIRED');
  const owned={pid:42,alive:true,image:'node.exe',commandLine:'"D:\\NIPT-CBH\\runtime\\node\\node.exe" "D:\\NIPT-CBH\\admin\\supervisor.mjs" --root "D:\\NIPT-CBH"',root:'D:/NIPT-CBH',marker:'supervisor.mjs'};
  expect(recordedProcessState(owned)).toBe('RUNNING');
  expect(recordedProcessState({...owned,commandLine:'node.exe other-app\\supervisor.mjs --root D:\\OTHER'})).toBe('PID_REUSED_OR_UNRELATED');
  expect(recordedProcessState({...owned,alive:false})).toBe('NOT_RUNNING');
  expect(recordedProcessState({...owned,commandLine:undefined})).toBe('UNVERIFIED');
  expect(recordedProcessState({...owned,pid:undefined})).toBe('NOT_RECORDED');
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

describe('hospital LAN access rules',()=>{
 it('accepts an IPv4 address or a DNS name as the published host and nothing that is a URL, port, wildcard or link-local address',()=>{
  for(const ok of ['192.168.1.57','10.20.30.40','nipt.hospital.local','NIPT-SERVER','a.b.c'])expect(isValidHost(ok),ok).toBe(true);
  for(const bad of ['','0.0.0.0','255.255.255.255','169.254.1.1','http://x','x:443','a/b','-bad.com','bad-.com','a..b','300.1.1.1','host name'])expect(isValidHost(bad),bad).toBe(false);
  expect(isIPv4('192.168.1.1')).toBe(true);expect(isIPv4('192.168.1')).toBe(false);
 });
 it('builds the one canonical origin and the certificate names that must contain it',()=>{
  expect(originFor('192.168.1.57',443)).toBe('https://192.168.1.57');expect(originFor('nipt.hospital.local',8443)).toBe('https://nipt.hospital.local:8443');
  const ip=sanEntries('192.168.1.57','NIPT-SRV');expect(ip.map(e=>e.type+':'+e.value)).toEqual(['DNS:localhost','IP:127.0.0.1','IP:192.168.1.57','DNS:NIPT-SRV']);
  const dns=sanEntries('nipt.hospital.local','NIPT-SRV');expect(dns.map(e=>e.type+':'+e.value)).toEqual(['DNS:localhost','IP:127.0.0.1','DNS:nipt.hospital.local','DNS:NIPT-SRV']);
  expect(sanEntries('localhost','x y').map(e=>e.value)).toEqual(['localhost','127.0.0.1']);                    // an invalid computer name is dropped, duplicates collapse
  expect(sanText(ip)).toBe('2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=192.168.1.57&DNS=NIPT-SRV');
 });
 it('restricts the firewall scope to the hospital network and refuses anything open to the world',()=>{
  expect(normalizeLanAllow(undefined)).toBe('LocalSubnet');expect(normalizeLanAllow('localsubnet')).toBe('LocalSubnet');
  expect(normalizeLanAllow('192.168.1.0/24, 10.0.0.0/8, 172.16.5.9, 192.168.2.10-192.168.2.50')).toBe('192.168.1.0/24,10.0.0.0/8,172.16.5.9,192.168.2.10-192.168.2.50');
  expect(normalizeLanAllow('LocalSubnet,LocalSubnet')).toBe('LocalSubnet');
  for(const bad of ['Any','*','0.0.0.0/0','0.0.0.0','Internet','DefaultGateway','192.168.1.0/4','192.168.1.0/33','10.0.0.1-','999.1.1.1','',' , '])expect(()=>normalizeLanAllow(bad),bad).toThrow('LAN_ALLOW_INVALID');
  expect(normalizeLanProfiles(undefined)).toBe('Domain,Private');expect(normalizeLanProfiles('Public,Domain')).toBe('Domain,Public');
  expect(()=>normalizeLanProfiles('Any')).toThrow('LAN_PROFILES_INVALID');expect(()=>normalizeLanProfiles('')).toThrow('LAN_PROFILES_INVALID');
 });
 it('validates the LAN configuration: host and origin agree, LAN needs a real host',()=>{
  const lan={...goodConfig(),host:'192.168.1.57',origin:'https://192.168.1.57:19852',lanEnabled:true,lanAllow:'LocalSubnet',lanProfiles:'Domain,Private',httpsHost:'0.0.0.0'};
  expect(validateConfig(lan).host).toBe('192.168.1.57');
  const bad=(patch:Record<string,unknown>,code:string)=>expect(()=>validateConfig({...lan,...patch}),code).toThrow(code);
  bad({origin:'https://192.168.1.99:19852'},'CONFIG_ORIGIN_HOST_MISMATCH');
  bad({host:'localhost',origin:'https://localhost:19852'},'CONFIG_LAN_REQUIRES_REAL_HOST');
  bad({host:'0.0.0.0'},'CONFIG_HOST_INVALID');bad({lanAllow:'Any'},'LAN_ALLOW_INVALID');bad({lanProfiles:'Everything'},'LAN_PROFILES_INVALID');bad({lanEnabled:'yes'},'CONFIG_LAN_INVALID');
  expect(validateConfig({...goodConfig()}).instance).toBe('nipt-test');                                       // loopback-only configurations still validate
 });
 it('chooses the LAN adapter: up, with a gateway, physical, lowest metric; virtual adapters never',()=>{
  const adapters=[{alias:'vEthernet (WSL)',ipv4:'172.25.32.1',gateway:'172.25.32.2',metric:5},{alias:'Wi-Fi',ipv4:'192.168.50.7',gateway:'192.168.50.1',metric:50},{alias:'Ethernet',ipv4:'192.168.1.57',gateway:'192.168.1.1',metric:25},{alias:'Ethernet 2',ipv4:'169.254.3.3',gateway:'1.1.1.1',metric:1},{alias:'Ethernet 3',ipv4:'10.9.9.9',gateway:null,metric:2}];
  expect(pickLanAddress(adapters)?.ipv4).toBe('192.168.1.57');
  expect(pickLanAddress([{alias:'Docker',ipv4:'10.0.75.1',gateway:'10.0.75.2'}])).toBeNull();expect(pickLanAddress(undefined)).toBeNull();
 });
});

describe('Setup messages (Thai, actionable, no technical detail in the dialog)',()=>{
 it('turns a failed preflight into the reasons the administrator can fix',()=>{
  const msg=thaiError('PREFLIGHT_FAILED',[{id:'install_root_safe',ok:false,detail:'INSTALL_ROOT_MUST_BE_ASCII'},{id:'port_https',ok:false,detail:'443'},{id:'free_space_8gb',ok:false,detail:'1'},{id:'excel_installed',ok:false,detail:''}]);
  expect(msg).toContain('ภาษาอังกฤษ');expect(msg).toContain('พอร์ต 443');expect(msg).toContain('8 GB');expect(msg).not.toContain('Excel');   // a missing Excel does not block the installation
  expect(thaiCheck({id:'package_signature_and_files',detail:'PACKAGE_CHECKSUM_MISMATCH'})).toContain('เสียหาย');
 });
 it('never leaks codes or stack text for known and unknown failures, and says when data is safe',()=>{
  for(const code of ['UPGRADE_FAILED_HEALTH','UPGRADE_FAILED_HEALTH_RESTORE_REQUIRED','UPGRADE_FAILED_HEALTH_RECOVERY_REQUIRED','UPGRADE_SCHEMA_INCOMPATIBLE','SIGNATURE_INVALID','INSTALLED_VERSION_IS_NEWER','LAN_ADDRESS_NOT_FOUND','TIMEOUT_HEALTH_["web"]','SOMETHING_NEW']){
   const t=thaiError(code,undefined);expect(t,code).toMatch(/[฀-๿]/);expect(t,code).not.toMatch(/Error|undefined|at \w+\(/);
  }
  expect(thaiError('UPGRADE_FAILED_HEALTH')).toContain('ย้อนกลับไปใช้เวอร์ชันก่อนหน้า');
  expect(thaiError('UPGRADE_FAILED_HEALTH_RESTORE_REQUIRED')).toContain('ไม่ย้อนกลับ');
  expect(thaiError('UPGRADE_FAILED_HEALTH_RECOVERY_REQUIRED')).toContain('ยืนยันการย้อนกลับไม่สำเร็จ');
  expect(thaiError('TIMEOUT_HEALTH_["web"]')).toContain('อย่าถอนการติดตั้ง');expect(thaiError('SOMETHING_NEW')).toContain('Log');
 });
 it('maps engine progress lines to Thai steps with a rising percentage',()=>{
  const lines=['[nipt] creating layout','[nipt] copying runtime and release (offline)','[nipt] generating secrets, certificate and policies','[nipt] initializing the private PostgreSQL cluster','[nipt] migrating the database and creating accounts','[nipt] registering the startup task','[nipt] taking the first verified backup (go-live gate)'];
  const pct=lines.map(l=>thaiStep(l)!.percent);expect([...pct].sort((a,b)=>a-b)).toEqual(pct);expect(thaiStep('[nipt] something unknown')).toBeNull();
  expect(thaiStep('[nipt] reusing the retained PostgreSQL cluster')!.text).toContain('เดิม');
 });
 it('warns about the real LAN problems and stays silent when everything is in place',()=>{
  const ok={enabled:true,probe:{reachableFromThisServer:true},firewall:{exists:true},warnings:[],certificateTrustedOnThisServer:true};
  expect(thaiLanWarnings(ok,{admin:true})).toEqual([]);
  expect(thaiLanWarnings({...ok,firewall:{exists:false}},{admin:false})).toContain(THAI_WARNING.FIREWALL_NOT_CREATED);
  expect(thaiLanWarnings({...ok,firewall:{exists:false}},{admin:true})).toContain(THAI_WARNING.FIREWALL_RULE_MISSING);
  expect(thaiLanWarnings({...ok,probe:{reachableFromThisServer:false}},{admin:true})).toContain(THAI_WARNING.LAN_PROBE_FAILED);
  expect(thaiLanWarnings({...ok,warnings:['NETWORK_CATEGORY_NOT_COVERED:Public']},{admin:true})).toContain(THAI_WARNING.NETWORK_PUBLIC);
  expect(thaiLanWarnings({...ok,certificateTrustedOnThisServer:false},{admin:true})).toContain(THAI_WARNING.CERT_NOT_TRUSTED);
  expect(thaiLanWarnings({...ok,enabled:false,probe:{reachableFromThisServer:false}},{admin:true})).not.toContain(THAI_WARNING.LAN_PROBE_FAILED);
  expect(thaiLanWarnings(undefined)).toEqual([]);
 });
 it('the wizard receives only ASCII codes and shows Thai text from tables compiled into Setup',()=>{
  // every progress text maps to a stable index, and the generated Pascal carries the same sentences
  for(const [i,t] of STEP_TEXTS.entries())expect(stepIndex(t)).toBe(i);
  expect(stepIndex('not a step')).toBe(-1);
  expect(thaiStep('[nipt] verifying the package')!.index).toBe(stepIndex(thaiStep('[nipt] verifying the package')!.text));
  const pas=pascalTables();
  for(const t of STEP_TEXTS)expect(pas).toContain(t);
  for(const [k,v] of Object.entries(THAI_WARNING)){expect(warningKey(v)).toBe(k);expect(pas).toContain("Code = '"+k+"'");}
  expect(errorKey('BACKUP_FAILED','x QUEUE_NOT_QUIESCENT')).toBe('BACKUP_BUSY');
  expect(errorKey('BACKUP_FAILED','disk full')).toBe('BACKUP_FAILED');
  expect(errorKey('TIMEOUT_HEALTH_web')).toBe('TIMEOUT_HEALTH');
  expect(errorKey('SOMETHING_NEW')).toBe('GENERIC');
  expect(errorKey('PREFLIGHT_FAILED',[{id:'excel_installed'}])).toBe('GENERIC');
  expect(errorKey('PREFLIGHT_FAILED',[{id:'free_space_8gb'}])).toBe('PREFLIGHT_FAILED');
  // every generated assignment is a complete statement (a stray quote in a sentence would break the compile)
  expect(pas.split('\r\n').filter(l=>l.includes(' then Result := ')&&!l.endsWith(';'))).toEqual([]);
  expect(pas).toContain('function CheckText(const Id, Detail: String): String;');
 });
});
