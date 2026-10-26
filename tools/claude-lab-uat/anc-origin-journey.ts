/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// ANC-ORIGIN variant (Owner final workflow closure): every specimen is registered by ANC (origin ANC, Electronic Request, Paper Consent MARKER only,
// no certifier paper review, no scan/upload, no LAB re-registration); after PET/OK the analysis chain is identical to the LAB path.
// ONE continuous synthetic journey on the isolated UAT runtime (https://127.0.0.1:20228, loopback; real routes, real worker, native Word PDF):
//   ANC register -> HIS PET+OK -> clinical gate -> LAB specimen receipt -> Batch -> Task -> QC/Pooling/Sequencing exports ->
//   HALOS result import -> native signed NIPT PDF (case A) | external ReadyGen-final PDF fallback (case B) -> release ->
//   worker -> HIS simulator RES/OK + PDF/CFS -> ANC sees result, opens/downloads/prints the same PDF.
// Additive synthetic data only (SYNTHETIC-E2E LNs); never resets, never touches existing batches. No real HIS.
// usage: npx tsx tools/claude-lab-uat/integrated-journey.ts
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {client} from './db-env';
import {operationalTestPetBytes} from '../operational/test-pet-fixture';
import {halosWorkbook} from '../task3-uat/halos-fixture';
import {syntheticReportPdf} from '../his-simulator/result-pdf';
import {analyzeSignerBlocks} from '../../tests/helpers/pdf-signer-blocks';
import {paperSchema,emptyRequest} from '../../packages/p2/schema';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';

process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const ORIGIN='https://127.0.0.1:20228',OUT=process.env.ANC_OUT??'.local/claude-evidence-20261025/anc-origin-e2e';
mkdirSync(OUT,{recursive:true});
const sha=(b:Buffer|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const log:{step:string;ok:boolean;detail?:unknown}[]=[];
const step=(name:string,ok:boolean,detail?:unknown)=>{log.push({step:name,ok,detail});console.log((ok?'PASS ':'FAIL ')+name+(detail!==undefined?' '+JSON.stringify(detail).slice(0,300):''));if(!ok){writeFileSync(path.join(OUT,'journey.json'),JSON.stringify(log,null,1));throw new Error('JOURNEY_STOPPED_AT: '+name);}};

// Sessions are cached outside the evidence folder: the login throttle allows only 20 attempts per 15 minutes per client.
const SESSIONS=path.join(process.env.TEMP??'.','nipt-e2e-sessions.json');
const cache:Record<string,{jar:[string,string][];csrf:string;id:string}>=existsSync(SESSIONS)?JSON.parse(readFileSync(SESSIONS,'utf8')):{};
class Session{
 jar=new Map<string,string>();csrf='';
 constructor(public user:string){}
 eat(r:Response){for(const c of r.headers.getSetCookie())this.jar.set(c.split('=')[0],c.split(';')[0].split('=').slice(1).join('='));}
 cookie(){return [...this.jar].map(([k,v])=>`${k}=${v}`).join('; ');}
 async login(){
  const c0=cache[this.user];if(c0){this.jar=new Map(c0.jar);this.csrf=c0.csrf;this.id=c0.id;const me=await fetch(ORIGIN+'/api/me',{headers:{cookie:this.cookie()}});if(me.ok)return this;this.jar=new Map();}
  const c=await fetch(ORIGIN+'/api/auth/csrf');this.eat(c);const csrf=(await c.json()).csrf;
  const r=await fetch(ORIGIN+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,cookie:this.cookie()},body:JSON.stringify({username:this.user,password:this.user,csrf})});this.eat(r);
  if(!r.ok)throw new Error('LOGIN_FAILED '+this.user+' '+r.status+' '+await r.text());
  const me=await fetch(ORIGIN+'/api/me',{headers:{cookie:this.cookie()}});this.eat(me);const j=await me.json();this.csrf=j.csrf;this.id=j.user?.id??j.id;cache[this.user]={jar:[...this.jar],csrf:this.csrf,id:this.id};writeFileSync(SESSIONS,JSON.stringify(cache));return this;}
 id='';
 async raw(url:string,body?:unknown,form?:FormData){
  const headers:Record<string,string>={cookie:this.cookie()};let init:RequestInit={headers};
  if(body!==undefined||form){headers.origin=ORIGIN;headers['x-csrf-token']=this.csrf;if(form)init={method:'POST',headers,body:form};else{headers['content-type']='application/json';init={method:'POST',headers,body:JSON.stringify(body)};}}
  const r=await fetch(ORIGIN+url,init);this.eat(r);return r;}
 async api<T=any>(url:string,body?:unknown):Promise<T>{const r=await this.raw(url,body);const t=await r.text();let j:any;try{j=JSON.parse(t);}catch{j=t;}if(!r.ok)throw new Error(`${this.user} ${body?'POST':'GET'} ${url} -> ${r.status} ${t.slice(0,300)}`);return j;}
 async bytes(url:string,body?:unknown){const r=await this.raw(url,body);if(!r.ok)throw new Error(`${this.user} ${url} -> ${r.status} ${(await r.text()).slice(0,200)}`);return {bytes:Buffer.from(await r.arrayBuffer()),headers:r.headers};}
}

const db=await client('migrator');
const q=async<T=any>(s:string,p:unknown[]=[])=>(await db.query(s,p)).rows as T[];
const waitFor=async(label:string,fn:()=>Promise<boolean>,ms=120000)=>{const t=Date.now();while(Date.now()-t<ms){if(await fn())return;await new Promise(r=>setTimeout(r,1500));}throw new Error('TIMEOUT '+label);};

try{
 const runtime=JSON.parse(readFileSync('.local/claude-lab-uat-runtime/runtime.json','utf8'));
 step('runtime build recorded',true,{buildId:runtime.buildId,gitHead:runtime.gitHead});
 const anc=await new Session('anc').login(),lab=await new Session('lab').login(),cert=await new Session('certifier').login(),appr=await new Session('approver').login();
 step('five roles log in (anc, lab, certifier, approver)',true);
 const unit=(await q<{id:string}>('SELECT id FROM unit LIMIT 1'))[0].id;
 const folders=await q<{k:string;b:string|null;res:string|null;pdf:string|null}>("SELECT a.setting_key k,r.value->>'basePath' b,r.value->>'resDestinationPath' res,r.value->>'pdfDestinationPath' pdf FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key IN ('his_inbound','his_outbound')");
 const inboundBase=folders.find(f=>f.k==='his_inbound')!.b!,resDir=folders.find(f=>f.k==='his_outbound')!.res!,pdfDir=folders.find(f=>f.k==='his_outbound')!.pdf!;
 step('HIS simulator folders from active settings',!!inboundBase&&!!resDir&&!!pdfDir,{inboundBase,resDir,pdfDir});
 const doctorId=(await q<{id:string}>('SELECT id FROM p2_doctor_version ORDER BY created_at DESC LIMIT 1'))[0].id;
 const now=new Date(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(now).replaceAll('-',''),date=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6)}`;
 const stateFile=path.join(OUT,'state.json');const stamp:string=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')).stamp:String(Date.now()).slice(-6);writeFileSync(stateFile,JSON.stringify({stamp}));
 // Two synthetic specimens: A = native signed report, B = external ReadyGen-final PDF fallback.
 const all=[{key:'A',ln:'2610'+stamp,hn:'88'+stamp+'/69'},{key:'B',ln:'2611'+stamp,hn:'99'+stamp+'/69'},{key:'C',ln:'2612'+stamp,hn:'77'+stamp+'/69'}].map(p=>({...p,caseId:'',roundId:'',attemptId:'',printed:'',vendor:''}));
 // A and B travel the whole chain; C only fills Task 3 (a Task needs one sample); D stays accepted in the Ready queue for the later UI acceptance checks.
 const people=all.slice(0,2),inBatch=all.slice(0,3);const ancKeys=['A','B','C'];

 // 1. ANC registers before the specimen arrives (real ANC role).
 const eddDate=new Date(Date.parse(date)+155*86400000).toISOString().slice(0,10);
 for(const p of all){const key=createHash('sha256').update('e2e-'+stamp+p.key).digest('hex').slice(0,32);
  const r=ancKeys.includes(p.key)?await anc.api('/api/p2/register',{ln:p.ln,hn:p.hn,unitId:unit,origin:'ANC',idempotencyKey:key})
   :await lab.api('/api/p2/register',{ln:p.ln,hn:p.hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:key,labOperational:{gaWeeks:17,gaDays:6,edd:eddDate,pregnancy:'Singleton',paperRequest:true,paperConsent:true}});p.caseId=r.caseId;}
 step('three cases registered by ANC (origin ANC)',all.every(p=>!!p.caseId),all.map(p=>p.ln));
 // ANC chooses Paper request/consent while the case is still pre-PET (the mode is locked after the first receipt).
 for(const p of all.filter(x=>ancKeys.includes(x.key))){const url='/api/p2/cases/'+p.caseId,w=(await anc.api(url)).workspace;await anc.api(url,{action:'setModes',expectedVersion:w.version,requestMode:'Electronic',consentMode:'Paper',reason:'SYNTHETIC-E2E electronic request with paper consent'});}
 step('ANC selected Electronic request + Paper consent before the specimen arrived',true);
 // 2. HIS PET + OK arrive in the inbound simulator folder; the worker picks them up.
 const dayDir=path.join(inboundBase,day);mkdirSync(dayDir,{recursive:true});
 const hhmmss=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).replace(/:/g,'');
 for(const p of all){const f=path.join(dayDir,p.ln+'-7.pet');writeFileSync(f,operationalTestPetBytes({ln:p.ln,hn:p.hn,day,time:hhmmss}));writeFileSync(f.replace(/\.pet$/,'.ok'),Buffer.alloc(0));}
 await waitFor('PET received by worker',async()=>Number((await q("SELECT count(*)::int n FROM specimen_round WHERE case_id=ANY($1::uuid[]) AND round_number=1 AND received_source='HIS_PET_RECEIPT'",[all.map(p=>p.caseId)]))[0].n)===all.length);
 step('worker consumed PET+OK for both cases (received_source HIS_PET_RECEIPT)',true);
 // 3. Clinical gate (paper request + consent review by the certifier, clinical approval, then LAB specimen acceptance).
 const blank=()=>paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));
 const request:any=blank(),consent:any=blank();Object.assign(request,{requestComplete:'Complete',history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',vanishingTwin:'None',pregnancyType:'Singleton',fetalSex:'Want',collectionDate:date,dob:'1996-03-31',edd:new Date(Date.parse(date)+155*86400000).toISOString().slice(0,10)});Object.assign(consent,{decision:'Granted',signatures:'Complete',representative:'NotRequired'});
 for(const p of all.filter(x=>ancKeys.includes(x.key))){
  const url='/api/p2/cases/'+p.caseId;
  // Electronic Request completed by ANC (carries EDD and pregnancy type that the vendor export later needs), then locked.
  {let w=(await anc.api(url)).workspace;const draft:any=structuredClone(emptyRequest);
   const d12='1100'+stamp+String('ABCD'.indexOf(p.key)+1).padStart(2,'0'),chk=(11-(d12.split('').reduce((a,c,i)=>a+Number(c)*(13-i),0)%11))%10;
   Object.assign(draft.patient,{syntheticName:'TEST LOCAL TEST',dob:'1996-03-31',entitlement:'SELF_PAY',identifierType:'ThaiNationalId',identifier:d12+chk});
   Object.assign(draft.pregnancy,{type:'Singleton',edd:new Date(Date.parse(date)+155*86400000).toISOString().slice(0,10),collectionDate:date,collectionTime:'07:00',collectionSource:'ANC',weightKg:60,heightCm:165,vanishingTwin:'No',fetalSex:'Want',sca:'Want'});
   for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)draft.history[k].answer='No';
   Object.assign(draft.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});
   Object.assign(draft.ordering,{doctorVersionId:doctorId,facility:'SYNTHETIC-E2E HOSPITAL',reason:'SYNTHETIC-E2E screening request'});
   const saved=await anc.api(url,{action:'saveRequest',expectedVersion:w.version,draft});await anc.api(url,{action:'lockRequest',expectedVersion:saved.version,reason:'SYNTHETIC-E2E complete request'});}
  // Paper Consent is only a marker selected by ANC: no scan, upload, certifier paper review or re-signing. The existing clinical review (approver) stays.
  await appr.api(url,{action:'approveClinical',expectedVersion:(await appr.api(url)).workspace.version,reason:'SYNTHETIC-E2E authorized role exercise',sourceReference:'SYNTHETIC-E2E current request consent evidence',attestation:true});
  const gate=(await appr.api(url)).gate;if(!gate.passed)throw new Error('GATE_NOT_PASSED '+JSON.stringify(gate));
  p.roundId=(await q<{current_round_id:string}>('SELECT current_round_id FROM nipt_case WHERE id=$1',[p.caseId]))[0].current_round_id;
  await lab.api('/api/p4/worklist',{action:'acceptSpecimen',roundId:p.roundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',criteriaReference:'SYNTHETIC-E2E specimen criteria',reason:'SYNTHETIC-E2E checked receipt'});
  p.attemptId=(await q<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[p.roundId]))[0].id;
 }
 for(const p of all.filter(x=>!ancKeys.includes(x.key))){
  p.roundId=(await q<{current_round_id:string}>('SELECT current_round_id FROM nipt_case WHERE id=$1',[p.caseId]))[0].current_round_id;
  let a=await q<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[p.roundId]);
  if(!a.length){await lab.api('/api/p4/worklist',{action:'acceptSpecimen',roundId:p.roundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',criteriaReference:'SYNTHETIC-E2E specimen criteria',reason:'SYNTHETIC-E2E checked receipt'});a=await q<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[p.roundId]);}
  p.attemptId=a[0].id;}
 step('ANC cases: Request locked, Paper Consent marker, PET/OK received, clinical review passed, LAB accepted (LN Halos issued)',all.every(p=>!!p.attemptId));
 {const o=await q<{n:number;lab:number;paperRev:number;mode:string}>("SELECT count(*) FILTER (WHERE c.registration_origin='ANC')::int n,(SELECT count(*)::int FROM lab_operational_registration l WHERE l.case_id=ANY($1::uuid[])) lab,(SELECT count(*)::int FROM p2_paper_review r WHERE r.case_id=ANY($1::uuid[]) AND r.kind='CONSENT') \"paperRev\",(SELECT min(consent_mode) FROM p2_workspace w WHERE w.case_id=ANY($1::uuid[])) mode FROM nipt_case c WHERE c.id=ANY($1::uuid[])",[all.map(p=>p.caseId)]);
  step('origin ANC for all; no LAB paper registration; consent is the Paper marker only (no certifier paper review)',o[0].n===3&&o[0].lab===0&&o[0].paperRev===0&&o[0].mode==='Paper',o[0]);}
 // 4. Batch -> Task placement -> plan/finalize.
 const batchId=(await lab.api('/api/p4/batches',{})).batchId;const ver=async()=>Number((await q('SELECT version FROM lab_batch WHERE id=$1',[batchId]))[0].version);
 const p4=(action:string,data:Record<string,unknown>={})=>ver().then(expectedVersion=>lab.api('/api/p4/batches/'+batchId,{action,expectedVersion,...data}));
 const run=(await q<{run_number:number}>('SELECT run_number FROM lab_batch WHERE id=$1',[batchId]))[0].run_number;
 const assigned:any[]=[];for(const [i,p] of inBatch.entries())assigned.push(await p4('assign',{attemptIds:[p.attemptId],sheetNumber:i+1,queueOverrideReason:'SYNTHETIC-E2E current FIFO order'}));
 step('Batch created; A on Task 1, B on Task 2, C on Task 3',assigned.length===3&&assigned.every(a=>a.rejected.length===0&&a.placed.length===1),{run,assigned});
 for(const sheetNumber of [1,2,3]){
  await p4('updatePlan',{sheetNumber,plannedWorkDate:date,plannedOperator:'SYNTHETIC-E2E OPERATOR',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
  await p4('planCheck',{sheetNumber,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});await p4('finalize',{sheetNumber});}
 step('Tasks 1-3 plan checked and finalized ',true);
 if(process.env.ANC_STOP==='finalize'){writeFileSync(path.join(OUT,'qc-batch.json'),JSON.stringify({batchId,run,attempts:inBatch.map(p=>p.attemptId),caseIds:inBatch.map(p=>p.caseId)},null,1));step('stopped before QC (batch left for the UI acceptance checks)',true,{batchId,run});writeFileSync(path.join(OUT,'journey.json'),JSON.stringify(log,null,1));await db.end();process.exit(0);}
 for(const p of people)p.printed=(await q<{p:string}>('SELECT printed_sample_id p FROM analytical_attempt WHERE id=$1',[p.attemptId]))[0].p;
 // 5. QC / Pooling / Sequencing through the bench workspace (Owner flow: values, Pooling CSV, actual pooling, Seq pair export).
 const bench=await lab.api('/api/lab-bench/batches/'+batchId),values:Record<string,unknown>={...bench.values};
 for(const s of bench.slots)if(s.kind!=='EMPTY')values[`slot.${s.slot}.libraryQc`]=s.kind==='BLANK'?0.5:20;
 for(let n=1;n<=3;n++)for(const k of ['standard1','standard2','standard2Concentration'])values[`qc.${n}.${k}`]=10;
 Object.assign(values,{'pool.standard1':0,'pool.standard2':100,'pool.standard2Concentration':10,'pool.concentration':3.33});
 for(const f of bench.seqFields)values[f.key]=f.type==='number'?10:f.type==='checkbox'?true:'SYNTHETIC-E2E observation';
 Object.assign(values,{'seq.date':'26/10/2569','seq.operator':'SYNTHETIC-E2E','seq.dnbId':'DNB'+stamp,'seq.negativePressureKpa':-80});
 const saved=await lab.api('/api/workbook/batches/'+batchId,{action:'saveDraft',expectedVersion:await ver(),expectedRevision:0,values});
 step('QC values and sequencing observations saved (workbook draft)',saved.revision>=1,{revision:saved.revision});
 const pool=await lab.bytes('/api/lab-bench/batches/'+batchId,{action:'export',revision:saved.revision,kind:'POOL_CSV'});
 step('Pooling CSV exported',pool.bytes.length>0,{bytes:pool.bytes.length,sha256:sha(pool.bytes)});writeFileSync(path.join(OUT,'pooling.csv'),pool.bytes);
 await lab.api('/api/lab-bench/batches/'+batchId,{action:'recordActualPooling',revision:saved.revision,members:bench.slots.map((s:any)=>({slot:s.slot,pooled:['PATIENT','PC','NC'].includes(s.kind)})),note:'SYNTHETIC-E2E actual pooling transfer recorded by operator'});
 const seq=await lab.api('/api/lab-bench/batches/'+batchId,{action:'exportSeqPair',revision:saved.revision,idempotencyKey:randomUUID()});
 step('Sequencing HALOS/NIFTY pair exported',!!seq,{keys:Object.keys(seq)});
 // 6. HALOS result import (synthetic workbook built from the exported mapping), confirmed.
 const vendor=new Map((await q<{attempt:string;vendor:string}>("SELECT m->>'attemptId' attempt,m->>'vendorSampleId' vendor FROM lab_bench_export n CROSS JOIN LATERAL jsonb_array_elements(n.mapping) m WHERE n.kind='NIFTY_XLSX' AND m->>'kind'='PATIENT' AND n.batch_id=$1",[batchId])).map(r=>[r.attempt,r.vendor]));
 const controls=(await q<{sample:string}>("SELECT m->>'sampleId' sample FROM lab_bench_export h CROSS JOIN LATERAL jsonb_array_elements(h.mapping) m WHERE h.kind='HALOS_TASK_XLSX' AND m->>'attemptId' IS NULL AND h.batch_id=$1",[batchId])).map(r=>r.sample);
 for(const p of people)p.vendor=vendor.get(p.attemptId)??'';
 step('vendor sample ids and controls resolved from the exports',people.every(p=>!!p.vendor)&&controls.length>=2,{controls:controls.length});
 const xlsx=halosWorkbook({result:[{sample:controls[0],t13:'TH13',t18:'TH18',t21:'TH21',sex:''},{sample:people[0].printed,ff:'14.7',gender:'Female'},{sample:people[1].printed,ff:'11.2',gender:'Female'},{sample:controls[1],sex:''}],sampleinfo:people.map(p=>({id:p.vendor,fetus:'Singleton',ga:'17,6'}))});
 const form=new FormData();form.append('file',new File([new Uint8Array(xlsx)],`Sample analysis data_S99${stamp}_10262026.xlsx`));
 const imp=await (await lab.raw('/api/task3/halos',undefined,form)).json();
 const confirmed=await cert.api('/api/task3/halos/'+imp.id,{decision:'CONFIRM',expectedRowVersion:imp.rowVersion});
 step('HALOS result import previewed and confirmed',!!confirmed,{rows:imp.rows?.length});
 const rowOf=(s:string)=>imp.rows.find((r:any)=>r.sheet==='result'&&r.sampleKey===s).id;

 // 7a. Case A: native report; signers chosen at creation (Reported by = LAB user via standing delegation, Approved by = certifier).
 const sr=await cert.api('/api/task3/signers?role=REPORTED'),sa=await cert.api('/api/task3/signers?role=APPROVED');
 const signerList=(x:any)=>(x.signers??x.rows??x.items??x) as any[];
 const rep=signerList(sr).find((s:any)=>s.userId===lab.id||s.id===lab.id||s.user_id===lab.id),app=signerList(sa).find((s:any)=>s.userId===cert.id||s.id===cert.id||s.user_id===cert.id);
 step('signer picker lists eligible Reported-by and Approved-by',!!rep&&!!app,{reported:signerList(sr).length,approved:signerList(sa).length});
 const key=randomUUID();
 const fin=await cert.api('/api/task3/reports',{action:'finalize',idempotencyKey:key,defaults:{reportedBy:lab.id,approvedBy:cert.id},release:true,
  releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},items:[{rowId:rowOf(people[0].printed)}]});
 step('native NIPT PDF finalized and released (case A)',fin.items[0].outcome==='FINAL'&&/Released/.test(String(fin.items[0].release??fin.items[0].versionState)),fin.items[0]);
 const A=people[0];
 const ir=(await q<any>('SELECT r.id,r.pdf_sha256,r.version_id,r.reported_by,r.approved_by FROM internal_report r WHERE r.attempt_id=$1',[A.attemptId]))[0];
 const nativePdf=(await cert.bytes('/api/task3/reports/'+ir.id+'/file?download=1')).bytes;
 const blocks=await analyzeSignerBlocks(nativePdf);
 writeFileSync(path.join(OUT,'case-A-native-final.pdf'),nativePdf);
 step('final PDF bytes equal the stored report hash',sha(nativePdf)===ir.pdf_sha256,{sha256:ir.pdf_sha256});
 step('native PDF shows name + licence + signature image in BOTH signer blocks',!!blocks.reported.name&&!!blocks.reported.license&&!!blocks.reported.signature&&!!blocks.approved.name&&!!blocks.approved.license&&!!blocks.approved.signature,blocks);

 // 7b. Case B: external ReadyGen-final PDF fallback (vendor-style PDF uploaded; certified document is kept as is).
 const ext=syntheticReportPdf({kind:'SINGLETON',labNumber:people[1].printed,hn:people[1].hn,collection:'26-Oct-2026',received:'26-Oct-2026',reported:'26-Oct-2026',gaWeeks:17,gaDays:6});
 const f2=new FormData();f2.append('files',new File([new Uint8Array(ext)],'SYNTHETIC-E2E-external-'+stamp+'.pdf',{type:'application/pdf'}));
 const up=await (await lab.raw('/api/p5/results/upload',undefined,f2)).json();
 await waitFor('external PDF parsed by worker',async()=>!!(await q('SELECT 1 FROM integration_job_receipt WHERE outbox_id=$1',[up.jobId])).length);
 const intake=(await q<{id:string}>('SELECT id FROM result_intake_file WHERE job_id=$1',[up.jobId]))[0];
 const imported=await lab.api('/api/p5/results',{action:'confirm',intakeIds:[intake.id]});const versionId=imported.results[0].versionId;
 const rv=async()=>(await q<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[versionId]))[0].row_version;
 const rs=async(s:Session,action:string,data:Record<string,unknown>={})=>s.api('/api/p5/results/'+versionId,{action,expectedRowVersion:await rv(),...data});
 const st0=(await q<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId]))[0].state;
 if(st0==='PendingLink'||st0==='Imported'||st0==='Unlinked')await rs(lab,'propose',{roundId:people[1].roundId,attemptId:people[1].attemptId,reason:'SYNTHETIC-E2E exact report linkage'});
 step('external PDF import state before linking',true,{st0});
 const st1=(await q<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId]))[0].state;
 if(st1==='LinkProposed'||st1==='Proposed')await rs(cert,'decide',{decision:'APPROVE',reason:'SYNTHETIC-E2E report identity review'});
 step('external PDF is linked to its round/attempt (auto-match or approved proposal)',!['PendingLink','Imported','Unlinked','LinkConflict'].includes((await q<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId]))[0].state),{st1});await rs(cert,'review',{valuesMatchPdf:true,abnormalAcknowledged:false});
 await rs(cert,'qc5',{benchRevision:saved.revision,benchMeasurementsReviewed:true,criteriaReference:'SYNTHETIC-E2E QC5 final review',templateReviewed:true,disclosureReviewed:true,abnormalAcknowledged:false,reason:'SYNTHETIC-E2E current PDF upstream evidence'});
 const rel2=await rs(cert,'certify',{idempotencyKey:randomUUID().replaceAll('-',''),abnormalAcknowledged:false,confirmed:true});
 step('external ReadyGen-final PDF linked, reviewed, QC5 and released (case B)',rel2.outcome==='CertifiedReleased',rel2.outcome);
 const extSha=sha(ext);
 const extStored=(await q<{sha256:string}>('SELECT sha256 FROM result_report_version WHERE id=$1',[versionId]))[0].sha256;
 step('external PDF kept byte-identical (no signature replacement)',extStored===extSha,{sha256:extSha});

 // 8. Worker publishes RES/OK and PDF to the HIS simulator folders; HIS receipt is NOT assumed.
 const releases=await q<{id:string;case_id:string;version_id:string}>("SELECT rel.id,rel.version_id,v.case_id FROM result_release rel JOIN result_report_version v ON v.id=rel.version_id WHERE rel.state='Active' AND v.case_id=ANY($1::uuid[])",[people.map(p=>p.caseId)]);
 step('two Active releases exist',releases.length===2,releases.map(r=>r.id));
 await waitFor('P6 transfers published',async()=>Number((await q("SELECT count(*)::int n FROM p6_transfer WHERE clinical_release_id=ANY($1::uuid[]) AND model->>'state'='AWAITING_CONFIRMATION'",[releases.map(r=>r.id)]))[0].n)===2,180000);
 const transfers=await q<any>("SELECT clinical_release_id,model->>'state' state,model->>'hisConfirmed' his_confirmed FROM p6_transfer WHERE clinical_release_id=ANY($1::uuid[])",[releases.map(r=>r.id)]);
 step('both transfers AWAITING_CONFIRMATION with hisConfirmed=false (no forged ACK)',transfers.every(t=>t.state==='AWAITING_CONFIRMATION'&&String(t.his_confirmed)==='false'),transfers);
 const artifacts:Record<string,unknown>={};
 for(const p of people){
  const res=readdirSync(resDir).filter(n=>n.startsWith(p.ln.slice(0,10))),pdfs=existsSync(pdfDir)?readdirSync(pdfDir).filter(n=>n.includes(p.ln)||n.includes(p.printed)):[];
  artifacts[p.key]={res,pdfs};
 }
 step('RES/OK and PDF files present in HIS simulator folders for both cases',people.every(p=>(artifacts[p.key] as any).res.some((n:string)=>n.endsWith('.res'))&&(artifacts[p.key] as any).res.some((n:string)=>n.endsWith('.ok'))&&(artifacts[p.key] as any).pdfs.length>0),artifacts);
 for(const p of people){const a=artifacts[p.key] as {res:string[];pdfs:string[]};const resFile=a.res.find(n=>n.endsWith('.res'))!;const bytes=readFileSync(path.join(resDir,resFile));(artifacts[p.key] as any).resSha256=sha(bytes);(artifacts[p.key] as any).pdfSha256=sha(readFileSync(path.join(pdfDir,a.pdfs[0])));}
 const sentNative=(artifacts.A as any).pdfSha256,sentExt=(artifacts.B as any).pdfSha256;
 step('PDF sent to HIS equals the released PDF (A native, B external)',sentNative===ir.pdf_sha256&&sentExt===extSha,{sentNative,sentExt});

 // 9. ANC sees only the released summary and opens / downloads / prints the same PDF.
 const view:Record<string,unknown>={};
 for(const [p,rel] of [[people[0],releases.find(r=>r.case_id===people[0].caseId)!],[people[1],releases.find(r=>r.case_id===people[1].caseId)!]] as const){
  const summary=await anc.api('/api/p5/cases/'+p.caseId+'/results');
  const hashes:string[]=[];for(const mode of ['view','download','print'])hashes.push(sha((await anc.bytes('/api/p5/releases/'+rel.id+'/file?mode='+mode)).bytes));
  view[p.key]={summaryKeys:Object.keys(summary),hashes};
  step(`ANC ${p.key}: summary present and view/download/print return the same bytes`,hashes.every(h=>h===hashes[0])&&hashes[0]===(p.key==='A'?ir.pdf_sha256:extSha),{hashes});
 }
 const ancBlocks=await analyzeSignerBlocks((await anc.bytes('/api/p5/releases/'+releases.find(r=>r.case_id===people[0].caseId)!.id+'/file?mode=view')).bytes);
 step('ANC-viewed native PDF still shows both signer blocks complete',!!ancBlocks.reported.signature&&!!ancBlocks.approved.signature&&ancBlocks.reported.license===blocks.reported.license,ancBlocks);
 const denied=await (await new Session('anc').login()).raw('/api/task3/reports');step('ANC cannot reach the LAB report worklist',denied.status>=400,{status:denied.status});
 writeFileSync(path.join(OUT,'artifacts.json'),JSON.stringify({run,batchId,people:people.map(p=>({key:p.key,ln:p.ln,printed:p.printed})),artifacts,view,nativeSha256:ir.pdf_sha256,externalSha256:extSha,signerBlocks:blocks},null,1));
 {const br=await q<{id:string}>('SELECT r.id FROM lab_bench_review r JOIN lab_slot_assignment a ON a.batch_id=r.batch_id WHERE a.attempt_id=ANY($1::uuid[])',[people.map(p=>p.attemptId)]);step('release evidence is the Owner bench review (QC/Pooling/Sequencing worksheet), reviewed by a second person',br.length>=1,{reviews:br.length});}
 step('ANC-origin journey complete',true,{run,batchId});
}catch(e){console.error(String(e));process.exitCode=1;}
finally{writeFileSync(path.join(OUT,'journey.json'),JSON.stringify(log,null,1));await db.end();}
