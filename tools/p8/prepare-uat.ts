import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {hashPassword} from '../../packages/security/password';

/** This tool provisions a new local rehearsal DB, never an existing deployment. */
export function uatAdminTarget(raw:string|undefined,mode:string|undefined):URL {
 if(mode!=='synthetic')throw Error('P8_UAT_SYNTHETIC_ONLY');
 let u:URL;try{u=new URL(raw??'');}catch{throw Error('P8_UAT_DEDICATED_LOCAL_TARGET_REQUIRED');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost'].includes(u.hostname)||!u.port||u.port==='5432'||u.username!=='nipt_p8_synthetic_owner'||u.pathname!=='/nipt_p8_synthetic_admin'||u.search||u.hash)throw Error('P8_UAT_DEDICATED_LOCAL_TARGET_REQUIRED');
 return u;
}

export async function prepareUat(){
 const authority=uatAdminTarget(process.env.NIPT_P8_OPS_URL,process.env.NIPT_MODE);
 // PostgreSQL identifiers are limited to 63 bytes. Keep all UUID bits without implicit truncation.
 const id=randomUUID().replaceAll('-',''),name='nipt_synthetic_p2_browser_p8uat'+id,root=path.resolve('.local/p8/uat-'+id);
 await mkdir(root,{recursive:true,mode:0o700});
 const seedFile=path.join(root,'seed-password'),lookupFile=path.join(root,'lookup.key');
 const password=randomBytes(24).toString('base64url');
 await writeFile(seedFile,password,{flag:'wx',mode:0o600});await writeFile(lookupFile,randomBytes(32),{flag:'wx',mode:0o600});
 const admin=new Client({connectionString:authority.toString()});await admin.connect();
 try{await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const target=new URL(authority);target.pathname='/'+name;
 const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:target.toString(),MIGRATION_DATABASE_URL_FILE:'',SYNTHETIC_SEED_PASSWORD:undefined,SYNTHETIC_SEED_PASSWORD_FILE:seedFile,IDENTITY_LOOKUP_KEY_FILE:lookupFile,WEB_DB_PASSWORD_FILE:path.resolve('data/secrets/web-password'),WORKER_DB_PASSWORD_FILE:path.resolve('data/secrets/worker-password'),FILE_STORE_ROOT:path.join(root,'files'),SIMULATOR_ROOT:path.join(root,'simulator')};
 const run=(file:string)=>new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',file],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',()=>reject(Error('P8_UAT_SETUP_FAILED')));child.once('exit',code=>{void writeFile(path.join(root,path.basename(file)+'.log'),output,{mode:0o600}).then(()=>code===0?resolve():reject(Error('P8_UAT_SETUP_FAILED')));});});
 for(const file of ['tools/prepare-db.ts','tools/seed.ts','tools/his-simulator/main.ts'])await run(file);
 const db=new Client({connectionString:target.toString()});await db.connect();
 let holds:Record<string,unknown>;
 try{
  await db.query('BEGIN');
  const users=(await db.query<{id:string;username:string}>('SELECT id,username FROM app_user')).rows;
  const lab=users.find(u=>u.username==='synthetic.lab')!,approver=users.find(u=>u.username==='synthetic.approver')!;
  const verifier=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.verifier','ผู้ตรวจย้อนหลังจำลอง P8',$1) RETURNING id",[await hashPassword(password)])).rows[0];
  await db.query("INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,'HISTORICAL_VERIFIER',$2)",[verifier.id,approver.id]);
  await db.query("INSERT INTO user_permission(user_id,permission,approved_by) VALUES($1,'HISTORICAL_ENTRY',$2)",[lab.id,approver.id]);
  await db.query('COMMIT');
  holds=(await db.query('SELECT p5_release_authorized() AS clinical_authority,(SELECT count(*)::int FROM result_release) AS clinical_releases,(SELECT count(*)::int FROM nipt_case) AS synthetic_cases')).rows[0];
  if(holds.clinical_authority!==false||holds.clinical_releases!==0)throw Error('P8_UAT_CLINICAL_HOLD_FAILED');
 }finally{await db.end();}
 const webPassword=(await readFile('data/secrets/web-password','utf8')).trim();const webTarget=new URL(target);webTarget.username='nipt_web';webTarget.password=webPassword;
 await writeFile(path.join(root,'web-url'),webTarget.toString(),{mode:0o600,flag:'wx'});
 const workerTarget=new URL(target);workerTarget.username='nipt_worker';workerTarget.password=(await readFile('data/secrets/worker-password','utf8')).trim();
 await writeFile(path.join(root,'worker-url'),workerTarget.toString(),{mode:0o600,flag:'wx'});
 const runtime={NIPT_MODE:'synthetic',DATABASE_URL_FILE:path.join(root,'web-url'),APP_ORIGIN:'http://127.0.0.1:3380',PORT:'3380',HOSTNAME:'127.0.0.1',FILE_STORE_ROOT:env.FILE_STORE_ROOT,SIMULATOR_ROOT:env.SIMULATOR_ROOT,RENDERER_URL:'http://127.0.0.1:3381',RENDERER_PORT:'3381',RENDERER_TOKEN_FILE:path.resolve('data/keys/renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:path.resolve('data/keys/integration-public.pem'),IDENTITY_LOOKUP_KEY_FILE:lookupFile,SYNTHETIC_SEED_PASSWORD_FILE:seedFile};
 await writeFile(path.join(root,'runtime.env'),Object.entries(runtime).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
 const records=Array.from({length:18},(_,i)=>`UAT${String(i+1).padStart(2,'0')},NOT_RUN,,,,,,`);
 await writeFile(path.join(root,'acceptance-records.csv'),'scenario,status,tester,date,device,evidence,issue,witness,signature\n'+records.join('\n')+'\n',{flag:'wx'});
 const manifest={syntheticOnly:true,status:'PREPARED_NOT_RUN_NOT_SIGNED',database:name,host:authority.hostname,port:Number(authority.port),credentialFile:'seed-password',accounts:['synthetic.admin','synthetic.approver','synthetic.lab','synthetic.anc','synthetic.auditor','synthetic.certifier','synthetic.verifier'],holds,checklist:'docs/p7/acceptance-checklist.md',physicalValidation:'PENDING PHYSICAL VALIDATION',clinicalPilot:'HOLD',actualCutoff:null,anchorPolicyApproval:null};
 await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 process.stdout.write(JSON.stringify({code:'P8_UAT_PREPARED',root,database:name,...holds})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)prepareUat().catch(()=>{process.stderr.write('P8_UAT_PREPARATION_FAILED\n');process.exitCode=1;});

