import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/home-operational-uat');
const source=path.resolve(process.argv[3]??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx');
const expectedRoot=path.resolve('.local/home-operational-uat');
if(path.relative(expectedRoot,root).startsWith('..')||path.isAbsolute(path.relative(expectedRoot,root)))throw Error('LOCAL_UAT_ROOT_REQUIRED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedMaster='0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6';
const dirs=['secrets','master','files','integration/inbound','integration/results','positive-journey/outbound/res','positive-journey/outbound/pdf','positive-journey/outbound/backup','excel-spool/inbox','excel-spool/processing','excel-spool/outbox','fixtures'];
for(const dir of dirs)await mkdir(path.join(root,dir),{recursive:true});
const master=path.join(root,'master/approved-combined.xlsx');
let masterBytes;
try{masterBytes=await readFile(master);}catch(error){if(error.code!=='ENOENT')throw error;const sourceBytes=await readFile(source);if(sha(sourceBytes)!==expectedMaster)throw Error('APPROVED_MASTER_SHA256_MISMATCH');await writeFile(master,sourceBytes,{flag:'wx'});masterBytes=sourceBytes;}
if(sha(masterBytes)!==expectedMaster)throw Error('LOCAL_UAT_MASTER_COPY_MISMATCH');
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
  'db-password':db,'migration-url':'postgresql://nipt_migrator:'+db+'@db:5432/nipt_operational_home_uat',
  'web-url':'postgresql://nipt_web:'+web+'@db:5432/nipt_operational_home_uat',
  'worker-url':'postgresql://nipt_worker:'+worker+'@db:5432/nipt_operational_home_uat',
  'web-password':web,'worker-password':worker,'uat-accounts.json':JSON.stringify(accounts,null,2),
  'renderer-token':random(),'identity-lookup.key':randomBytes(32).toString('hex'),
  'integration-public.pem':publicKey,'integration-private.pem':privateKey
 };
 for(const [name,value] of Object.entries(values))await writeFile(path.join(secretRoot,name),value,{flag:'wx'});
 const credentialLines=['NIPT-CBH HOME LOCAL OPERATIONAL UAT','TRAINING / LOCAL UAT — NOT FOR CLINICAL USE','URL: https://127.0.0.1:19444/login',''];
 for(const account of accounts)credentialLines.push('Role: '+account.role,'Username: '+account.username,'Password: '+account.password,'');
 await writeFile(path.join(root,'credentials.txt'),credentialLines.join('\r\n'),{flag:'wx'});
} else {
 try{await access(path.join(root,'credentials.txt'));}catch(error){
  if(error.code!=='ENOENT')throw error;
  const accounts=JSON.parse(await readFile(path.join(secretRoot,'uat-accounts.json'),'utf8'));
  const credentialLines=['NIPT-CBH HOME LOCAL OPERATIONAL UAT','TRAINING / LOCAL UAT — NOT FOR CLINICAL USE','URL: https://127.0.0.1:19444/login',''];
  for(const account of accounts)credentialLines.push('Role: '+account.role,'Username: '+account.username,'Password: '+account.password,'');
  await writeFile(path.join(root,'credentials.txt'),credentialLines.join('\r\n'),{flag:'wx'});
 }
}
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
