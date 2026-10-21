import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/owner-local-uat-1.0.2');
const source=path.resolve(process.argv[3]??'.local/lab-owner-evidence/lab-combined-master.xlsx');
const expectedRoot=path.resolve('.local/owner-local-uat-1.0.2');
if(path.relative(expectedRoot,root).startsWith('..')||path.isAbsolute(path.relative(expectedRoot,root)))throw Error('LOCAL_UAT_ROOT_REQUIRED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedMaster='4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1';
const dirs=['secrets','master','files','integration/inbound','integration/results','positive-journey/outbound/res','positive-journey/outbound/pdf','positive-journey/outbound/backup','excel-spool/inbox','excel-spool/processing','excel-spool/outbox','fixtures'];
for(const dir of dirs)await mkdir(path.join(root,dir),{recursive:true});
const master=path.join(root,'master/approved-combined-20261021.xlsx');
let masterBytes;
try{masterBytes=await readFile(master);}catch(error){if(error.code!=='ENOENT')throw error;const sourceBytes=await readFile(source);if(sha(sourceBytes)!==expectedMaster)throw Error('APPROVED_MASTER_SHA256_MISMATCH');await writeFile(master,sourceBytes,{flag:'wx'});masterBytes=sourceBytes;}
if(sha(masterBytes)!==expectedMaster)throw Error('LOCAL_UAT_MASTER_COPY_MISMATCH');
for(const [filename,expected] of [['Pooling Sheet Template_R001.csv','2ea12e86e1429be6ad9720c3b1b45f90588ad5c1316548146b5062b16bd6977a'],['NIFTY_Test_Request_FormHNZ_filled.xlsx','07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc']]){
 const target=path.join(root,'master',filename);let bytes;
 try{bytes=await readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;bytes=await readFile(path.join('C:/Users/User/Downloads',filename));if(sha(bytes)!==expected)throw Error('LAB_OWNER_TEMPLATE_SHA256_MISMATCH');await writeFile(target,bytes,{flag:'wx'});}
 if(sha(bytes)!==expected)throw Error('LAB_OWNER_TEMPLATE_SHA256_MISMATCH');
}
const secretRoot=path.join(root,'secrets');
const names=['db-password','migration-url','web-url','worker-url','web-password','worker-password','uat-accounts.json','renderer-token','identity-lookup.key','integration-public.pem','integration-private.pem'];
const present=[];
for(const name of names){try{await access(path.join(secretRoot,name));present.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}}
if(present.length!==0&&present.length!==names.length)throw Error('LOCAL_UAT_SECRET_SET_INCOMPLETE');
if(present.length===0) {
 const random=()=>randomBytes(32).toString('hex');
 const db=random(),web=random(),worker=random();
 const accounts=[
  {username:'uat.admin',displayName:'LOCAL UAT Administrator',password:random(),role:'APP_ADMIN'},
  {username:'uat.lab',displayName:'LOCAL UAT Laboratory Staff',password:random(),role:'LAB_STAFF'},
  {username:'uat.certifier',displayName:'LOCAL UAT Laboratory Certifier',password:random(),role:'LAB_CERTIFIER'},
  {username:'uat.clinical-approver',displayName:'LOCAL UAT Clinical Approver',password:random(),role:'CLINICAL_APPROVER'},
  {username:'uat.auditor',displayName:'LOCAL UAT Auditor',password:random(),role:'AUDITOR'},
  {username:'uat.anc',displayName:'LOCAL UAT ANC Nurse',password:random(),role:'ANC_NURSE'}
 ];
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const values={
  'db-password':db,'migration-url':'postgresql://nipt_migrator:'+db+'@db:5432/nipt_operational_integrated_owner_uat',
  'web-url':'postgresql://nipt_web:'+web+'@db:5432/nipt_operational_integrated_owner_uat',
  'worker-url':'postgresql://nipt_worker:'+worker+'@db:5432/nipt_operational_integrated_owner_uat',
  'web-password':web,'worker-password':worker,'uat-accounts.json':JSON.stringify(accounts,null,2),
  'renderer-token':random(),'identity-lookup.key':randomBytes(32),
  'integration-public.pem':publicKey,'integration-private.pem':privateKey
 };
 for(const [name,value] of Object.entries(values))await writeFile(path.join(secretRoot,name),value,{flag:'wx'});
 const credentialLines=['NIPT-CBH HOME LOCAL OPERATIONAL UAT','TRAINING / LOCAL UAT — NOT FOR CLINICAL USE','URL: https://127.0.0.1:19548/login',''];
 for(const account of accounts)credentialLines.push('Role: '+account.role,'Username: '+account.username,'Password: '+account.password,'');
 await writeFile(path.join(root,'credentials.txt'),credentialLines.join('\r\n'),{flag:'wx'});
} else {
 try{await access(path.join(root,'credentials.txt'));}catch(error){
  if(error.code!=='ENOENT')throw error;
  const accounts=JSON.parse(await readFile(path.join(secretRoot,'uat-accounts.json'),'utf8'));
  const credentialLines=['NIPT-CBH HOME LOCAL OPERATIONAL UAT','TRAINING / LOCAL UAT — NOT FOR CLINICAL USE','URL: https://127.0.0.1:19548/login',''];
  for(const account of accounts)credentialLines.push('Role: '+account.role,'Username: '+account.username,'Password: '+account.password,'');
  await writeFile(path.join(root,'credentials.txt'),credentialLines.join('\r\n'),{flag:'wx'});
 }
}
if((await readFile(path.join(secretRoot,'identity-lookup.key')).then(bytes=>bytes.length))!==32)throw Error('LOCAL_UAT_IDENTITY_LOOKUP_KEY_INVALID');
const policyFile=path.join(root,'integration/share-policy.json');
try{await access(policyFile);}catch(error){
 if(error.code!=='ENOENT')throw error;
 const policy={version:1,grants:[
  {root:'/simulator/inbound',purposes:['INBOUND'],serviceAccount:'node',secretRef:null,mode:'operational'},
  {root:'/outbound',purposes:['OUTBOUND'],serviceAccount:'node',secretRef:null,mode:'operational'},
  {root:'/simulator/results',purposes:['RESULTS'],serviceAccount:'node',secretRef:null,mode:'operational'}
 ]};
 await writeFile(policyFile,JSON.stringify(policy,null,2),{flag:'wx'});
}
process.stdout.write('HOME_UAT_LOCAL_FILES_READY masterSha256='+expectedMaster+' secrets=protected-by-launcher-acl\n');
