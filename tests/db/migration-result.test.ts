import {readMigrationExecution} from '../../packages/migration/service';
import {addUser} from '../helpers/database';
import {ingestMigrationPdfs} from '../../packages/migration/bulk-pdf';
import {readMigrationResultSummary} from '../../packages/migration/result-summary';
import {syntheticReportPdf,syntheticZip} from '../../tools/his-simulator/result-pdf';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
it('installs historical release authority without changing normal empty-release eligibility',async()=>{const db=await testDatabase();try{
 const r=await db.query<{ok:boolean;source:boolean;review:boolean}>("SELECT p6_release_eligible('00000000-0000-0000-0000-000000000001',0) ok,migration_result_source_current('00000000-0000-0000-0000-000000000001') source,migration_result_review_current('00000000-0000-0000-0000-000000000001') review");
 expect(r.rows[0]).toEqual({ok:false,source:false,review:false});
 }finally{await db.close();}});
import {afterEach,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {resultFixture,receivedCase,rowVersion} from '../helpers/results';
import {acceptAndRelease} from '../../packages/results/service';
afterEach(()=>vi.unstubAllEnvs());
it.each([true,false])('releases authentic migration PDF without synthetic QC5; prePDF HIS present=%s',async present=>{
 const f=await resultFixture();try{
 const setting=await f.run(t=>proposeSetting(t,f.u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:'MANUAL_REVIEWED_ONLY'},'Synthetic migration test auto match'));
 await f.run(t=>validateSetting(t,f.u.certifier,setting,async()=>true));await f.run(t=>approveSetting(t,f.u.approver,setting));await f.run(t=>activateSetting(t,f.u.approver,setting));
 const admin=await addUser(f.db);const c=await receivedCase(f,{ln:'9902'+String(Date.now()).slice(-6),name:'Miss Somying Testcase'}),file=c.ln+' Somying Testcase.pdf',pdfName='SOMYING TESTCASE';const sha=createHash('sha256').update('synthetic authentic migration source').digest('hex');
 await f.db.query("INSERT INTO file_asset(sha256,storage_key,byte_size,media_type) VALUES($1,$1,36,'application/octet-stream')",[sha]);
 const execution=(await f.db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",[sha,f.u.staff.id])).rows[0].id;
 await f.db.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,1,'Run001/2026',$2)",[execution,sha]);
 const source=(await f.db.query<{id:string}>("INSERT INTO migration_source(execution_id,kind,sha256,original_name,run_label) VALUES($1,'HALOS_RUN',$2,'synthetic.xlsx','Run001/2026') RETURNING id",[execution,sha])).rows[0].id;
 const record=(await f.db.query<{id:string}>("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,round_id,attempt_id,his_pdf_exists,state) VALUES($1,'synthetic',2,$2,$3,'QUALIFIED_PDF_PENDING',$4,$5,$6,$7,'IMPORTED') RETURNING id",[execution,c.ln,c.labNumber,c.caseId,c.roundId,c.attemptId,present])).rows[0].id;
 await f.db.query(`INSERT INTO migration_analysis(record_id,source_id,analysis_key,sheet,row_number,run_label,sample_raw,attempt_number,classification,advice_status,raw,values,is_current,attempt_id) VALUES($1,$2,'synthetic','result',2,'Run001/2026',$3,1,'ANALYSIS','QUALIFIED','{}','{}',true,$4)`,[record,source,c.labNumber,c.attemptId]);
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");
 await expect(f.run(t=>readMigrationResultSummary(t,f.u.anc,c.caseId))).rejects.toThrow('FORBIDDEN');
 expect((await f.run(t=>readMigrationResultSummary(t,f.u.staff,c.caseId))).summary).toMatchObject({source:'HALOS',released:false});
 const bulk=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:'random-batch.zip',bytes:syntheticZip([{name:file,data:syntheticReportPdf({kind:'SINGLETON',collection:'10-Oct-2026',labNumber:c.labNumber,hn:c.hn,name:pdfName})},{name:'z.pdf',data:syntheticReportPdf({kind:'SINGLETON',collection:'10-Oct-2026',labNumber:c.labNumber+'-99',hn:c.hn})}])},{name:'broken.pdf',bytes:Buffer.from('not a PDF')} ]));
 expect(bulk.imported).toBe(1);expect(bulk.reviewRequired).toBe(2);expect(bulk.released).toBe(0);
 expect((await f.db.query('SELECT 1 FROM result_release')).rows).toHaveLength(0);
 expect(bulk.rows[0].match?.attemptId).toBe(c.attemptId);expect(bulk.rows[0].versionId).toBeTruthy();
 const report={versionId:bulk.rows[0].versionId!};
 const reviewProjection=await readMigrationExecution(f.db,admin,execution);expect(reviewProjection.records[0].classification).toBe('PDF_REVIEW');expect(reviewProjection.summary.pdfReview).toBe(1);
 const out=await f.run(async t=>acceptAndRelease(t,f.u.certifier,{versionId:report.versionId,expectedRowVersion:(await rowVersion(f,report.versionId)).row_version,idempotencyKey:randomUUID().replaceAll('-',''),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:true}));
 expect(out.outcome).toBe('CertifiedReleased');expect(out).toMatchObject({outboundSuppressed:present});
 const releasedProjection=await readMigrationExecution(f.db,admin,execution);expect(releasedProjection.records[0].classification).toBe('CERTIFIED_RELEASED');expect(releasedProjection.summary.certifiedReleased).toBe(1);expect((await f.db.query<{classification:string}>('SELECT classification FROM migration_record WHERE id=$1',[record])).rows[0].classification).toBe('QUALIFIED_PDF_PENDING');
 expect((await f.run(t=>readMigrationResultSummary(t,f.u.staff,c.caseId))).summary).toMatchObject({source:'OFFICIAL_PDF',released:true,values:{t21:'Low Risk'}});
 expect((await f.db.query('SELECT 1 FROM result_qc5_review')).rows).toHaveLength(0);
 expect((await f.db.query("SELECT 1 FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(present?0:1);
 expect((await f.db.query<{ok:boolean}>('SELECT p6_release_eligible($1,0) ok',[out.releaseId])).rows[0].ok).toBe(!present);
 expect((await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[c.attemptId])).rows[0].state).not.toBe('FinalQcAccepted');
 await f.db.query('UPDATE migration_record SET his_pdf_exists=false,row_version=row_version+1 WHERE id=$1',[record]);
 expect((await f.db.query("SELECT 1 FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(present?0:1);
 expect((await f.db.query<{ok:boolean}>('SELECT migration_result_review_current($1) ok',[report.versionId])).rows[0].ok).toBe(true);
 const conflict=await f.run(t=>ingestMigrationPdfs(t,f.u.staff,f.store,[{name:file,bytes:syntheticReportPdf({kind:'SINGLETON',collection:'10-Oct-2026',labNumber:c.labNumber,hn:c.hn,name:pdfName,ff:'15.20'})}]));
 expect(conflict.rows[0].reason).toBe('CONFLICTING_OFFICIAL_PDFS');expect(conflict.imported).toBe(0);
 expect((await f.db.query<{ok:boolean}>('SELECT migration_result_source_current($1) ok',[report.versionId])).rows[0].ok).toBe(false);

 }finally{await f.close();}
});

