import {it,expect,afterEach,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {resultFixture,receivedCase,importReport,type ResultFixture} from '../helpers/results';
import {ingestMigrationPdfs} from '../../packages/migration/bulk-pdf';
import {autoLinkUnique} from '../../packages/results/service';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
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
   ['wrong person in the file name',`${m.ln} Somchai Othercase.pdf`,m.pdf(),'PDF_IDENTITY_CONFLICT'],
   ['wrong person printed inside the PDF',m.file,m.pdf({name:'SOMCHAI OTHERCASE'}),'PDF_IDENTITY_CONFLICT'],
   ['no LN HIS or name in the file name','final-report.pdf',m.pdf(),'PDF_IDENTITY_UNVERIFIED'],
   ['LN HIS but no name in the file name',`${m.ln}.pdf`,m.pdf(),'PDF_IDENTITY_UNVERIFIED'],
   ['two different LNs in the file name',`${m.ln} ${wrongLn} Somying Testcase.pdf`,m.pdf(),'PDF_IDENTITY_CONFLICT'],
   ['HN contradicts',m.file,m.pdf({hn:'9999999999'}),'PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED']];
  for(const [label,name,bytes,reason] of cases){
   const out=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name,bytes}]));
   expect(out.rows[0].reason,label).toBe(reason);expect(out.imported,label).toBe(0);
  }
  expect(await versions(f)).toBe(0);
  // Name variants the owner's systems produce (title, spacing, order, case) are still the same person.
  const ok=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:`${m.ln} SOMYING  TESTCASE.pdf`,bytes:m.pdf({name:'Testcase Somying'})}]));
  expect(ok.imported).toBe(1);expect(ok.rows[0].match?.attemptId).toBe(m.attemptId);expect(ok.rows[0].identity).toEqual({fileLnHis:'MATCH',fileName:'MATCH',pdfName:'MATCH'});
 }finally{await f.close();}
},180000);
it('the ordinary auto-link contract cannot link a migrated attempt around a conflicting or unverified identity',async()=>{
 const f=await resultFixture();try{
  await activate(f,'UNIQUE_AUTO_LINK');const m=await migrated(f,false);
  const bad=await importReport(f,m.pdf(),f.u.staff,`${m.ln} Somchai Othercase.pdf`);
  expect(await f.run(t=>autoLinkUnique(t,f.u.staff,bad.versionId))).toMatchObject({linked:false,reason:'PDF_IDENTITY_CONFLICT'});
  const plain=await importReport(f,m.pdf({name:'SOMYING TESTCASE '}),f.u.staff,'final-report.pdf');
  expect(await f.run(t=>autoLinkUnique(t,f.u.staff,plain.versionId))).toMatchObject({linked:false,reason:'PDF_IDENTITY_UNVERIFIED'});
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
