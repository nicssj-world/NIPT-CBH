import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Pool} from 'pg';
import {chromium,type Page} from 'playwright';
import type {Principal} from '../../packages/security/policy';
import {positiveJourney} from './positive-journey-steps';

const root=path.resolve('.local/home-operational-uat'),base=path.join(root,'positive-journey'),integration=path.join(root,'integration'),inbound=path.join(integration,'inbound');
const origin='https://127.0.0.1:19446',databaseName='nipt_operational_integrated_uat';
if(process.env.NIPT_MODE!=='operational'||process.env.APP_ORIGIN!==origin||process.env.NIPT_OPERATIONAL_DATABASE!==databaseName)throw Error('HOME_UAT_RUNTIME_REQUIRED');
await mkdir(base,{recursive:true});
const accountFile=process.env.NIPT_UAT_ACCOUNTS_FILE;if(!accountFile)throw Error('HOME_UAT_ACCOUNTS_REQUIRED');
const accounts=JSON.parse(await readFile(accountFile,'utf8')) as {username:string;password:string}[];
const account=(username:string)=>{const value=accounts.find(row=>row.username===username);if(!value)throw Error('HOME_UAT_ACCOUNT_MISSING');return value;};
const migrationFile=process.env.NIPT_HOME_UAT_MIGRATION_URL_FILE;if(!migrationFile)throw Error('HOME_UAT_MIGRATION_URL_REQUIRED');
const connection=new URL((await readFile(migrationFile,'utf8')).trim());
if(connection.hostname!=='db'||decodeURIComponent(connection.pathname.slice(1))!==databaseName)throw Error('HOME_UAT_DATABASE_TARGET_MISMATCH');
connection.hostname='127.0.0.1';connection.port='19447';
const db=new Pool({connectionString:connection.toString()});
const events:string[]=[],browserErrors:string[]=[];
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function waitFor(check:()=>Promise<boolean>,label:string,timeout=90000) {
 const started=Date.now();while(Date.now()-started<timeout){if(await check().catch(()=>false))return;await new Promise(resolve=>setTimeout(resolve,250));}
 throw Error('TIMEOUT_'+label);
}
function principal(username:string):Promise<Principal> {
 return db.query<{id:string;role:string;unit_id:string|null;permission:string|null}>(
  'SELECT u.id,a.role,s.unit_id,p.permission FROM app_user u LEFT JOIN role_assignment a ON a.user_id=u.id AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) LEFT JOIN user_unit_scope s ON s.user_id=u.id LEFT JOIN user_permission p ON p.user_id=u.id WHERE u.username=$1',[username]
 ).then(result=>{
  const row=result.rows[0];if(!row)throw Error('HOME_UAT_PRINCIPAL_MISSING');
  return {id:row.id,roles:result.rows.flatMap(item=>item.role?[item.role as Principal['roles'][number]]:[]),unitIds:result.rows.flatMap(item=>item.unit_id?[item.unit_id]:[]),permissions:result.rows.flatMap(item=>item.permission?[item.permission]:[])};
 });
}
async function login(page:Page,username:string) {
 await page.goto('/login');
 await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(username);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(account(username).password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await page.waitForURL(url=>url.pathname!=='/login',{timeout:15000});
 if(!await page.getByText('TRAINING / LOCAL UAT — NOT FOR CLINICAL USE',{exact:true}).count())throw Error('HOME_UAT_BANNER_MISSING');
}
async function api(page:Page,url:string,body?:unknown) {
 const result=await page.evaluate(async(input)=>{
  const csrf=document.cookie.split('; ').find(item=>item.startsWith('nipt_csrf='))?.split('=').slice(1).join('=')??'';
  const response=await fetch(input.url,{method:input.body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
  const text=await response.text();let data:unknown;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data};
 },{url,body});
 if(result.status>=400)throw Error('HOME_UAT_API_'+result.status+'_'+url);
 return result.data;
}
try {
 const mode=await db.query<{database:string;mode:string;enabled:boolean}>('SELECT current_database() database,mode,nipt_operational_enabled() enabled FROM nipt_runtime_config WHERE singleton=true');
 if(mode.rows[0]?.database!==databaseName||mode.rows[0]?.mode!=='operational'||mode.rows[0]?.enabled!==true)throw Error('HOME_UAT_DATABASE_MODE_MISMATCH');
 const unit=(await db.query<{id:string}>('SELECT id FROM unit WHERE code=$1',['LOCAL_UAT'])).rows[0];
 if(!unit)throw Error('HOME_UAT_TEST_UNIT_MISSING');
 const users:Record<string,Principal>={
  'test.admin':await principal('uat.admin'),
  'test.lab':await principal('uat.lab'),
  'test.certifier':await principal('uat.certifier'),
  'test.reviewer':await principal('uat.clinical-approver')
 };
 const launchArgs=['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--no-first-run'];
 browser=await chromium.launch({headless:true,args:launchArgs});
 const contexts=await Promise.all([1,2,3].map(()=>browser!.newContext({baseURL:origin,ignoreHTTPSErrors:true})));
 const pages=await Promise.all(contexts.map(context=>context.newPage()));
 for(const page of pages) {
  page.on('pageerror',error=>browserErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text());});
  await page.context().route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1'&&url.port==='19446')return route.continue();
   return route.abort();
  });
 }
 await Promise.all([login(pages[0],'uat.lab'),login(pages[1],'uat.certifier'),login(pages[2],'uat.clinical-approver')]);
 const cookies=await contexts[0].cookies();
 if(cookies.find(cookie=>cookie.name==='nipt_session')?.secure!==true)throw Error('HOME_UAT_SECURE_SESSION_COOKIE_REQUIRED');
 const localPolicy=path.join(integration,'share-policy.json');
 await positiveJourney({
  anc:false,db,base,inbound,policy:localPolicy,unit:unit.id,lab:pages[0],certifier:pages[1],reviewer:pages[2],users,api,waitFor,events,
  workerInboundRoot:'/simulator/inbound',workerOutboundRoot:'/outbound',workerServiceAccountName:'node'
 });
 if(browserErrors.length)throw Error('HOME_UAT_BROWSER_ERRORS');
 const evidence={
  passed:true,sourceHead:process.env.SOURCE_REVISION??'local-source',runtimeMode:'operational',database:databaseName,
  events,browserErrors,interactiveRuntimeLeftRunning:true,physicalHalosAcceptance:'NOT_RUN',hospitalLanAcceptance:'NOT_RUN',
  hisConfirmed:false,artifactDirectory:base,localOnlyOutputs:true
 };
 await writeFile(path.join(base,'evidence.json'),JSON.stringify(evidence,null,2));
 process.stdout.write(JSON.stringify(evidence)+'\n');
} catch(error) {
 await writeFile(path.join(base,'failure.json'),JSON.stringify({events,browserErrors,error:error instanceof Error?error.stack:'HOME_UAT_JOURNEY_FAILED'},null,2));
 throw error;
} finally {
 await browser?.close();
 await db.end();
}
