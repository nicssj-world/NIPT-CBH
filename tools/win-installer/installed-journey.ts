/** Installed Operational Journey: the existing positive operational workflow (45 test patients: HIS PET in, Request/Consent gates, Lab Run,
 *  Pooling, Sequencing, Results, certified release and the outbound RES/PDF/backup files) driven through the INSTALLED Windows services
 *  over HTTPS, with the installation's own accounts, database, policies and Worker. Test identities only; no hospital path, no HIS.
 *    tsx tools/win-installer/installed-journey.ts --root <install root> --out <evidence directory> [--anc] [--workflow-only]
 *  Run after `Install-Nipt` has completed and the services are healthy. The installed CA certificate is trusted for the Node probes;
 *  the browser contexts accept it explicitly because the certificate is the installer's own self-signed test certificate. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {Pool} from 'pg';
import {chromium,expect,type Page} from '@playwright/test';
import {layout} from './lib.mjs';
import {positiveJourney} from '../operational/positive-journey-steps';
import type {Principal} from '../../packages/security/policy';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const root=arg('root'),out=arg('out');
if(!root||!out)throw Error('ROOT_AND_OUT_REQUIRED');
const L=layout(root);
const config=JSON.parse(await fs.readFile(L.configFile,'utf8')) as {database:string;origin:string;mode:string;testEnvironmentOnly:boolean};
if(config.mode!=='operational'||config.testEnvironmentOnly!==true)throw Error('INSTALLED_TEST_ENVIRONMENT_REQUIRED');
const secret=async(n:string)=>(await fs.readFile(path.join(L.secrets,n),'utf8')).trim();
const accounts=JSON.parse(await secret('uat-accounts.json')) as {username:string;role:Principal['roles'][number];password:string}[];
const account=(u:string)=>accounts.find(a=>a.username===u)??(()=>{throw Error('ACCOUNT_MISSING_'+u);})();
process.env.NIPT_MODE='operational';process.env.APP_ORIGIN=config.origin;process.env.NIPT_OPERATIONAL_DATABASE=config.database;
await fs.mkdir(out,{recursive:true});
const events:string[]=[],browserErrors:string[]=[];
const db=new Pool({connectionString:await secret('migration-url')});
async function waitFor(check:()=>Promise<boolean>,label:string,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){if(await check().catch(()=>false))return;await new Promise(r=>setTimeout(r,250));}throw Error('TIMEOUT_'+label);}
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 const principal=async(username:string):Promise<Principal>=>{
  const row=(await db.query<{id:string}>('SELECT id FROM app_user WHERE username=$1',[username])).rows[0];if(!row)throw Error('USER_MISSING_'+username);
  return {id:row.id,roles:[account(username).role],unitIds:[],permissions:[]} as Principal;
 };
 const users:Record<string,Principal>={'test.admin':await principal('uat.admin'),'test.lab':await principal('uat.lab'),'test.certifier':await principal('uat.certifier'),'test.reviewer':await principal('uat.clinical-approver')};
 const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='INSTALL_TEST'")).rows[0].id;
 browser=await chromium.launch({headless:true});
 const context=()=>browser!.newContext({baseURL:config.origin,ignoreHTTPSErrors:true});
 const labContext=await context(),certContext=await context(),reviewContext=await context();
 await waitFor(async()=>(await labContext.request.get('/login')).ok(),'INSTALLED_WEB');
 const [lab,certifier,reviewer]=await Promise.all([labContext,certContext,reviewContext].map(c=>c.newPage()));
 for(const page of [lab,certifier,reviewer]){page.on('pageerror',e=>browserErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text()+' '+m.location().url);});}
 async function login(page:Page,username:string){await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(username);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(account(username).password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);}
 await login(lab,'uat.lab');await login(certifier,'uat.certifier');await login(reviewer,'uat.clinical-approver');
 assert.equal((await labContext.cookies()).find(c=>c.name==='nipt_session')?.secure,true);events.push('INSTALLED_HTTPS_LOGIN_SECURE_COOKIES');
 async function api(page:Page,url:string,body?:unknown){const res=await page.evaluate(async({url,body})=>{const token=document.cookie.split('; ').find(x=>x.startsWith('nipt_csrf='))?.split('=').slice(1).join('=')??'';const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};},{url,body});if(res.status>=400)throw Error('API_'+res.status+'_'+JSON.stringify(res.data));return res.data;}
 await positiveJourney({anc:process.argv.includes('--anc'),workflowOnly:process.argv.includes('--workflow-only'),db,base:out,inbound:L.inbound,policy:path.join(L.config,'share-policy.json'),localOutboundRoot:L.outbound,unit,lab,certifier,reviewer,users,api,waitFor,events});
 assert.deepEqual(browserErrors,[],'installed browser pages must have no runtime/resource errors');
 const counts=(await db.query<{cases:string;releases:string;transfers:string}>('SELECT (SELECT count(*) FROM nipt_case)::text cases,(SELECT count(*) FROM result_release)::text releases,(SELECT count(*) FROM p6_transfer)::text transfers')).rows[0];
 const evidence={passed:true,environment:'INSTALLED_WINDOWS_TEST_ENVIRONMENT',database:config.database,url:config.origin,counts,events,browserErrors,hisConfirmed:false,hospitalLanAcceptance:'NOT_RUN',physicalHalosAcceptance:'NOT_RUN'};
 await fs.writeFile(path.join(out,'installed-journey.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
}catch(error){await fs.writeFile(path.join(out,'installed-journey-failure.json'),JSON.stringify({events,browserErrors,error:error instanceof Error?error.stack:'FAILED'},null,2));throw error;}
finally{await browser?.close();await db.end();}
