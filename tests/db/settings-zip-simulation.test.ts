import {describe,it,expect,beforeAll,afterAll,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import iconv from 'iconv-lite';
import type {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {testDatabase,addUser} from '../helpers/database';
import {labUsers} from '../helpers/lab';
import type {Principal} from '../../packages/security/policy';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import {configureOperational} from '../../tools/configure-operational';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting} from '../../packages/settings/service';
import {requestHisTest,activeHis,bindActiveOutboundSettings} from '../../packages/settings/his';
import {hisMonitoring} from '../../packages/settings/his-monitoring';
import {executeInboundJob} from '../../packages/jobs/his';
import {runHisSettingsTest} from '../../packages/jobs/his-settings-test';
import {persistJobResult} from '../../packages/jobs/worker';
import {lookbackFolders} from '../../packages/inbound/discovery';
import {parsePet} from '../../packages/integrations/pet';
import {registerP2} from '../../packages/p2/service';
import {FileStore,sha256} from '../../packages/storage';
import {extract} from '../../packages/results/extract';
import {parseReport} from '../../packages/results/parser';
import {resultSettings,limitsOf,confirmImport,acceptAndRelease,certifyAttempt} from '../../packages/results/service';
import {previewFolderFiles,resultFolderSettingValid} from '../../packages/results/folder';
import {runResultJob} from '../../packages/results/jobs';
import {releaseOrderFromPet,releaseResultFromParsed} from '../../packages/p6/released-result';
import {syntheticProfile,type ResProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';
import {registerFixture,reserveFixture,loadTransfer,readHistory} from '../../packages/p6/journal';
import {runTransfer} from '../../packages/p6/worker';
import {settingsErrorMessage} from '../../src/server/settings-errors';

// Settings operational acceptance, driven by the original sample files of NIPTY_handover.zip (synthetic "TestPatient" set, README:
// "ข้อมูลสมมติทั้งหมด"). Point NIPT_LEGACY_HANDOVER_FIXTURES_DIR at a read-only extraction that carries MANIFEST.json (archive SHA-256
// and each file's ZIP entry + SHA-256). Nothing from the ZIP is copied into the repository; files are only copied into temporary
// loopback folders that the Settings point at. Real hospital shares, HIS and CFS are never contacted.
const FIX=process.env.NIPT_LEGACY_HANDOVER_FIXTURES_DIR;
const HANDOVER_SHA='332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c';
type Manifest={archive:string;archiveSha256:string;files:Record<string,{zipEntry:string;sha256:string;size:number}>};
const manifest=():Manifest=>JSON.parse(readFileSync(path.join(FIX!,'MANIFEST.json'),'utf8'));
/** Every fixture byte is checked against the manifest written when it was read out of the ZIP. */
function zipFile(rel:string){const m=manifest().files[rel];if(!m)throw Error('NOT_IN_ZIP_MANIFEST '+rel);const b=readFileSync(path.join(FIX!,rel));if(sha256(b)!==m.sha256)throw Error('FIXTURE_CHANGED '+rel);return b;}
const csv=(text:string)=>{const rows:string[][]=[];for(const line of text.replace(/^﻿/,'').split(/\r?\n/).filter(Boolean)){const out:string[]=[];let cur='',q=false;for(const ch of line){if(ch==='"'){q=!q;continue;}if(ch===','&&!q){out.push(cur);cur='';continue;}cur+=ch;}out.push(cur);rows.push(out);}return rows;};
function cases(){const [h,...rows]=csv(zipFile('samples/cases.csv').toString('utf8'));return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])) as Record<string,string>);}
const snapshotTree=async(dir:string)=>{const out:Record<string,string>={};const walk=async(d:string)=>{for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else{const st=await fs.stat(p);out[path.relative(dir,p)]=sha256(await fs.readFile(p))+':'+st.mtimeMs;}}};await walk(dir);return out;};

describe.skipIf(!FIX||!existsSync(path.join(FIX??'','MANIFEST.json')))('Settings → Worker/Consumer → observable result, with NIPTY_handover.zip sample files',()=>{
 let db:PGlite,root:string,admin:Principal,checker:Principal,anc:Principal,lab:Awaited<ReturnType<typeof labUsers>>,store:FileStore,unit:string;
 const key=Buffer.alloc(32,7),today=lookbackFolders(1,new Date())[0];
 const policyFile=()=>path.join(root,'policy.json');
 const writePolicy=(account=workerServiceAccount(),mode='operational')=>fs.writeFile(policyFile(),JSON.stringify({version:1,grants:[{root:path.join(root,'share'),purposes:['INBOUND','OUTBOUND','RESULTS'],serviceAccount:account,secretRef:null,mode}]}));
 async function workerValidate(id:string,user=admin):Promise<Record<string,unknown>>{const q=await requestHisTest(db,user,id);if(q.queued){const job=(await db.query<{payload:unknown}>('SELECT payload FROM job_outbox WHERE id=$1',[q.jobId])).rows[0];const r=await runHisSettingsTest(db,job.payload);await persistJobResult(db,q.jobId,r);if(!(r as {passed?:boolean}).passed)return r;}await requestHisTest(db,user,id);return {passed:true};}
 async function activateHis(k:'his_inbound'|'his_outbound',value:unknown,reason='Settings ZIP simulation'){const id=await proposeSetting(db,admin,k,value,reason);const r=await workerValidate(id);expect(r).toMatchObject({passed:true});await approveSetting(db,checker,id);await activateSetting(db,checker,id);return id;}
 const share=(...p:string[])=>path.join(root,'share',...p);
 async function place(dir:string,day:string,petRel:string,withOk=true,bytes?:Buffer){const folder=share(dir,day);await fs.mkdir(folder,{recursive:true});const name=path.basename(petRel);await fs.writeFile(path.join(folder,name),bytes??zipFile(petRel));if(withOk)await fs.writeFile(path.join(folder,name.replace(/\.pet$/,'.ok')),zipFile(petRel.replace(/\.pet$/,'.ok')));return path.join(folder,name);}
 async function register(ln:string,hn:string){await db.query('BEGIN');const r=await registerP2(db,anc as never,{ln,hn,unitId:unit,origin:'ANC',idempotencyKey:'ZIP-SIMULATION-'+ln},key);await db.query('COMMIT');return r;}
 const scan=(payload:Record<string,unknown>={trigger:'MANUAL'})=>executeInboundJob(db,'synthetic_scan',payload,store,key);
 const fileState=async(ln:string)=>(await db.query<{state:string;error_code:string|null}>('SELECT state,error_code FROM his_inbound_file WHERE ln=$1 ORDER BY path_version,sha256',[ln])).rows;

 beforeAll(async()=>{
  expect(manifest()).toMatchObject({archive:'NIPTY_handover.zip',archiveSha256:HANDOVER_SHA});
  db=await testDatabase();root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-settings-zip-'));for(const d of ['in-a','in-b','results-a','results-b','res','pdf','backup'])await fs.mkdir(share(d),{recursive:true});
  admin=await addUser(db,'APP_ADMIN','zip.admin');checker=await addUser(db,'CLINICAL_APPROVER','zip.checker');lab=await labUsers(db);
  unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ZIPSIM','หน่วยจำลอง ZIP') RETURNING id")).rows[0].id;anc={...(await addUser(db,'ANC_NURSE','zip.anc')),unitIds:[unit]};
  store=new FileStore(path.join(root,'files'));await writePolicy();
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.zip-simulation.invalid');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',policyFile());
  expect(await configureOperational(db)).toEqual({configured:true});
 },120000);
 afterAll(async()=>{vi.unstubAllEnvs();await db?.close();if(root)await fs.rm(root,{recursive:true,force:true});});

 it('A. PET reception: Settings path → worker → registry/worklist; read-only source; missing OK, duplicate, invalid, non-NIPT and identity conflict',async()=>{
  const rows=cases();
  for(const n of [1,2,3,4,5])await place('in-a',today,`samples/request_pet/${rows[n-1].request_file}`);
  for(const f of ['2622270900-7.pet','2622270901-7.pet','2622270100-7.pet','2622110001-1.pet','26220600001-60.pet','2622270902-7.pet'])await place('in-a',today,`pet-fixtures/${f}`);
  await place('in-a',today,'pet-fixtures/2622370099-7.pet',false); // the ZIP itself has no .ok for this one
  for(const n of [1,2,3,4])expect((await register(rows[n-1].order_LN,rows[n-1].HN)).outcome).toBe('CREATED');
  expect((await register(rows[4].order_LN,'99000555')).outcome).toBe('CREATED'); // case 5 registered with a different HN
  const before=await snapshotTree(share('in-a'));
  const first=await activateHis('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:share('in-a'),lookbackDays:1});
  const r=await scan();
  expect(r).toMatchObject({configurationId:first,outcome:'SUCCESS'}); // invalid files are counted, they do not fail the scan
  expect(r.counts).toMatchObject({petSeen:12,stored:6,waitingOk:1,parseError:2,notNipt:3,outcome_APPLIED_S1:4,outcome_IDENTITY_MISMATCH:1,outcome_UNLINKED:1});
  expect((await hisMonitoring(db)).inboundWorker.lastScan?.counts).toMatchObject({parseError:2,waitingOk:1});
  // Registry: the four matching cases are received at the HIS receipt time P[21]; case 5 is held for identity review.
  for(const n of [1,2,3,4]){const pet=parsePet(zipFile(`samples/request_pet/${rows[n-1].request_file}`),rows[n-1].request_file);
   const round=(await db.query<{received_at:Date;received_source:string}>('SELECT r.received_at,r.received_source FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1 AND r.round_number=1',[pet.ln])).rows[0];
   expect(round).toEqual({received_at:new Date(pet.receivedAt),received_source:'HIS_PET_RECEIPT'});}
  expect(await fileState(rows[4].order_LN)).toEqual([{state:'Unlinked',error_code:null}]);
  expect((await db.query<{kind:string}>("SELECT i.kind FROM his_intake_issue i JOIN his_inbound_file f ON f.id=i.inbound_file_id WHERE f.ln=$1",[rows[4].order_LN])).rows.map(x=>x.kind)).toEqual(['IDENTITY_MISMATCH']);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1 AND r.received_at IS NOT NULL",[rows[4].order_LN])).rows[0].n).toBe(0);
  expect((await fileState('2622270900')).map(x=>x.error_code)).toEqual(['INVALID_FIELDS']);
  expect((await fileState('2622270901')).map(x=>x.state)).toEqual(['ParseError']);
  // Worklist: the received cases are in the Ready queue in receive-time order.
  const {labWorklist}=await import('../../packages/lab/intake');
  const wl=await labWorklist(db,{...lab.staff,unitIds:[unit]} as never) as {attempts:{hisLn:string;receivedAt:string|null}[]};
  const listed=wl.attempts.filter(a=>rows.slice(0,4).some(c=>c.order_LN===a.hisLn));expect(listed).toHaveLength(4);
  expect(listed.map(a=>a.receivedAt)).toEqual([...listed.map(a=>a.receivedAt)].sort());
  // The share is read only: same files, same bytes, same modification times; no .ok or marker written.
  expect(await snapshotTree(share('in-a'))).toEqual(before);
  // Missing .ok: once HIS writes the sentinel the waiting PET is read; re-reading is "unchanged", not a second receipt.
  await fs.writeFile(share('in-a',today,'2622370099-7.ok'),Buffer.alloc(0));
  const again=await scan();expect(again.counts).toMatchObject({okArrived:1,stored:1,unchanged:8,outcome_UNLINKED:1}); // empty citizen ID accepted as in legacy test_empty_citizen_id_ok
  // Duplicate: the same bytes in another day folder are the same content; a changed PET for a received LN is an integrity event.
  const yesterday=lookbackFolders(2,new Date())[0];
  await place('in-a',yesterday,`samples/request_pet/${rows[0].request_file}`);
  // Same LN, changed HIS receive time P[21] (one field of the ZIP PET edited).
  const lines=iconv.decode(zipFile(`samples/request_pet/${rows[1].request_file}`),'windows-874').split('\r\n'),pf=lines[1].split('|');pf[21]=pf[21].slice(0,8)+'093000';lines[1]=pf.join('|');
  const changed=iconv.encode(lines.join('\r\n'),'windows-874');
  await place('in-a',yesterday,`samples/request_pet/${rows[1].request_file}`,true,changed);
  await activateHis('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:share('in-a'),lookbackDays:2});
  const dup=await scan();expect(dup.counts).toMatchObject({sameContent:1,stored:1,outcome_S1_INTEGRITY_EVENT:1});
  const p2=parsePet(zipFile(`samples/request_pet/${rows[1].request_file}`),rows[1].request_file);
  expect((await db.query<{received_at:Date}>('SELECT r.received_at FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE l.ln=$1',[p2.ln])).rows[0].received_at).toEqual(new Date(p2.receivedAt));
 },120000);

 it('B. changing the inbound path while running: new path only, old configuration refused, errors visible, recovery and rollback',async()=>{
  const rows=cases(),old=(await activeHis(db,'his_inbound')).id;
  await place('in-b',today,`samples/request_pet/${rows[5].request_file}`);await register(rows[5].order_LN,rows[5].HN);
  const b=await activateHis('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:share('in-b'),lookbackDays:1});
  expect((await hisMonitoring(db)).inboundWorker).toMatchObject({activeRevisionId:b,usesActive:false}); // the panel shows the Worker has not used it yet
  await expect(scan({trigger:'INTERVAL',configurationId:old})).rejects.toThrow('HIS_CONFIGURATION_CHANGED'); // a queued old-configuration scan never runs
  await place('in-a',today,`samples/request_pet/${rows[6].request_file}`);await register(rows[6].order_LN,rows[6].HN); // arrives in the old folder
  const r=await scan();expect(r).toMatchObject({configurationId:b,counts:{stored:1,outcome_APPLIED_S1:1}});
  expect(await fileState(rows[6].order_LN)).toEqual([]); // the old folder is no longer read
  expect((await hisMonitoring(db)).inboundWorker).toMatchObject({usesActive:true,lastUsed:{revision_id:b},lastScan:{outcome:'SUCCESS'}});
  // Invalid path / outside the allowed root: the Worker test fails, so the draft cannot be approved or activated.
  for(const [p,code] of [[share('missing'),'SHARE_PATH_NOT_FOUND'],[path.join(os.tmpdir(),'not-allowed'),'SHARE_ROOT_NOT_ALLOWED']] as const){
   const id=await proposeSetting(db,admin,'his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:p},'Invalid path probe');
   expect(await workerValidate(id)).toMatchObject({passed:false,errorCode:code});
   await expect(approveSetting(db,checker,id)).rejects.toThrow('SETTING_NOT_VALIDATED');await expect(activateSetting(db,checker,id)).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  }
  expect(settingsErrorMessage(Object.assign(new Error('SETTING_APPROVAL_REQUIRED')))).toContain('ผู้ตรวจอีกคน');
  const invalid=await proposeSetting(db,admin,'his_inbound',{...SETTINGS.his_inbound.default,intervalSeconds:2},'Out of range').catch(e=>e);
  expect(settingsErrorMessage(invalid,'his_inbound')).toContain('รอบการสแกน');
  // Permission: the Worker runs under an account IT did not authorise → the scan fails visibly and recovers when access returns.
  await writePolicy('SOMEONE-ELSE');
  await expect(scan()).rejects.toThrow('SHARE_SERVICE_ACCOUNT_MISMATCH');
  expect((await hisMonitoring(db)).inboundWorker.lastScan).toMatchObject({outcome:'SHARE_UNAVAILABLE',error_code:'SHARE_SERVICE_ACCOUNT_MISMATCH'});
  await writePolicy();expect((await scan()).outcome).toBe('SUCCESS');
  // Rollback to the in-a revision is a new version (Worker test + second approval); after activation the old folder is read again.
  const archived=(await db.query<{id:string}>("SELECT id FROM settings_revision WHERE setting_key='his_inbound' AND state='Archived' AND value->>'basePath'=$1 AND (value->>'lookbackDays')::int=1 ORDER BY version LIMIT 1",[share('in-a')])).rows[0].id;
  const rb=await rollbackSetting(db,admin,archived,'Return to folder A');expect((await workerValidate(rb)).passed).toBe(true);await approveSetting(db,checker,rb);await activateSetting(db,checker,rb);
  expect((await scan()).counts).toMatchObject({outcome_APPLIED_S1:1});expect((await fileState(rows[6].order_LN)).map(x=>x.state)).toEqual(['Applied(S1)']);
  // enabled=false stops scanning (a queued interval scan is refused); the read-only connection test still works.
  await activateHis('his_inbound',{...SETTINGS.his_inbound.default,enabled:false,basePath:share('in-a'),lookbackDays:1},'Pause inbound scanning');
  await expect(scan({trigger:'INTERVAL'})).rejects.toThrow('SCAN_DISABLED');
  expect(await executeInboundJob(db,'synthetic_inbound_test',{},store,key)).toMatchObject({passed:true});
  await activateHis('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:share('in-a'),lookbackDays:1},'Resume inbound scanning');
 },120000);

 it('C. external result PDFs from the ZIP: Settings folder → worker scan/preview → parse equals cases.csv; P5-A never links an unclear match; switch folders',async()=>{
  const rows=cases(),root0=path.join(root,'unused-simulator');
  const sub=share('results-a','2026-08-08');await fs.mkdir(sub,{recursive:true});
  for(const n of [1,3,10])await fs.writeFile(path.join(sub,rows[n-1].bgi_file),zipFile(`samples/bgi_pdf/${rows[n-1].bgi_file}`));
  await fs.writeFile(share('results-a',rows[49].bgi_file),zipFile(`samples/bgi_pdf/${rows[49].bgi_file}`));
  await fs.writeFile(share('results-a','copy-of-'+rows[0].bgi_file),zipFile(`samples/bgi_pdf/${rows[0].bgi_file}`));
  expect(rows[49].HN).toBe(rows[50].HN); // README: cases 50/51 share one HN
  await register(rows[49].order_LN,rows[49].HN);await register(rows[50].order_LN,rows[50].HN);
  for(const n of [50,51])await place('in-a',today,`samples/request_pet/${rows[n-1].request_file}`);await scan();
  const activate=async(value:Record<string,unknown>)=>{const id=await proposeSetting(db,lab.certifier,'result_management',{...SETTINGS.result_management.default,...value},'ZIP simulation result folder');
   await validateSetting(db,lab.certifier,id,async(_k,v)=>resultFolderSettingValid(root0,String((v as {pdfSourcePath:string}).pdfSourcePath)));await approveSetting(db,lab.approver,id);await activateSetting(db,lab.approver,id);return id;};
  // Invalid folder: validation fails, the draft cannot be approved.
  const bad=await proposeSetting(db,lab.certifier,'result_management',{...SETTINGS.result_management.default,pdfSourcePath:share('results-missing')},'Missing folder probe');
  expect(await validateSetting(db,lab.certifier,bad,async(_k,v)=>resultFolderSettingValid(root0,String((v as {pdfSourcePath:string}).pdfSourcePath)))).toBe(false);
  await expect(approveSetting(db,lab.approver,bad)).rejects.toThrow('SETTING_NOT_VALIDATED');
  await activate({pdfSourcePath:share('results-a'),linkageMode:'UNIQUE_AUTO_LINK'});
  const newJob=async()=>(await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_preview','{}',$1) RETURNING id",['zip-sim-'+Math.random().toString(36).slice(2)])).rows[0].id;
  const job=(kind:string)=>runResultJob(db as unknown as Pool,'00000000-0000-4000-8000-000000000001',kind as never,{},root0,store);
  expect(await job('synthetic_result_test_path')).toMatchObject({passed:true,files:5,folder:share('results-a')});
  const listed=await job('synthetic_result_scan') as {files:{path:string;sha256:string;status:string}[]};
  expect(listed.files).toHaveLength(5);expect(listed.files.filter(f=>f.status==='DUPLICATE_IN_SCAN')).toHaveLength(1);
  // Preview + parse: every ZIP file reads exactly as cases.csv records it.
  const s=await resultSettings(db),actor=lab.staff;
  const ids=await previewFolderFiles(db,store,root0,s.pdfSourcePath,listed.files.filter(f=>f.status==='NEW').map(f=>({path:f.path,sha256:f.sha256})),actor.id,await newJob(),limitsOf(s));
  expect(ids).toHaveLength(4);
  for(const n of [1,3,10,50]){const x=await extract(zipFile(`samples/bgi_pdf/${rows[n-1].bgi_file}`)) as {text:string},p=parseReport(x.text,rows[n-1].bgi_file);
   expect({hn:p.identifiers.hn.value,ln:p.identifiers.labNumber.value,kind:p.templateKind}).toEqual({hn:rows[n-1].HN,ln:rows[n-1].bgi_lab_LN,kind:rows[n-1].result_type==='final'?'SINGLETON':'REDRAW_NOTICE'});}
  await db.query('BEGIN');const out=await confirmImport(db,actor as never,{intakeIds:ids});await db.query('COMMIT'); // the Results API runs it inside withTransaction
  // Case 1 has a registered, received patient with the same HN, but the BGI lab number 26P77000001 is not this patient's LN Halos
  // or printed sample ID → not a clean match → stays Unlinked. Case 50 shares its HN with 51 → ambiguous. The notice is never auto-linked.
  expect(out.map(o=>o.outcome)).toEqual(['Unlinked','Unlinked','Unlinked','Unlinked']);
  expect(out.map(o=>o.autoLink).sort()).toEqual(['AMBIGUOUS_CASES','NOT_A_CLEAN_MATCH','NOT_A_CLEAN_MATCH',undefined]); // cases 50, 1, 3 (ZIP-as-PDF); the notice is never offered
  // An unmatched report can never be released or delivered.
  for(const o of out){await expect(acceptAndRelease(db,lab.certifier as never,{versionId:o.versionId,expectedRowVersion:2,idempotencyKey:'a'.repeat(32),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false})).rejects.toThrow();
   await expect(certifyAttempt(db,lab.certifier as never,{versionId:o.versionId,expectedRowVersion:2,idempotencyKey:'b'.repeat(32),abnormalAcknowledged:false,confirmed:true})).rejects.toThrow();}
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  // After import the same bytes are "IMPORTED"; changing a file after the scan is refused at preview.
  const rescanned=await job('synthetic_result_scan') as {files:{path:string;sha256:string;status:string}[]};
  expect(rescanned.files.filter(f=>f.status==='IMPORTED')).toHaveLength(5);
  const target=rescanned.files[0];await fs.appendFile(share('results-a',...target.path.split('/')),'\n%changed');
  const changedIds=await previewFolderFiles(db,store,root0,s.pdfSourcePath,[target],actor.id,await newJob(),limitsOf(s));
  expect((await db.query<{reject_code:string}>('SELECT reject_code FROM result_intake_file WHERE id=$1',[changedIds[0]])).rows[0].reject_code).toBe('CHANGED_SINCE_SCAN');
  // Each scan setting changes what the consumer sees.
  await activate({pdfSourcePath:share('results-a'),scanSubfolders:false});expect((await job('synthetic_result_scan') as {files:unknown[]}).files).toHaveLength(2);
  await activate({pdfSourcePath:share('results-a'),maxFilesPerScan:2});expect(await job('synthetic_result_scan')).toMatchObject({truncated:true});
  await activate({pdfSourcePath:share('results-a'),maxUploadMb:1});await fs.writeFile(share('results-a','large.pdf'),Buffer.alloc(1024*1024+1,32));
  expect((await job('synthetic_result_scan') as {files:{name:string;status:string}[]}).files.find(f=>f.name==='large.pdf')?.status).toBe('TOO_LARGE');
  await fs.writeFile(share('results-b',rows[22].bgi_file),zipFile(`samples/bgi_pdf/${rows[22].bgi_file}`));
  await activate({pdfSourcePath:share('results-b'),acceptZip:false});
  const zipOnly=await job('synthetic_result_scan') as {folder:string;files:{name:string;sha256:string;path:string}[]};
  expect(zipOnly.folder).toBe(share('results-b'));expect(zipOnly.files.map(f=>f.name)).toEqual([rows[22].bgi_file]); // folder switched
  const z=await previewFolderFiles(db,store,root0,(await resultSettings(db)).pdfSourcePath,zipOnly.files.map(f=>({path:f.path,sha256:f.sha256})),actor.id,await newJob(),limitsOf(await resultSettings(db)));
  expect((await db.query<{state:string;reject_code:string|null}>('SELECT state,reject_code FROM result_intake_file WHERE id=$1',[z[0]])).rows[0]).toMatchObject({state:'Rejected'}); // ZIP-named .pdf refused when ZIP is off
 },120000);

 it('D. HIS delivery through Settings: RES/PDF/OK equal the ZIP expected output (de-identified), order, backup, idempotency, failure/retry',async()=>{
  // Synthetic fixture enrollment needs a synthetic database: a separate isolated one, same share and Settings lifecycle.
  const operationalDb=db,operationalUsers=[admin,checker] as const;
  vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');
  db=await testDatabase();admin=await addUser(db,'APP_ADMIN','zip.d.admin');checker=await addUser(db,'CLINICAL_APPROVER','zip.d.checker');
  try{
  await fs.writeFile(share('.nipt-authorized-test-root'),'NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1');await writePolicy(workerServiceAccount(),'synthetic');
  const row=cases()[0],resBytes=zipFile(`samples/result_res/${row.res_file}`),zipRes=resBytes.subarray(2).toString('utf16le');
  // De-identification of the ZIP sample, applied identically to the input PET and to the expected RES (traceable, reversible):
  const map={ln:'99000'+row.order_LN,hn:'SYNTHETIC-'+row.HN,surname:'SYNTHETIC'};
  const petText=iconv.decode(zipFile(`samples/request_pet/${row.request_file}`),'windows-874');
  const surname=petText.split('\r\n')[1].split('|')[5].split('^^')[0];
  const pet=parsePet(iconv.encode(petText.replaceAll(row.order_LN,map.ln).replace(`|${row.HN}|`,`|${map.hn}|`).replace(`|${surname}^^`,`|${map.surname}${surname}^^`).replace(/\|301\^\d{13}\|/,'|301^SYNTHETIC-ID-1|'),'windows-874'),`${map.ln}-7.pet`);
  const report=parseReport((await extract(zipFile(`samples/bgi_pdf/${row.bgi_file}`)) as {text:string}).text,row.bgi_file);
  const [h,p]=zipRes.split('\r');const hf=h.split('|'),pf=p.split('|'),rf=zipRes.split('\r')[3].split('|');
  const profile:ResProfile={...syntheticProfile,sender:hf[4],receiver:hf[9],wardId:pf[25].split('^')[0],wardName:pf[25].split('^')[1],style:'full',accessionSuffix:rf[11].slice(row.order_LN.length)};
  const draft:SyntheticDraft={fixtureId:'SYNTHETIC-ZIP-1',reportVersionId:'SYNTHETIC-ZIP-V-1',roundId:'SYNTHETIC-ZIP-R-1',attemptId:'SYNTHETIC-ZIP-A-1',origin:'LAB_DIRECT',lnGeneration:1,roundNumber:1,epoch:0,
   input:{order:releaseOrderFromPet(pet),result:releaseResultFromParsed(report),generatedAt:hf[13],approvedAt:rf[9].split('^')[0],certifierHisId:'SYNTHETIC^SYNTHETIC'},
   profile,pdf:zipFile(`samples/bgi_pdf/${row.bgi_file}`),settings:{version:'SYNTHETIC-UNBOUND',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1],confirmationTimeoutMs:300000}};
  const outbound=(over:Record<string,unknown>={})=>({...SETTINGS.his_outbound.default,enabled:true,resDestinationPath:share('res'),pdfDestinationPath:share('pdf'),backupPath:share('backup'),resultStyle:'full',retryDelaySeconds:1,retryLimit:3,...over});
  // A destination outside the authorised root fails the Worker test and cannot be activated.
  const bad=await proposeSetting(db,admin,'his_outbound',outbound({pdfDestinationPath:path.join(os.tmpdir(),'cfs-not-allowed')}),'Wrong destination probe');
  expect(await workerValidate(bad)).toMatchObject({passed:false});await expect(approveSetting(db,checker,bad)).rejects.toThrow('SETTING_NOT_VALIDATED');
  const active=await activateHis('his_outbound',outbound());
  const bound=await bindActiveOutboundSettings(db,draft);expect(bound.profile.style).toBe('full');
  await registerFixture(db,bound,'SYNTHETIC-HIS');const t=await reserveFixture(db,bound.fixtureId);
  expect(t.plan.settingsVersion).toBe('SYNTHETIC-SETTINGS-'+active);
  expect(await runTransfer(db,t.id)).toBe('AWAITING_CONFIRMATION');
  const done=await loadTransfer(db,t.id);
  // File name, encoding, separators and every field equal the ZIP sample after the same de-identification, except P[7]:
  // the legacy sample wrote the DOB as 1983-02-02 while NIPT-CBH writes the PET form 19830202 (receiver acceptance is Q-I5).
  expect(done.plan.resName).toBe(row.res_file.replace(row.order_LN,map.ln));
  const ours=await fs.readFile(share('res',done.plan.resName));expect(ours.subarray(0,2)).toEqual(Buffer.from([0xff,0xfe]));
  const expected=zipRes.replaceAll(row.order_LN,map.ln).replace(`|${row.HN}|`,`|${map.hn}|`).replace(`|${surname}^^`,`|${map.surname}${surname}^^`).replace(rf[10],'SYNTHETIC^SYNTHETIC');
  const mine=ours.subarray(2).toString('utf16le').split('\r'),theirs=expected.split('\r');
  expect(mine.length).toBe(theirs.length);
  const diffs:string[]=[];mine.forEach((line,i)=>{const a=line.split('|'),b=theirs[i].split('|');expect(a.length,`record ${i}`).toBe(b.length);a.forEach((v,j)=>{if(v!==b[j])diffs.push(`${a[0]}[${j}] ${v} != ${b[j]}`);});});
  expect(diffs).toEqual([`P[7] ${pet.dob.slice(0,10).replaceAll('-','')} != ${pf[7]}`]);
  expect(await fs.readFile(share('res',done.plan.okName))).toEqual(zipFile(`samples/result_res/${row.res_file.replace('.res','.ok')}`));
  expect(await fs.readFile(share('pdf',done.plan.pdfName))).toEqual(draft.pdf);
  const history=await readHistory(db,t.id);expect(history.hisConfirmed).toBe(false);
  const codes=history.events.map(e=>e.code).filter(c=>c.endsWith('_VERIFIED')||c==='OK_OBSERVED');
  expect(codes).toEqual(['PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED']); // PDF → RES → backup verified before the OK exists
  expect(await fs.readFile(share('backup',bound.fixtureId,'manifest.json'),'utf8')).toContain(done.plan.fingerprint);
  // Idempotency: running again writes nothing new and keeps one sequence.
  const files=await snapshotTree(share());expect(await runTransfer(db,t.id)).not.toBe('SENT_AGAIN');expect(await snapshotTree(share())).toEqual(files);expect((await loadTransfer(db,t.id)).plan.sequence).toBe(1);
  // Destination unavailable after activation: RETRY_PENDING with the access error, no OK, visible in monitoring; recovers on retry.
  const d2={...draft,fixtureId:'SYNTHETIC-ZIP-2',reportVersionId:'SYNTHETIC-ZIP-V-2',roundId:'SYNTHETIC-ZIP-R-2',attemptId:'SYNTHETIC-ZIP-A-2',input:{...draft.input,order:{...draft.input.order,ln:map.ln.replace(/1$/,'2')}}};
  const b2=await bindActiveOutboundSettings(db,d2);await registerFixture(db,b2,'SYNTHETIC-HIS');const t2=await reserveFixture(db,b2.fixtureId);
  await fs.rename(share('pdf'),share('pdf-offline'));
  try{expect(await runTransfer(db,t2.id)).toBe('RETRY_PENDING');
   expect((await hisMonitoring(db)).transfers.find(x=>x.id===t2.id)).toMatchObject({state:'RETRY_PENDING',access_error:'SHARE_PATH_NOT_FOUND'});
   await expect(fs.stat(share('res',(await loadTransfer(db,t2.id)).plan.okName))).rejects.toMatchObject({code:'ENOENT'});}
  finally{await fs.rename(share('pdf-offline'),share('pdf'));}
  await new Promise(r=>setTimeout(r,1100));expect(await runTransfer(db,t2.id)).toBe('AWAITING_CONFIRMATION');expect((await readHistory(db,t2.id)).hisConfirmed).toBe(false);
  // enabled=false: nothing can be bound for sending.
  await activateHis('his_outbound',outbound({enabled:false}),'Pause outbound sending');await expect(bindActiveOutboundSettings(db,{...draft,fixtureId:'SYNTHETIC-ZIP-3'})).rejects.toThrow('EXPORT_DISABLED');
  }finally{await db.close();db=operationalDb;[admin,checker]=operationalUsers;vi.stubEnv('NIPT_MODE','operational');await writePolicy();}
 },120000);
});
