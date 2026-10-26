/** First sign-in proof for a PRODUCTION installation: the one-time password from credentials.txt works once, the account is forced to change it,
 *  every protected API refuses until it has, the old password stops working, and the new password signs in with the assigned role.
 *    tsx tools/win-installer/installed-first-login.ts --root <install root>
 *  The new password is generated here and never printed or stored. Output is booleans and role names only. */
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {layout} from './lib.mjs';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const root=arg('root');if(!root)throw Error('USAGE');
const L=layout(root);
const config=JSON.parse(await readFile(L.configFile,'utf8')) as {origin:string;ports:{https:number};testEnvironmentOnly:boolean};
if(config.testEnvironmentOnly!==false)throw Error('PRODUCTION_PROFILE_REQUIRED');
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; // the installation's own self-signed certificate, loopback only
const text=await readFile(L.credentials,'utf8');
const blocks=text.split(/\r?\n\r?\n/).map(b=>Object.fromEntries(b.split(/\r?\n/).map(l=>l.split(/:\s(.*)/s).slice(0,2) as [string,string]).filter(p=>p[1]!==undefined)));
const accounts=blocks.filter(b=>b.Username&&b.Password&&b.Role) as {Role:string;Username:string;Password:string}[];
if(accounts.length!==2)throw Error('EXPECTED_TWO_FIRST_ACCOUNTS');

type Jar=Map<string,string>;
const base=`https://127.0.0.1:${config.ports.https}`;
const call=async(jar:Jar,method:string,url:string,body?:unknown,csrf?:string)=>{
 const r=await fetch(base+url,{method,redirect:'manual',headers:{...(body?{'content-type':'application/json'}:{}),origin:new URL(config.origin).origin,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 for(const c of r.headers.getSetCookie()){const [pair]=c.split(';');const i=pair.indexOf('=');const k=pair.slice(0,i),v=pair.slice(i+1);if(/Max-Age=0/i.test(c)||v==='')jar.delete(k);else jar.set(k,v);}
 const raw=await r.text();let json:Record<string,unknown>={};try{json=JSON.parse(raw);}catch{/* not JSON */}
 return {status:r.status,json};
};
async function login(username:string,password:string){
 const jar:Jar=new Map();const pre=await call(jar,'GET','/api/auth/csrf');
 const res=await call(jar,'POST','/api/auth/login',{username,password,csrf:pre.json.csrf});
 return {jar,status:res.status,csrf:res.json.csrf as string|undefined};
}
const results:Record<string,unknown>[]=[];
let adminSession:{jar:Jar;csrf:string}|null=null;
for(const account of accounts){
 const first=await login(account.Username,account.Password);
 if(first.status!==200)throw Error('ONE_TIME_PASSWORD_REJECTED:'+account.Role);
 const me=await call(first.jar,'GET','/api/me');
 const roles=me.json.roles as string[];
 if(!roles.includes(account.Role))throw Error('ROLE_MISSING:'+account.Role);
 // forced change: a protected business API refuses until the password is changed
 const blocked=await call(first.jar,'GET','/api/admin');
 if(blocked.status===200)throw Error('PROTECTED_API_OPEN_BEFORE_PASSWORD_CHANGE');
 const next=randomBytes(18).toString('base64url')+'aA1';
 const wrong=await call(first.jar,'POST','/api/auth/password',{current:'wrong-'+next,next},first.csrf);
 if(wrong.status===200)throw Error('PASSWORD_CHANGE_ACCEPTED_WRONG_CURRENT');
 const changed=await call(first.jar,'POST','/api/auth/password',{current:account.Password,next},first.csrf);
 if(changed.status!==200)throw Error('PASSWORD_CHANGE_FAILED:'+changed.status);
 const old=await login(account.Username,account.Password);
 if(old.status===200)throw Error('OLD_PASSWORD_STILL_WORKS');
 const fresh=await login(account.Username,next);
 if(fresh.status!==200)throw Error('NEW_PASSWORD_REJECTED');
 const after=await call(fresh.jar,'GET','/api/me');
 if(after.status!==200)throw Error('SESSION_AFTER_CHANGE_FAILED');
 if(account.Role==='APP_ADMIN')adminSession={jar:fresh.jar,csrf:fresh.csrf as string};
 const admin=account.Role==='APP_ADMIN'?await call(fresh.jar,'GET','/api/admin'):null;
 results.push({role:account.Role,oneTimePasswordAccepted:true,protectedApiBlockedBeforeChange:blocked.status,wrongCurrentRefused:wrong.status,changed:true,oldPasswordRefused:old.status,newPasswordSignsIn:true,...(admin?{adminApiAfterChange:admin.status}:{})});
}
// PET/RES path settings: the signed-in administrator proposes new local folders, the worker tests them, the administrator applies them (no restart, no file edit)
let paths:Record<string,unknown>|undefined;
if(process.argv.includes('--his-paths')&&adminSession){
 const dirs={pet:path.join(L.inbound,'pet-local'),res:path.join(L.outbound,'res-local'),cfsPdf:path.join(L.outbound,'pdf-local'),backup:path.join(L.outbound,'backup-local')};
 for(const d of Object.values(dirs))await mkdir(d,{recursive:true});
 const {jar,csrf}=adminSession as {jar:Jar;csrf:string};
 const proposed=await call(jar,'POST','/api/settings/his-paths',{operation:'propose',reason:'Installer rehearsal: local PET/RES folders',paths:dirs},csrf);
 if(proposed.status!==200)throw Error('HIS_PATH_PROPOSE_FAILED:'+proposed.status+':'+JSON.stringify(proposed.json).slice(0,300));
 const deadline=Date.now()+180000;let overview:Record<string,unknown>={};let ready=false;
 while(Date.now()<deadline){
  overview=(await call(jar,'GET','/api/settings/his-paths')).json;
  const keys=(overview.keys??{}) as Record<string,{pending:{test:{state:string};id:string}|null}>;
  const pending=Object.values(keys).filter(k=>k.pending);
  if(pending.length&&pending.every(k=>k.pending!.test.state==='PASSED')){ready=true;break;}
  if(pending.some(k=>k.pending!.test.state==='FAILED'))throw Error('HIS_PATH_TEST_FAILED:'+JSON.stringify(keys).slice(0,400));
  await new Promise(r=>setTimeout(r,2000));
 }
 if(!ready)throw Error('HIS_PATH_TEST_TIMEOUT');
 const ids=Object.values((overview.keys??{}) as Record<string,{pending:{id:string}|null}>).flatMap(k=>k.pending?[k.pending.id]:[]);
 const applied=await call(jar,'POST','/api/settings/his-paths',{operation:'apply',ids},csrf);
 if(applied.status!==200)throw Error('HIS_PATH_APPLY_FAILED:'+applied.status+':'+JSON.stringify(applied.json).slice(0,300));
 const after=(await call(jar,'GET','/api/settings/his-paths')).json.keys as Record<string,{paths:Record<string,string>}>;
 const active=Object.assign({},...Object.values(after).map(k=>k.paths)) as Record<string,string>;
 for(const [k,v] of Object.entries(dirs))if(path.resolve(active[k]??'')!==path.resolve(v))throw Error('HIS_PATH_NOT_ACTIVE:'+k);
 paths={proposed:true,workerTested:true,applied:(applied.json.applied as unknown[]).length,activePathsMatch:true,restartRequired:false};
}
const bad=await login(accounts[0].Username,'definitely-not-the-password-1');
process.stdout.write(JSON.stringify({passed:bad.status===401,wrongPasswordStatus:bad.status,accounts:results,...(paths?{hisPaths:paths}:{})})+'\n');
