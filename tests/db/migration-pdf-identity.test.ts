import {it,expect,afterEach,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {resultFixture,receivedCase,importReport,type ResultFixture} from '../helpers/results';
import {ingestMigrationPdfs} from '../../packages/migration/bulk-pdf';
import {autoLinkUnique,ancCaseResults,readHistoricalReportFile,versionDetail} from '../../packages/results/service';
import {queryResults} from '../../packages/results/query';
import {readMigrationResultSummary} from '../../packages/migration/result-summary';
import {labWorklist} from '../../packages/lab/intake';
import {listP2Cases} from '../../packages/p2/service';
import {listHistoricalRuns,historicalRunDetail} from '../../packages/lab/historical-run';
import {syntheticReportPdf,syntheticPdf,reportText} from '../../tools/his-simulator/result-pdf';
import {importHistoricalDoctors,listHistoricalDoctors,referringDoctorOfCase,referringDoctor,doctorKey} from '../../packages/migration/doctors';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
afterEach(()=>vi.unstubAllEnvs());
// Owner-confirmed external file name: "<LN HIS> <name>.pdf". Synthetic ASCII names only (the synthetic PDF writer is Latin-only).
const NAME='Miss Somying Testcase',PDF_NAME='SOMYING TESTCASE';
async function activate(f:ResultFixture,linkageMode:'MANUAL_REVIEWED_ONLY'|'UNIQUE_AUTO_LINK'){
 const id=await f.run(t=>proposeSetting(t,f.u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode},'Synthetic migration identity test'));
 await f.run(t=>validateSetting(t,f.u.certifier,id,async()=>true));await f.run(t=>approveSetting(t,f.u.approver,id));await f.run(t=>activateSetting(t,f.u.approver,id));
}
/** One migrated case with source-backed analytical rows; the LAST attempt is the current Qualified one (Re-Library: -1 Rerun in Run001, -2 Qualified in Run002). */
async function migrated(f:ResultFixture,reLibrary:boolean){
 const c=await receivedCase(f,{ln:'9903'+String(Date.now()).slice(-6),name:NAME});
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),run1=hash('run1-'+c.ln),run2=hash('run2-'+c.ln);
 for(const sha of [run1,run2])await f.db.query("INSERT INTO file_asset(sha256,storage_key,byte_size,media_type) VALUES($1,$1,36,'application/octet-stream')",[sha]);
 const x=(await f.db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",[hash('plan-'+c.ln),f.u.staff.id])).rows[0].id;
 const sources:string[]=[];
 for(const [n,sha] of [[1,run1],[2,run2]] as const){
  await f.db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,$2,$3,$4)",[x,n,`Run00${n}/2026`,sha]);
  sources.push((await f.db.query<{id:string}>("INSERT INTO migration_source(execution_id,kind,sha256,original_name,run_label) VALUES($1,'HALOS_RUN',$2,'synthetic.xlsx',$3) RETURNING id",[x,sha,`Run00${n}/2026`])).rows[0].id);
 }
 const record=(await f.db.query<{id:string}>("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,round_id,attempt_id,state) VALUES($1,'synthetic',2,$2,$3,'QUALIFIED_PDF_PENDING',$4,$5,$6,'IMPORTED') RETURNING id",[x,c.ln,c.labNumber,c.caseId,c.roundId,c.attemptId])).rows[0].id;
 const analysis=(key:string,source:string,run:string,ord:number,advice:string,current:boolean,attempt:string|null,superseded:string|null,raw=`${c.labNumber}-${ord}`)=>f.db.query<{id:string}>(
  `INSERT INTO migration_analysis(record_id,source_id,analysis_key,sheet,row_number,run_label,sample_raw,attempt_number,classification,advice_status,raw,values,is_current,superseded_by,attempt_id) VALUES($1,$2,$3,'result',$4,$5,$6,$7,'ANALYSIS',$8,'{}','{}',$9,$10,$11) RETURNING id`,
  [record,source,key,ord+1,run,raw,ord,advice,current,superseded,attempt]);
 let attemptId=c.attemptId,sampleRaw=c.labNumber;
 if(!reLibrary){await analysis('only',sources[1],'Run002/2026',1,'QUALIFIED',true,c.attemptId,null,c.labNumber);}
 else{
  await analysis('a1',sources[0],'Run001/2026',1,'RERUN',false,c.attemptId,'a2');
  const second=(await analysis('a2',sources[1],'Run002/2026',2,'QUALIFIED',true,null,null)).rows[0].id;
  attemptId=(await f.db.query<{id:string}>("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state,printed_sample_id,historical_source_id) VALUES($1,$2,2,'Ready',$3,$4) RETURNING id",[c.caseId,c.roundId,`${c.labNumber}-2`,second])).rows[0].id;
  await f.db.query('UPDATE migration_analysis SET attempt_id=$2 WHERE id=$1',[second,attemptId]);await f.db.query('UPDATE migration_record SET attempt_id=$2 WHERE id=$1',[record,attemptId]);
  sampleRaw=`${c.labNumber}-2`;
 }
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");
 return {...c,record,attemptId,sampleRaw,file:`${c.ln} Somying Testcase.pdf`,pdf:(o:{labNumber?:string;name?:string;hn?:string}={})=>syntheticReportPdf({kind:'SINGLETON',collection:'10-Oct-2026',labNumber:o.labNumber??sampleRaw,hn:o.hn??c.hn,name:o.name??PDF_NAME})};
}
const versions=(f:ResultFixture)=>f.db.query<{n:number}>("SELECT count(*)::int n FROM result_report_version").then(r=>r.rows[0].n);
it('links only when the file name LN HIS, the file name and the PDF name agree with the system; every contradiction or gap stays in review',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const wrongLn=(Number(m.ln)+1).toString().padStart(10,'0');
  const cases:Array<[string,string,Buffer,string]>=[
   ['wrong LN HIS in the file name',`${wrongLn} Somying Testcase.pdf`,m.pdf(),'PDF_IDENTITY_CONFLICT'],
   ['two different LNs in the file name',`${m.ln} ${wrongLn} Somying Testcase.pdf`,m.pdf(),'PDF_IDENTITY_CONFLICT'],
   ['HN contradicts',m.file,m.pdf({hn:'9999999999'}),'PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED']];
  for(const [label,name,bytes,reason] of cases){
   const out=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name,bytes}]));
   expect(out.rows[0].reason,label).toBe(reason);expect(out.imported,label).toBe(0);
  }
  expect(await versions(f)).toBe(0);
  // Owner rule 2026-11-02: a matching LN (here also the HN and sample ID) identifies the PDF; a different name in the file name and in the PDF is
  // evidence, not a rejection. The matching method and the name difference are recorded on the record's event trail.
  const ok=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:`${m.ln} Somchai Othercase.pdf`,bytes:m.pdf({name:'SOMCHAI OTHERCASE'})}]));
  expect(ok.imported).toBe(1);expect(ok.rows[0].reason).toBe('LN_MATCH');expect(ok.rows[0].match?.attemptId).toBe(m.attemptId);expect(ok.rows[0].identity).toEqual({fileLnHis:'MATCH',fileName:'MISMATCH',pdfName:'MISMATCH'});
  const event=(await f.db.query<{details:{method:string;nameMismatch:{file:boolean;pdf:boolean}}}>("SELECT details FROM migration_record_event WHERE event='PDF_LINKED'")).rows;
  expect(event).toHaveLength(1);expect(event[0].details).toMatchObject({method:'LN_MATCH',nameMismatch:{file:true,pdf:true}});
 }finally{await f.close();}
},180000);
it('the ordinary auto-link contract cannot link a migrated attempt around a conflicting or unverified identity',async()=>{
 const f=await resultFixture();try{
  await activate(f,'UNIQUE_AUTO_LINK');const m=await migrated(f,false);
  // an LN in the file name that points at another case contradicts the sample ID + HN: never linked by the ordinary contract either
  const wrongLn=(Number(m.ln)+1).toString().padStart(10,'0');
  const bad=await importReport(f,m.pdf(),f.u.staff,`${wrongLn} Somying Testcase.pdf`);
  expect(await f.run(t=>autoLinkUnique(t,f.u.staff,bad.versionId))).toMatchObject({linked:false,reason:'PDF_IDENTITY_CONFLICT'});
  expect((await f.db.query("SELECT 1 FROM result_report_version WHERE state<>'Unlinked'")).rows).toHaveLength(0);
 }finally{await f.close();}
},180000);
it('a duplicate PDF never creates a second result, and a different PDF for the same attempt is a recorded conflict',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const first=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf()}]));expect(first.imported).toBe(1);
  const sha=(await f.db.query<{sha256:string;n:number}>("SELECT sha256,(SELECT count(*)::int FROM file_asset WHERE sha256=v.sha256) n FROM result_report_version v")).rows;expect(sha).toHaveLength(1);
  const again=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf()}]));
  expect(again.imported).toBe(0);expect(await versions(f)).toBe(1);
  expect((await f.db.query("SELECT 1 FROM result_release")).rows).toHaveLength(0);
  expect(createHash('sha256').update(m.pdf()).digest('hex')).toBe(sha[0].sha256); // the original bytes and their SHA-256 are what the ledger kept
 }finally{await f.close();}
},180000);
it('Re-Library across Runs: the final PDF links to attempt -2 only, never -1, and attempt -1 history is kept',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,true);
  const before=(await f.db.query<{id:string;attempt_number:number;state:string;printed_sample_id:string|null}>("SELECT id,attempt_number,state,printed_sample_id FROM analytical_attempt WHERE case_id=$1 ORDER BY attempt_number",[m.caseId])).rows;
  expect(before.map(r=>r.attempt_number)).toEqual([1,2]);
  const wrong=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf({labNumber:`${m.labNumber}-1`})}]));
  expect(wrong.imported).toBe(0);expect(wrong.rows[0].reason).toBe('PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED');
  const base=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf({labNumber:m.labNumber})}]));
  expect(base.imported).toBe(0); // a base ID cannot silently pick a later repeat
  const good=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf()}]));
  expect(good.imported).toBe(1);expect(good.rows[0].match?.attemptId).toBe(m.attemptId);
  const v=(await f.db.query<{attempt_id:string;state:string;link_mode:string}>("SELECT attempt_id,state,link_mode FROM result_report_version")).rows;
  expect(v).toHaveLength(1);expect(v[0]).toMatchObject({attempt_id:m.attemptId,link_mode:'AUTO_UNIQUE'});expect(['Linked','ValidationBlocked','PendingCertification']).toContain(v[0].state);
  expect((await f.db.query("SELECT id,attempt_number,state,printed_sample_id FROM analytical_attempt WHERE case_id=$1 ORDER BY attempt_number",[m.caseId])).rows).toEqual(before);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM migration_analysis WHERE record_id=$1",[m.record])).rows[0].n).toBe(2);
 }finally{await f.close();}
},180000);
// Owner decision 2026-11-02: a historical result matched to its complete PDF is "reported by the previous system": no gate, no certification,
// no release, no HIS transfer; ANC and LAB read the values and open/download/print the exact PDF.
it('a matched historical PDF is reported by the previous system: readable by ANC and LAB, never certifiable, no release or transfer',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const out=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf()}]));expect(out.imported).toBe(1);
  const version=(await f.db.query<{id:string;state:string}>("SELECT id,state FROM result_report_version")).rows[0];
  expect(['Linked','ValidationBlocked','PendingCertification']).toContain(version.state);
  expect((await f.db.query('SELECT version_id FROM historical_reported_result')).rows).toEqual([{version_id:version.id}]);
  const historical=await f.run(t=>queryResults(t,f.u.staff,{bucket:'historical'}));expect(historical.rows.map(r=>r.id)).toEqual([version.id]);expect(historical.rows[0].historical).toBe(true);
  for(const bucket of ['blocked','pending'] as const)expect((await f.run(t=>queryResults(t,f.u.staff,{bucket}))).rows.map(r=>r.id)).not.toContain(version.id);
  const detail=await f.run(t=>versionDetail(t,f.u.staff,version.id)) as unknown as {historicalReported:boolean;can:Record<string,boolean>};
  expect(detail.historicalReported).toBe(true);expect(detail.can).toMatchObject({review:false,certify:false,acceptRelease:false,acceptInternal:false});
  const anc=await f.run(t=>ancCaseResults(t,f.u.anc,m.caseId));const result=anc.rounds.find(r=>r.current)?.result as unknown as {id:string;state:string;historical?:boolean;summary:{t21?:string|null}}|null;
  expect(result).toMatchObject({id:version.id,state:'HistoricalReported',historical:true});expect(result!.summary.t21).toBeTruthy();
  for(const mode of ['VIEW','DOWNLOAD','PRINT'] as const){const file=await f.run(t=>readHistoricalReportFile(t,f.u.anc,f.store,version.id,mode));expect(file.bytes.length).toBeGreaterThan(100);expect(file.name).toMatch(/\.pdf$/i);}
  expect((await f.db.query<{purpose:string}>("SELECT purpose FROM result_access_log WHERE version_id=$1 ORDER BY purpose",[version.id])).rows.map(r=>r.purpose)).toEqual(['ANC_RESULT_DOWNLOAD','ANC_RESULT_FILE','ANC_RESULT_PRINT_VIEW']);
  const lab=await f.run(t=>readMigrationResultSummary(t,f.u.staff,m.caseId)) as unknown as {summary:{source:string;label:string}|null};
  expect(lab.summary).toMatchObject({source:'OFFICIAL_PDF'});expect(lab.summary!.label).toContain('ระบบเดิม');
  for(const t of ['result_release','p6_transfer','result_review'])expect((await f.db.query('SELECT 1 FROM '+t)).rows).toHaveLength(0);
  await expect(f.run(t=>readHistoricalReportFile(t,f.u.anc,f.store,'00000000-0000-4000-8000-000000000000'))).rejects.toThrow('NOT_FOUND');
 }finally{await f.close();}
},180000);
// Owner 2026-11-02: LAB queue. A historical case without its PDF is work that still has to be done here: it is not blocked on a missing electronic form
// (its request and consent were on paper); a historical case whose PDF is matched was already reported and is not an open item of the queue.
it('LAB queue: a historical case still in progress waits only for the real specimen acceptance; one whose result was reported is not an open item',async()=>{
 const f=await resultFixture();try{
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const inQueue=async()=>(await f.run(t=>labWorklist(t,f.u.staff))).attempts.filter(a=>a.caseId===m.caseId);
  // reported by the previous system (HALOS qualified, PDF to be matched or matched): never an open item of the queue
  expect(await inQueue()).toHaveLength(0);
  // still in progress (no HALOS analysis yet): work that has to be done here. Its request and consent were on paper, so only the physical acceptance is open.
  await f.db.query("UPDATE migration_record SET classification='NO_HALOS' WHERE id=$1",[m.record]);
  const open=await inQueue();expect(open).toHaveLength(1);
  // Owner 2026-11-02 (zero historical gates): paper request and consent, the PET is the HIS receipt, an unrecorded pregnancy type is Singleton, and the previous system's clinical
  // assessment is not repeated. The case waits for no gate; it is real work in the queue, neither ValidationBlocked nor advanced automatically.
  expect([...(open[0].gate?.failed??[]),...(open[0].gate?.pending??[])]).toEqual([]);
  expect(open[0]).toMatchObject({category:'READY',attemptState:'Ready'});
 }finally{await f.close();}
},180000);
// Owner 2026-11-02: central registry. "ดูผลตรวจ" is offered when a result exists: released here, or reported by the previous system (whatever its technical
// state). A sample without a result keeps "รายละเอียดตัวอย่าง". The certified-release flag itself is untouched.
it('central registry: hasResult is true for a reported historical case, false for one without a result, and released stays certified-only',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const plain=await receivedCase(f);const m=await migrated(f,false);
  const rowOf=async()=>(await f.run(t=>listP2Cases(t,f.u.staff,{pageSize:50}))) as unknown as {cases:{id:string;released:boolean;hasResult:boolean}[]};
  const find=async(id:string)=>{const r=await rowOf();return r.cases.find(x=>x.id===id);};
  expect(await find(m.caseId)).toMatchObject({released:false,hasResult:false});
  await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:m.pdf()}]));
  expect(await find(m.caseId)).toMatchObject({released:false,hasResult:true});
  expect(await find(plain.caseId)).toMatchObject({released:false,hasResult:false});
 }finally{await f.close();}
},180000);
// Owner 2026-11-02: the imported Runs show their real content (read model of migration_analysis), not an empty Run list.
it('historical Runs: listed with sample counts and opened with their analyses; nothing is created and the next Run stays free',async()=>{
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const runs=await f.run(t=>listHistoricalRuns(t,f.u.staff));
  expect(runs.map(r=>r.runLabel)).toEqual(expect.arrayContaining(['Run001/2026','Run002/2026']));
  expect(runs.find(r=>r.runLabel==='Run002/2026')!.samples).toBeGreaterThanOrEqual(1);
  const d=await f.run(t=>historicalRunDetail(t,f.u.staff,'Run002/2026'));
  expect(d!.slots.filter(s=>s.kind==='SAMPLE'&&s.caseId===m.caseId).length).toBeGreaterThanOrEqual(1);
  expect(d!.slots.filter(s=>s.slot>=1&&s.slot<=48).length).toBe(48);
  expect(await f.run(t=>historicalRunDetail(t,f.u.staff,'Run999/2026'))).toBeNull();
  expect((await f.db.query("SELECT count(*)::int n FROM lab_batch")).rows[0]).toEqual({n:0});
 }finally{await f.close();}
},180000);
// Owner 2026-11-02: the doctors named on the issued reports become the historical doctor registry, linked to their cases; nothing else is created.
it('historical doctor registry: read from the report PDF, one entry per doctor, linked to the case, idempotent, no unit, signature or approval',async()=>{
 expect(referringDoctor('x Referring Doctor: พญ.พรชนก นาคสาร Sample Type: Whole Blood')).toBe('พญ.พรชนก นาคสาร');
 expect(referringDoctor('Referring Doctor: - Sample Type: Whole Blood')).toBeNull();expect(referringDoctor('no such line')).toBeNull();
 expect(doctorKey('พญ. พรชนก  นาคสาร')).toBe(doctorKey('พญ.พรชนก นาคสาร'));expect(doctorKey('Dr. Somchai Test')).toBe(doctorKey('somchai   test'));
 const f=await resultFixture();try{
  await activate(f,'MANUAL_REVIEWED_ONLY');const m=await migrated(f,false);
  const spec={kind:'SINGLETON' as const,collection:'10-Oct-2026',labNumber:m.sampleRaw,hn:m.hn,name:PDF_NAME};
  await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:m.file,bytes:syntheticPdf([...reportText(spec),'Referring Doctor: Dr. Somchai Testdoc Sample Type: Whole Blood'])}]));
  const first=await f.run(t=>importHistoricalDoctors(t,f.u.staff,f.store));
  expect(first).toMatchObject({versions:1,parsed:1,doctorsAdded:1,casesLinked:1});
  const again=await f.run(t=>importHistoricalDoctors(t,f.u.staff,f.store));
  expect(again).toMatchObject({doctorsAdded:0,casesLinked:0,casesAlreadyLinked:1});
  expect((await f.run(t=>listHistoricalDoctors(t,f.u.staff))).map(d=>[d.name,d.cases])).toEqual([['Dr. Somchai Testdoc',1]]);
  expect(await f.run(t=>referringDoctorOfCase(t,m.caseId))).toBe('Dr. Somchai Testdoc');
  expect((await f.db.query("SELECT count(*)::int n FROM p2_doctor_version")).rows[0]).toEqual({n:0});
 }finally{await f.close();}
},180000);
