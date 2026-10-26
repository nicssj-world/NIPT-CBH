/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped). Probe: what gates an ANC case with Electronic Request + Paper Consent MARKER only (no certifier paper review, no clinical approval)?
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {client} from './db-env';
import {operationalTestPetBytes} from '../operational/test-pet-fixture';
import {emptyRequest} from '../../packages/p2/schema';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const O='https://127.0.0.1:20228',cache=JSON.parse(readFileSync(process.env.TEMP+'/nipt-e2e-sessions.json','utf8'));
async function ensure(u){const c=cache[u];if(c){const r=await fetch(O+'/api/me',{headers:{cookie:c.jar.map(([k,v])=>`${k}=${v}`).join('; ')}});if(r.ok)return;}
 const jar=new Map();const eat=r=>{for(const x of r.headers.getSetCookie())jar.set(x.split('=')[0],x.split(';')[0].split('=').slice(1).join('='));};const ck=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
 const a=await fetch(O+'/api/auth/csrf');eat(a);const csrf=(await a.json()).csrf;const b=await fetch(O+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:O,cookie:ck()},body:JSON.stringify({username:u,password:u,csrf})});eat(b);if(!b.ok)throw new Error('login '+u+' '+b.status);
 const m=await fetch(O+'/api/me',{headers:{cookie:ck()}});eat(m);const j=await m.json();cache[u]={jar:[...jar],csrf:j.csrf,id:j.user?.id??j.id};writeFileSync(process.env.TEMP+'/nipt-e2e-sessions.json',JSON.stringify(cache));}
await ensure('anc');await ensure('lab');
const mk=u=>{const c=cache[u];const cookie=c.jar.map(([k,v])=>`${k}=${v}`).join('; ');return async(url,body)=>{const r=await fetch(O+url,body?{method:'POST',headers:{cookie,origin:O,'x-csrf-token':c.csrf,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {status:r.status,j};};};
await ensure('approver');const anc=mk('anc'),lab=mk('lab'),appr=mk('approver');const db=await client('migrator');const q=async(s,p=[])=>(await db.query(s,p)).rows;
const unit=(await q('SELECT id FROM unit LIMIT 1'))[0].id,doctor=(await q('SELECT id FROM p2_doctor_version ORDER BY created_at DESC LIMIT 1'))[0].id;
const f=(await q("SELECT r.value->>'basePath' b FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='his_inbound'"))[0].b;
const now=new Date(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(now).replaceAll('-',''),date=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`,hh=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).replace(/:/g,'');
const stamp=String(Date.now()).slice(-6),ln='2619'+stamp,hn='33'+stamp+'/69';
const r=await anc('/api/p2/register',{ln,hn,unitId:unit,origin:'ANC',idempotencyKey:createHash('sha256').update('probe'+stamp).digest('hex').slice(0,32)});const id=r.j.caseId;const url='/api/p2/cases/'+id;
let w=(await anc(url)).j.workspace;console.log('modes',(await anc(url,{action:'setModes',expectedVersion:w.version,requestMode:'Electronic',consentMode:'Paper',reason:'SYNTHETIC-E2E paper consent marker'})).status);
w=(await anc(url)).j.workspace;const d12='1100'+stamp+'09',chk=(11-(d12.split('').reduce((a,c,i)=>a+Number(c)*(13-i),0)%11))%10;
const draft=structuredClone(emptyRequest);Object.assign(draft.patient,{syntheticName:'TEST LOCAL TEST',dob:'1996-03-31',entitlement:'SELF_PAY',identifierType:'ThaiNationalId',identifier:d12+chk});Object.assign(draft.pregnancy,{type:'Singleton',edd:new Date(Date.parse(date)+155*86400000).toISOString().slice(0,10),collectionDate:date,collectionTime:'07:00',collectionSource:'ANC',weightKg:60,heightCm:165,vanishingTwin:'No',fetalSex:'Want',sca:'Want'});
for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'])draft.history[k].answer='No';Object.assign(draft.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});Object.assign(draft.ordering,{doctorVersionId:doctor,facility:'SYNTHETIC-E2E HOSPITAL',reason:'SYNTHETIC-E2E screening request'});
const s=await anc(url,{action:'saveRequest',expectedVersion:w.version,draft});const l=await anc(url,{action:'lockRequest',expectedVersion:s.j.version,reason:'SYNTHETIC-E2E complete request'});console.log('request locked',l.status);
mkdirSync(path.join(f,day),{recursive:true});const pp=path.join(f,day,ln+'-7.pet');writeFileSync(pp,operationalTestPetBytes({ln,hn,day,time:hh}));writeFileSync(pp.replace(/\.pet$/,'.ok'),Buffer.alloc(0));
const t0=Date.now();while(Date.now()-t0<90000&&!(await q("SELECT 1 FROM specimen_round WHERE case_id=$1 AND received_source='HIS_PET_RECEIPT'",[id])).length)await new Promise(x=>setTimeout(x,1500));
const g=(await anc(url)).j;console.log('GATE after PET (no paper review, no approval):',JSON.stringify(g.gate).slice(0,600));
const ap=await appr(url,{action:'approveClinical',expectedVersion:(await appr(url)).j.workspace.version,reason:'SYNTHETIC-E2E authorized role exercise',sourceReference:'SYNTHETIC-E2E current request evidence',attestation:true});console.log('approveClinical (approver only)',ap.status,JSON.stringify(ap.j).slice(0,200));console.log('GATE now:',JSON.stringify((await anc(url)).j.gate).slice(0,300));
const rid=(await q('SELECT current_round_id r FROM nipt_case WHERE id=$1',[id]))[0].r;
const acc=await lab('/api/p4/worklist',{action:'acceptSpecimen',roundId:rid,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',criteriaReference:'SYNTHETIC-E2E specimen criteria',reason:'SYNTHETIC-E2E checked receipt'});console.log('accept',acc.status,JSON.stringify(acc.j).slice(0,160));
const att=await q('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[rid]);console.log('attempt',att.length);
const pw=await lab('/api/p4/worklist?tab=READY&pageSize=100&q='+ln);console.log('READY queue rows for this LN',(pw.j.attempts??[]).length,'GATE tab:',(await lab('/api/p4/worklist?tab=GATE&pageSize=100&q='+ln)).j.attempts?.map(a=>a.gate??a.gateFailures)?.slice(0,1));
await db.end();
