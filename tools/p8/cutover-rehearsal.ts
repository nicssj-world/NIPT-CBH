/** Opt-in retained native synthetic evidence. Never imports an inherited DATABASE_URL or changes runtime workflows. */
import {Client,escapeIdentifier} from 'pg';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {migrate} from '../migrate';
import {labUsers,tx,syntheticCase,receiveS1} from '../../tests/helpers/lab';
import {goodRow,pdfFor,importBatch,view,attest,LOOKUP_KEY,type HistFixture} from '../../tests/helpers/historical';
import {FileStore} from '../../packages/storage';
import type {Staff} from '../../packages/lab/core';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {confirmBatch} from '../../packages/historical/service';
import {registerCase} from '../../packages/db/registration';
import {registerFixture} from '../../packages/p6/journal';
import {readClinicalOutboundCandidate} from '../../packages/p6/release-boundary';
import {sandboxFixture} from '../p6/fixtures';
import {inspectHistoricalIntegrity} from '../../packages/historical/maintenance';
import {verifyAuditChain} from '../../packages/db/audit';
import {canonical,sha} from '../../deploy/scripts/backup-format.mjs';

export function assertCutoverTarget(env:Readonly<Record<string,string|undefined>>):URL {
 if(env.NIPT_MODE!=='synthetic'||!env.NIPT_P8_OPS_URL)throw Error('EXPLICIT_P8_CUTOVER_CLUSTER_REQUIRED');
 let u:URL;try{u=new URL(env.NIPT_P8_OPS_URL);}catch{throw Error('DEDICATED_P8_CUTOVER_CLUSTER_REQUIRED');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='55461'||u.pathname!=='/nipt_p8_synthetic_admin'||u.username!=='nipt_p8_synthetic_owner'||u.search||u.hash)throw Error('DEDICATED_P8_CUTOVER_CLUSTER_REQUIRED');
 return u;
}

export async function cutoverRehearsal(env:Readonly<Record<string,string|undefined>>=process.env){
 const adminUrl=assertCutoverTarget(env),id=randomUUID().replaceAll('-',''),database='nipt_p8_synthetic_cutover_'+id;
 const root=path.resolve('.local/p8/cutover-'+id),url=new URL(adminUrl);url.pathname='/'+database;
 const admin=new Client({connectionString:adminUrl.toString()}),db=new Client({connectionString:url.toString()});
 const started=performance.now(),timings:Record<string,number>={},checks:string[]=[];
 await admin.connect();
 try{
  await admin.query('CREATE DATABASE '+escapeIdentifier(database));await db.connect();await fs.mkdir(root,{recursive:true});
  const phase=async<T>(name:string,fn:()=>Promise<T>)=>{const t=performance.now();const result=await fn();timings[name]=performance.now()-t;return result;};
  await phase('migrate',()=>migrate(db));await db.query(await fs.readFile('packages/db/roles.sql','utf8'));await db.query(await fs.readFile('packages/p6/grants.sql','utf8'));
  const u=await labUsers(db),store=new FileStore(path.join(root,'files')),run=<T>(fn:Parameters<typeof tx<T>>[1])=>tx(db,fn);
  const verifierId=(await db.query("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'ผู้ตรวจจำลอง P8','$argon2id$v=19$synthetic') RETURNING id",['synthetic.p8.verifier.'+id])).rows[0].id;
  await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'HISTORICAL_VERIFIER')",[verifierId]);
  const maker={...u.staff,permissions:['HISTORICAL_ENTRY']},verifier:Staff={id:verifierId,roles:['HISTORICAL_VERIFIER'],unitIds:[],permissions:[]};
  const f={db,u,store,run,maker,maker2:{...u.staff2,permissions:['HISTORICAL_ENTRY']},verifier} as unknown as HistFixture;
  const n=async(sql:string)=>(await db.query<{n:number}>(sql)).rows[0].n;
  // External legacy HIS facts are declared synthetic fixture evidence, not injected into the new runtime as received/completed cases.
  const inFlight=goodRow(8101,{receipt_date:'2025-12-31',report_date:'2026-01-02'});
  const manifest={format:'NIPT_P8_FROZEN_INFLIGHT_V1',syntheticOnly:true,ownerApproved:false,cutoff:'2026-01-01',timezone:'Asia/Bangkok',od26Design:'C',governedExceptionImplemented:false,
   rows:[{ln:inFlight.ln,hn:inFlight.hn,legacyHisReceivedAt:'2025-12-31T23:59:59+07:00',statusAtCutover:'AWAITING_LEGACY_FINAL_REPORT',completedReportDay:'2026-01-02',route:'LEGACY_COMPLETION_THEN_HOLD_PENDING_GOVERNED_EXCEPTION'}]};
  const frozen=Buffer.from(canonical(manifest)),manifestHash=sha(frozen),manifestPath=path.join(root,'frozen-inflight.json');
  await fs.writeFile(manifestPath,frozen,{flag:'wx',mode:0o400});await fs.writeFile(path.join(root,'frozen-inflight.sha256'),manifestHash+'\n',{flag:'wx'});
  // Maker-checker settings in this disposable synthetic DB are rehearsal parameters, never owner approval.
  for(const [key,value] of [['go_live_cutoff',{cutoff:'2026-01-01',impactReportHash:manifestHash}],['historical_backfill',{anchorPolicy:'A_FINAL_REPORT',minimumProfile:'OD18_B_BALANCED',maxBatchRows:100}]] as const)
   await run(async t=>{const sid=await proposeSetting(t,u.certifier,key,value,'SYNTHETIC_P8_CUTOVER_ONLY_NOT_OWNER_APPROVAL');await validateSetting(t,u.certifier,sid,async()=>true);await approveSetting(t,u.approver,sid);await activateSetting(t,u.approver,sid);});
  const boundaryRows=[goodRow(8100,{report_date:'2025-12-31'}),goodRow(8102,{report_date:'2026-01-01'}),inFlight];
  const boundary=await phase('historicalBoundaryStage',()=>importBatch(f,boundaryRows,boundaryRows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)}))));
  const bv=await view(f,boundary);assert.deepEqual(bv.rows.map(r=>r.state),['Submitted','NotEligible','NotEligible']);
  for(const r of bv.rows.slice(1))assert(r.evaluation?.reasons.some(x=>x.code==='ANCHOR_NOT_BEFORE_CUTOFF'));
  const item=(r:typeof bv.rows[number])=>({draftId:r.id,version:r.version,attestation:attest()});
  // Explicit attempt to promote the frozen in-flight LN still fails; a file hash never grants clinical eligibility.
  const frozenAttempt=await run(t=>confirmBatch(t,verifier,boundary,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[item(bv.rows[2])]}));
  assert.equal(frozenAttempt.summary.promoted,0);assert.equal((await db.query('SELECT count(*)::int n FROM case_ln WHERE ln=$1',[inFlight.ln])).rows[0].n,0);
  const pre=await run(t=>confirmBatch(t,verifier,boundary,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[item(bv.rows[0])]}));assert.equal(pre.summary.promoted,1);
  checks.push('pre-cutoff-final-promoted','at-cutoff-anchor-rejected','frozen-inflight-post-cutoff-completion-remains-hold');
  // New-runtime cases at and after midnight Bangkok are ordinary LAB_DIRECT registrations, with immutable receipt times.
  const current:Awaited<ReturnType<typeof syntheticCase>>[]=[];
  for(const [ln,at] of [['009900008201','2026-01-01T00:00:00+07:00'],['009900008202','2026-01-02T08:00:00+07:00']] as const){
   const c=await run(t=>syntheticCase(t,{staff:u.staff,unit:u.unit},{ln}));await run(t=>receiveS1(t,c,new Date(at),'2026-01-01'));current.push(c);
  }
  assert.deepEqual((await db.query("SELECT to_char(received_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS') receipt_day FROM specimen_round ORDER BY received_at")).rows.map(r=>r.receipt_day),['2026-01-01 00:00:00','2026-01-02 08:00:00']);
  const duplicate=await run(t=>registerCase(t,{ln:current[0].ln,identityKey:'f'.repeat(64),origin:'LAB_DIRECT',actorId:u.staff.id,idempotencyKey:'SYNTHETIC_P8_DUPLICATE_'+id}));assert.equal(duplicate.outcome,'CONFLICT');assert.equal(duplicate.caseId,null);
  assert.equal(await n('SELECT count(*)::int n FROM specimen_round'),2);checks.push('at-and-post-cutoff-new-runtime-receipt','duplicate-live-ln-no-case');
  // Same HN with conflicting name/DOB is queued; it is never silently linked to the promoted historical patient.
  const identityRow=goodRow(8103,{hn:boundaryRows[0].hn,name:'SYNTHETIC CONFLICTING IDENTITY',dob:'1990-01-01'});
  const identityBatch=await importBatch(f,[identityRow],[{name:identityRow.pdf_file!,bytes:pdfFor(identityRow)}]);
  const iv=(await view(f,identityBatch)).rows[0];assert(iv.issues.some(i=>i.code==='IDENTITY_CONFLICT_SAME_HN'));assert.notEqual(iv.state,'Submitted');checks.push('same-hn-conflicting-identity-queued');
  // Mixed batch: independent second person, partial selection, false attestation, and a fresh registry conflict between stage/confirm.
  const rows=[goodRow(8110),goodRow(8111),goodRow(8112),goodRow(8113)];
  const batch=await phase('mixedBatchStage',()=>importBatch(f,rows,rows.map(r=>({name:r.pdf_file!,bytes:pdfFor(r)})),maker,{zip:true}));const v=await view(f,batch);
  assert(v.rows.every(r=>r.state==='Submitted'));assert((await view(f,batch,maker)).rows.every(r=>!r.canVerify));
  await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'HISTORICAL_VERIFIER')",[maker.id]);
  const self=await run(t=>confirmBatch(t,{...maker,roles:[...maker.roles,'HISTORICAL_VERIFIER']},batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[item(v.rows[0])]}));
  assert.equal(self.outcomes[0].code,'SELF_VERIFICATION_PROHIBITED');checks.push('same-contributor-verifier-refused');
  await run(t=>syntheticCase(t,{staff:u.staff,unit:u.unit},{ln:rows[2].ln,evidence:false}));
  const partial=await phase('partialConfirm',()=>run(t=>confirmBatch(t,verifier,batch,LOOKUP_KEY,{idempotencyKey:randomUUID(),rows:[item(v.rows[0]),{...item(v.rows[1]),attestation:attest({identityMatchesOriginal:false})},item(v.rows[2])]})));
  assert.deepEqual(partial.outcomes.map(o=>o.outcome),['PROMOTED','DISCREPANCY','CONFLICT']);assert.equal((await view(f,batch)).rows[3].state,'Submitted');checks.push('partial-confirm-independent','false-attestation-discrepancy','late-registry-conflict','unselected-row-untouched');
  // Interrupt after a successful real promotion but before COMMIT. Rollback must erase verification, case and audit together.
  const before=await n('SELECT count(*)::int n FROM historical_record'),auditBefore=await n('SELECT count(*)::int n FROM audit_chain'),retryKey=randomUUID();
  await assert.rejects(run(async t=>{const r=await confirmBatch(t,verifier,batch,LOOKUP_KEY,{idempotencyKey:retryKey,rows:[item(v.rows[3])]});assert.equal(r.summary.promoted,1);throw Error('SYNTHETIC_INTERRUPTION_BEFORE_COMMIT');}),/SYNTHETIC_INTERRUPTION_BEFORE_COMMIT/);
  assert.equal(await n('SELECT count(*)::int n FROM historical_record'),before);assert.equal(await n('SELECT count(*)::int n FROM audit_chain'),auditBefore);assert.equal((await view(f,batch)).rows[3].state,'Submitted');
  const retry=await phase('rollbackRetry',()=>run(t=>confirmBatch(t,verifier,batch,LOOKUP_KEY,{idempotencyKey:retryKey,rows:[item(v.rows[3])]})));assert.equal(retry.summary.promoted,1);
  const replay=await run(t=>confirmBatch(t,verifier,batch,LOOKUP_KEY,{idempotencyKey:retryKey,rows:[item(v.rows[3])]}));assert.equal(replay.summary.alreadyPromoted,1);checks.push('transaction-interruption-atomic-rollback','same-key-retry','committed-replay-no-duplicate');
  // Real queue and clinical release boundaries, without enrolling a successful transport or forging a publisher.
  await assert.rejects(registerFixture(db,{...sandboxFixture(8201),origin:'HISTORICAL'} as never,'SYNTHETIC-P8-'+id),/HISTORICAL_OUTBOUND_PROHIBITED/);
  await assert.rejects(readClinicalOutboundCandidate(db,randomUUID()),/P6_CLINICAL_RELEASE_HOLD_AL5/);
  assert.equal(await n('SELECT count(*)::int n FROM p6_fixture'),0);assert.equal(await n('SELECT count(*)::int n FROM p6_transfer'),0);
  assert.equal((await db.query('SELECT p5_release_authorized() allowed')).rows[0].allowed,false);assert.equal(await n('SELECT count(*)::int n FROM result_release'),0);
  assert.equal(await n("SELECT count(*)::int n FROM analytical_attempt WHERE state IN ('AnalysisComplete','FinalQcAccepted','Final')"),0);checks.push('historical-queue-barrier','clinical-publisher-hold','zero-transfers-clinical-authority-releases');
  await db.query('BEGIN READ ONLY');let integrity;try{integrity=await inspectHistoricalIntegrity(db,u.auditor,store);}finally{await db.query('ROLLBACK');}assert.deepEqual(integrity.issues,[]);
  const chain=(await db.query('SELECT sequence,previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows;assert(verifyAuditChain(chain));
  assert.equal(sha(await fs.readFile(manifestPath)),manifestHash);
  const evaluations=(await db.query('SELECT id,draft_id,cutoff_version,cutoff,outcome,hash,snapshot FROM historical_eligibility_evaluation ORDER BY id')).rows;
  const policy=(await db.query("SELECT r.setting_key,r.version,r.value,r.created_by,r.approved_by FROM settings_revision r JOIN setting_active a ON a.revision_id=r.id WHERE r.setting_key IN ('go_live_cutoff','historical_backfill') ORDER BY r.setting_key")).rows;
  const report={format:'NIPT_P8_CUTOVER_REHEARSAL_V1',syntheticOnly:true,database,toolSha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),postgres:(await db.query('SHOW server_version')).rows[0].server_version,cutoff:'2026-01-01',timezone:'Asia/Bangkok',od26Design:'C',ownerApproved:false,actualCutoffApproved:false,actualAnchorApproved:false,governedInflightExceptionImplemented:false,frozenManifestSha256:manifestHash,
   checks,timingsMs:timings,totalMs:performance.now()-started,boundaryStates:bv.rows.map(r=>r.state),frozenAttempt,partial,retry,replay,identityConflictState:iv.state,historicalRecords:await n('SELECT count(*)::int n FROM historical_record'),releaseRows:0,clinicalAuthority:false,p6Transfers:0,auditValid:true,integrity,al7Accepted:false,clinicalPilotReady:false};
  await fs.writeFile(path.join(root,'audit-chain.json'),JSON.stringify(chain,null,2));await fs.writeFile(path.join(root,'eligibility-evidence.json'),JSON.stringify({policy,evaluations},null,2));await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify({report:path.join(root,'report.json'),database,checks:checks.length,historicalRecords:report.historicalRecords,releaseRows:0,totalMs:report.totalMs})+'\n');return report;
 }catch(e){await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'failed.json'),JSON.stringify({syntheticOnly:true,database,checks,error:e instanceof Error?e.message:'UNKNOWN',clinicalPilotReady:false},null,2));throw e;}
 finally{await db.end().catch(()=>{});await admin.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await cutoverRehearsal();
