/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// Adds N synthetic LAB-path specimens (register -> HIS PET+OK -> worker receipt) to the isolated UAT queue, for the 20+ sample label-modal check (OWNER-LAB-027).
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {client} from './db-env';
import {operationalTestPetBytes} from '../operational/test-pet-fixture';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const O='https://127.0.0.1:20228',N=Number(process.argv[2]??6);
const cache=JSON.parse(readFileSync(process.env.TEMP+'/nipt-e2e-sessions.json','utf8')).lab as {jar:[string,string][];csrf:string};
const cookie=cache.jar.map(([k,v])=>`${k}=${v}`).join('; ');
const api=async(url:string,body:unknown)=>{const r=await fetch(O+url,{method:'POST',headers:{cookie,origin:O,'x-csrf-token':cache.csrf,'content-type':'application/json'},body:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw new Error(url+' '+r.status+' '+t.slice(0,200));return JSON.parse(t);};
const db=await client('migrator');const q=async(s:string,p:unknown[]=[])=>(await db.query(s,p)).rows;
const unit=(await q('SELECT id FROM unit LIMIT 1'))[0].id;
const f=(await q("SELECT r.value->>'basePath' b FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='his_inbound'"))[0].b as string;
const now=new Date(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(now).replaceAll('-',''),date=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`;
const hhmmss=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).replace(/:/g,'');
const stamp=String(Date.now()).slice(-6),edd=new Date(Date.parse(date)+155*86400000).toISOString().slice(0,10),ids:string[]=[];
mkdirSync(path.join(f,day),{recursive:true});
for(let i=0;i<N;i++){const ln='26'+String(20+i).padStart(2,'0')+stamp,hn='4'+String(i)+stamp+'/69';
 const r=await api('/api/p2/register',{ln,hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:createHash('sha256').update('q-'+stamp+i).digest('hex').slice(0,32),labOperational:{gaWeeks:17,gaDays:6,edd,pregnancy:'Singleton',paperRequest:true,paperConsent:true}});ids.push(r.caseId);
 const p=path.join(f,day,ln+'-7.pet');writeFileSync(p,operationalTestPetBytes({ln,hn,day,time:hhmmss}));writeFileSync(p.replace(/\.pet$/,'.ok'),Buffer.alloc(0));}
const t0=Date.now();while(Date.now()-t0<120000){if(Number((await q("SELECT count(*)::int n FROM specimen_round WHERE case_id=ANY($1::uuid[]) AND round_number=1 AND received_source='HIS_PET_RECEIPT'",[ids]))[0].n)===N)break;await new Promise(r=>setTimeout(r,1500));}
console.log('received',(await q("SELECT count(*)::int n FROM specimen_round WHERE case_id=ANY($1::uuid[]) AND received_source='HIS_PET_RECEIPT'",[ids]))[0].n,'of',N);await db.end();
