import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {lockLn} from '../db/registration';
import type {FileStore} from '../storage';
import {sha256} from '../storage';
import {LabError,need,type Staff} from '../lab/core';
import {readActiveSettings} from '../settings/service';
import {SETTINGS} from '../settings/catalog';
import {extract,isPdf,screen,QuarantineError} from '../results/extract';
import {parseReport} from '../results/parser';
import {isZip,zipEntries,zipRead,memberBasename,ZIP_LIMITS} from '../results/zip';
import {lnHnKey} from '../inbound/identity';
import {bangkokDay} from './dates';
import {evaluateEligibility,NO_ACTIVITY,ELIGIBILITY_RULE_VERSION,type EligibilityInput,type EligibilityResult,type NiptActivity} from './eligibility';
import {evidenceCompleteness,type MinimumProfile} from './evidence';
import {decidePromotion,type Attestation} from './lifecycle';
import {precheckHistoricalDraft,type PrecheckInput} from './precheck';
import {readTable,TableError,TABLE_LIMITS,templateCsv,type ColumnKey,type TableRow} from './table';
import {buildDraftData,matchPdf,type DraftData,type PdfInfo,type RowIssue} from './bulk';
import {historicalAuditEvent,type HistoricalAuditAction} from './audit';
import {hashOf} from './hash';
import type {CutoffVersion,EvidenceKind,Reason} from './types';

export {templateCsv};
export const STAGE_JOB_KIND='synthetic_historical_stage';
export const BATCH_LIMITS={files:150,totalBytes:150*1024*1024,pdfBytes:25*1024*1024} as const;
const err=(code:string,status=409,details?:unknown)=>new LabError(code,status,details);

/** Settings-driven context. Anything not approved is absent, and an absent policy or cutoff makes every evaluation NotEligible (fail closed). */
export type HistoricalContext={anchorKinds:EvidenceKind[];policyConfigured:boolean;profile:MinimumProfile|null;maxRows:number;cutoff:CutoffVersion|null;policy:Record<string,unknown>};
export async function loadContext(db:Queryable):Promise<HistoricalContext>{
 const s=await readActiveSettings(db);
 const hb=SETTINGS.historical_backfill.schema.parse(s.historical_backfill??SETTINGS.historical_backfill.default);
 const kinds:EvidenceKind[]=hb.anchorPolicy==='A_FINAL_REPORT'?['FINAL_RESULT_REPORT']:hb.anchorPolicy==='B_FINAL_REPORT_OR_CONTROL_RECORD'?['FINAL_RESULT_REPORT','LAB_CONTROL_RECORD']:[];
 const row=(await db.query<{version:number;value:{cutoff:string;impactReportHash:string};effective_from:Date}>("SELECT r.version,r.value,r.effective_from FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='go_live_cutoff'")).rows[0];
 const cutoff=row?{version:row.version,cutoff:row.value.cutoff,effectiveFrom:bangkokDay(row.effective_from),impactReportHash:row.value.impactReportHash}:null;
 return {anchorKinds:kinds,policyConfigured:kinds.length>0,profile:hb.minimumProfile==='PENDING_OD18'?null:hb.minimumProfile,maxRows:hb.maxBatchRows,cutoff,policy:{anchorPolicy:hb.anchorPolicy,minimumProfile:hb.minimumProfile}};
}
export const contextReady=(c:HistoricalContext)=>c.policyConfigured&&c.cutoff!==null;

async function audit(db:Queryable,user:{id:string}|null,action:HistoricalAuditAction,resourceType:'HISTORICAL_DRAFT'|'HISTORICAL_BATCH',resourceId:string|undefined,outcome:string,extra:{reasonCode?:string;count?:number;version?:number}={}){
 await appendAudit(db,historicalAuditEvent({actorId:user?.id,action,resourceType,resourceId,outcome,...extra}));
}

// ---------- Step 1: upload ----------
export type UploadFile={name:string;bytes:Buffer};
const safeBase=(n:string)=>{const b=n.split(/[\\/]/).pop()!.replace(/[\r\n\0]/g,'').trim().slice(0,255);if(!b)throw err('FILE_NAME_INVALID',400);return b;};

export async function createBatch(db:Queryable,user:Staff,store:FileStore,input:{table:UploadFile;files:readonly UploadFile[];idempotencyKey?:string}){
 need(user,'history.draft','write');
 if(!/\.(csv|xlsx)$/i.test(input.table.name))throw err('TABLE_TYPE_NOT_SUPPORTED',400);
 if(!input.table.bytes.length)throw err('TABLE_EMPTY',400);
 if(input.table.bytes.length>TABLE_LIMITS.bytes)throw err('TABLE_TOO_LARGE',413);
 if(input.files.length>BATCH_LIMITS.files)throw err('TOO_MANY_FILES',413);
 if(input.table.bytes.length+input.files.reduce((n,f)=>n+f.bytes.length,0)>BATCH_LIMITS.totalBytes)throw err('UPLOAD_TOO_LARGE',413);
 const key=input.idempotencyKey??randomUUID();
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw err('IDEMPOTENCY_KEY_INVALID',400);
 const prior=(await db.query<{id:string;job_id:string|null;created_by:string}>('SELECT id,job_id,created_by FROM historical_batch WHERE idempotency_key=$1',[key])).rows[0];
 if(prior){if(prior.created_by!==user.id)throw err('IDEMPOTENCY_KEY_REUSED');return {batchId:prior.id,jobId:prior.job_id,replayed:true};}
 const tableHash=await store.put(input.table.bytes);
 const batch=(await db.query<{id:string}>('INSERT INTO historical_batch(created_by,idempotency_key,table_name,table_sha256) VALUES($1,$2,$3,$4) RETURNING id',[user.id,key,safeBase(input.table.name),tableHash])).rows[0].id;
 await db.query("INSERT INTO historical_batch_file(batch_id,role,original_name,sha256,byte_size) VALUES($1,'TABLE',$2,$3,$4)",[batch,safeBase(input.table.name),tableHash,input.table.bytes.length]);
 const addFile=async(role:'PDF'|'ZIP'|'ZIP_MEMBER',name:string,bytes:Buffer,parent:string|null,reject:string|null)=>{
  const hash=await store.put(bytes);
  return (await db.query<{id:string}>('INSERT INTO historical_batch_file(batch_id,parent_id,role,original_name,sha256,byte_size,state,reject_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[batch,parent,role,safeBase(name),hash,bytes.length,reject?'Rejected':'Stored',reject])).rows[0].id;
 };
 for(const f of input.files){
  if(!f.bytes.length){await addFile('PDF',f.name,Buffer.from([0]),null,'EMPTY_FILE');continue;}
  if(f.bytes.length>BATCH_LIMITS.totalBytes){await addFile('PDF',f.name,f.bytes.subarray(0,1),null,'FILE_TOO_LARGE');continue;}
  if(isZip(f.bytes)){
   const zid=await addFile('ZIP',f.name,f.bytes,null,null);
   try{
    const entries=zipEntries(f.bytes).filter(e=>!e.name.endsWith('/'));
    if(entries.length>ZIP_LIMITS.entries)throw new QuarantineError('ZIP_TOO_MANY_ENTRIES');
    for(const e of entries){
     const member=zipRead(f.bytes,e);
     await addFile('ZIP_MEMBER',memberBasename(e.name),member,zid,isPdf(member)?null:'NOT_A_PDF');
    }
    await db.query("UPDATE historical_batch_file SET state='Parsed' WHERE id=$1",[zid]);
   }catch(e){await db.query("UPDATE historical_batch_file SET state='Rejected',reject_code=$2 WHERE id=$1",[zid,e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'ZIP_UNREADABLE']);}
  }else await addFile('PDF',f.name,f.bytes,null,isPdf(f.bytes)?null:'NOT_A_PDF');
 }
 const job=(await db.query<{id:string}>('INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3) RETURNING id',[STAGE_JOB_KIND,JSON.stringify({batchId:batch,actorId:user.id}),`p5h-stage:${batch}`])).rows[0].id;
 await db.query('UPDATE historical_batch SET job_id=$2 WHERE id=$1',[batch,job]);
 await audit(db,user,'HIST_BATCH_UPLOADED','HISTORICAL_BATCH',batch,'QUEUED',{count:input.files.length});
 return {batchId:batch,jobId:job,replayed:false};
}

// ---------- Registry facts under the LN lock (D-49) ----------
const numericLn=(ln:string)=>/^[0-9]{1,40}$/.test(ln);
async function registryFacts(db:Queryable,draft:{id:string;batchId:string;ln:string;hn:string|null;name:string|null;dob:string|null}){
 if(!numericLn(draft.ln))return {activity:NO_ACTIVITY,precheck:{outcome:'CLEAR' as const,findings:[] as Reason[]}};
 await lockLn(db,draft.ln);
 const caseLns=(await db.query<{ln:string;caseId:string;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';version:number}>('SELECT l.ln,l.case_id AS "caseId",c.registration_origin AS origin,l.version FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.ln=$1',[draft.ln])).rows;
 const drafts=(await db.query<{id:string;ln:string}>("SELECT id,ln FROM historical_draft WHERE ln_key=$1 AND batch_id<>$2 AND state NOT IN ('Promoted','Abandoned','Conflict')",[draft.ln,draft.batchId])).rows;
 const intakes=(await db.query<{ln:string;state:string;received:string|null}>("SELECT ln,state,parsed->>'receivedAt' AS received FROM his_inbound_file WHERE ln=$1",[draft.ln])).rows;
 const unlinked=intakes.filter(i=>i.state!=='Applied(S1)').map(i=>{const t=i.received&&!Number.isNaN(new Date(i.received).getTime())?i.received:'9999-12-31T00:00:00Z';return t;});
 const patients:{caseId:string;identifiers:{hn:string;name:string|null;dob:string|null}}[]=[];
 if(draft.hn){
  // The worker role may read only (case_id, hn) of P2 identity; names/DOB live in the P2 request payload that only the web role can read.
  // Without them the match stays "not comparable" (a warning for the reviewer); with them (confirmation, web role) a mismatch blocks.
  const p2=(await db.query<{case_id:string;hn:string}>("SELECT case_id,hn FROM p2_case_identity WHERE ltrim(hn,'0')=ltrim($1,'0')",[draft.hn])).rows;
  let details=new Map<string,{syntheticName?:string;dob?:string|null}|null>();
  if(p2.length){
   await db.query('SAVEPOINT p2_payload');
   try{
    const r=await db.query<{case_id:string;patient:{syntheticName?:string;dob?:string|null}|null}>("SELECT i.case_id,(SELECT payload->'patient' FROM p2_document_revision r WHERE r.case_id=i.case_id AND r.kind='REQUEST' ORDER BY r.version DESC LIMIT 1) AS patient FROM p2_case_identity i WHERE i.case_id=ANY($1::uuid[])",[p2.map(x=>x.case_id)]);
    details=new Map(r.rows.map(x=>[x.case_id,x.patient]));
    await db.query('RELEASE SAVEPOINT p2_payload');
   }catch{await db.query('ROLLBACK TO SAVEPOINT p2_payload');await db.query('RELEASE SAVEPOINT p2_payload');}
  }
  for(const r of p2){const d=details.get(r.case_id);patients.push({caseId:r.case_id,identifiers:{hn:r.hn,name:d?.syntheticName??null,dob:d?.dob??null}});}
  const hd=(await db.query<{id:string;data:DraftData}>("SELECT id,data FROM historical_draft WHERE id<>$1 AND batch_id<>$2 AND state NOT IN ('Abandoned','Conflict') AND ltrim(data->'identifiers'->>'hn','0')=ltrim($3,'0')",[draft.id,draft.batchId,draft.hn])).rows;
  for(const r of hd)patients.push({caseId:r.id,identifiers:{hn:r.data.identifiers.hn??'',name:r.data.identifiers.name,dob:r.data.identifiers.dob}});
 }
 const input:PrecheckInput={ln:draft.ln,identifiers:{hn:draft.hn,name:draft.name,dob:draft.dob},selfDraftId:draft.id,caseLns,activeDrafts:drafts,intakes:intakes.map(i=>({ln:i.ln,state:i.state})),patients};
 const activity:NiptActivity={caseLnExists:caseLns.length>0,petApplied:intakes.some(i=>i.state==='Applied(S1)'),receivedInNipt:false,inBatch:false,released:false,unlinkedIntakeHisReceivedAt:unlinked};
 return {activity,precheck:precheckHistoricalDraft(input)};
}

const WARN_FINDINGS=new Set(['IDENTITY_MATCH_EXISTING_PATIENT_REVIEW','POSSIBLE_DUPLICATE_PATIENT_DIFFERENT_HN','HN_ONLY_MATCH_NOT_LINKED']);
/** A registry finding blocks unless it only says "a person should look" (same patient seen again, same name+DOB under another HN, or an HN match that cannot be compared — never linked). A comparable mismatch still blocks. */
const blocking=(f:Reason)=>!WARN_FINDINGS.has(f.code);
// ---------- Evaluation (the background mechanism: Draft → Submit → NotEligible/Submitted) ----------
type StoredData=DraftData&{cells:Partial<Record<ColumnKey,string>>;staticIssues:RowIssue[]};
type DraftRow={id:string;batch_id:string;row_no:number;ln:string;state:string;data:StoredData;issues:RowIssue[];version:number;contributor_ids:string[];pdf_file_id:string|null;evaluation_id:string|null};
export function evaluateWithContext(ctx:HistoricalContext,input:Omit<EligibilityInput,'cutoff'|'policy'>):EligibilityResult{
 if(!ctx.policyConfigured){
  // OD-18 undecided: nothing is eligible and no Anchor kind is assumed.
  const reasons:Reason[]=[{code:'ANCHOR_POLICY_NOT_CONFIGURED'},...(ctx.cutoff?[]:[{code:'CUTOFF_NOT_CONFIGURED'}])];
  const snapshot={ruleVersion:ELIGIBILITY_RULE_VERSION,cutoff:ctx.cutoff?{version:ctx.cutoff.version,cutoff:ctx.cutoff.cutoff}:null,policy:{acceptedAnchorKinds:[] as string[]},anchor:null,events:[],activity:{caseLnExists:input.activity.caseLnExists,petApplied:input.activity.petApplied,receivedInNipt:false,inBatch:false,released:false,unlinkedIntakeDays:[] as string[]},reasons};
  return {outcome:'NotEligible',reasons,snapshot,hash:hashOf(snapshot)};
 }
 return evaluateEligibility({...input,cutoff:ctx.cutoff,policy:{acceptedAnchorKinds:ctx.anchorKinds}});
}
async function evaluateDraft(db:Queryable,ctx:HistoricalContext,user:{id:string}|null,d:DraftRow,duplicateInBatch:boolean){
 const data=d.data;
 const ident={id:d.id,batchId:d.batch_id,ln:d.ln,hn:data.identifiers.hn,name:data.identifiers.name,dob:data.identifiers.dob};
 const facts=await registryFacts(db,ident);
 const dynamic:RowIssue[]=facts.precheck.findings.map(f=>({code:f.code,severity:blocking(f)?'ERROR' as const:'WARN' as const,ref:f.ref}));
 if(duplicateInBatch)dynamic.unshift({code:'DUPLICATE_LN_IN_BATCH',severity:'ERROR',field:'ln'});
 const issues=[...data.staticIssues,...dynamic];
 const hasError=issues.some(i=>i.severity==='ERROR');
 const lnKey=!hasError&&numericLn(d.ln)?d.ln:null;
 let target='Draft',evalId=d.evaluation_id;
 if(!hasError){
  const input={evidence:data.evidence,events:data.events,activity:facts.activity};
  const r=evaluateWithContext(ctx,input);
  evalId=(await db.query<{id:string}>('INSERT INTO historical_eligibility_evaluation(draft_id,draft_version,cutoff_version,cutoff,outcome,reasons,snapshot,hash,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
   [d.id,d.version,ctx.cutoff?.version??null,ctx.cutoff?.cutoff??null,r.outcome,JSON.stringify(r.reasons),JSON.stringify(r.snapshot),r.hash,user?.id??null])).rows[0].id;
  target=r.outcome;
 }
 // Plan diagram: NotEligible/Discrepancy return to Draft before they can become Submitted or be re-judged.
 if(target!=='Draft'&&(d.state==='NotEligible'||d.state==='Discrepancy'))await db.query("UPDATE historical_draft SET state='Draft' WHERE id=$1",[d.id]);
 await db.query('UPDATE historical_draft SET issues=$2,ln_key=$3,evaluation_id=$4,state=$5 WHERE id=$1',[d.id,JSON.stringify(issues),lnKey,evalId,target]);
 return target;
}
const loadDraft=async(db:Queryable,id:string,lock=false)=>(await db.query<DraftRow>(`SELECT id,batch_id,row_no,ln,state,data,issues,version,contributor_ids,pdf_file_id,evaluation_id FROM historical_draft WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];

// ---------- Worker: stage a batch ----------
async function pdfInfos(db:Queryable,store:FileStore,batchId:string):Promise<PdfInfo[]>{
 const files=(await db.query<{id:string;original_name:string;sha256:string;state:string;role:string}>("SELECT id,original_name,sha256,state,role FROM historical_batch_file WHERE batch_id=$1 AND role IN ('PDF','ZIP_MEMBER') AND state<>'Rejected' ORDER BY created_at,id",[batchId])).rows;
 const out:PdfInfo[]=[];
 for(const f of files){
  let parsed:PdfInfo['parsed']=null,reject:string|null=null;
  try{
   const bytes=await store.get(f.sha256);screen(bytes,BATCH_LIMITS.pdfBytes);
   const x=await extract(bytes);
   if(x.container==='ZIP_BATCH')reject='NESTED_BATCH_ZIP';
   else{
    const p=parseReport(x.text,f.original_name);
    if(p.templateKind!=='UNKNOWN'&&p.templateKind!=='REDRAW_NOTICE')parsed={ln:p.identifiers.labNumber.value,hn:p.identifiers.hn.value,name:p.identifiers.patientName.value,dob:p.identifiers.dob.value??null,reportedDate:p.identifiers.reportedDate.value??null};
   }
  }catch(e){reject=e instanceof QuarantineError?e.message:'PDF_UNREADABLE';}
  if(reject){await db.query("UPDATE historical_batch_file SET state='Rejected',reject_code=$2 WHERE id=$1",[f.id,reject]);continue;}
  await db.query("UPDATE historical_batch_file SET state='Parsed',parsed=$2 WHERE id=$1",[f.id,parsed?JSON.stringify(parsed):null]);
  out.push({fileId:f.id,name:f.original_name,sha256:f.sha256,parsed});
 }
 return out;
}
function withCompleteness(data:DraftData,profile:MinimumProfile|null):DraftData{
 return {...data,completeness:profile?{profile,...evidenceCompleteness(data.facts,profile)}:null};
}
function rowData(row:TableRow,pdfs:readonly PdfInfo[],profile:MinimumProfile|null):{data:StoredData;pdf:PdfInfo|null;issues:RowIssue[]}{
 const rawLn=(row.cells.ln??'').trim();
 const m=matchPdf(row.cells.pdf_file??'',rawLn,pdfs);
 const built=buildDraftData(row,m.pdf);
 const issues=[...built.issues,...(m.issue?[m.issue]:[])];
 return {data:{...withCompleteness(built.data,profile),cells:row.cells,staticIssues:issues},pdf:m.pdf,issues};
}

export async function stageBatch(db:Queryable,store:FileStore,batchId:string,actorId:string){
 const b=(await db.query<{state:string;table_name:string;table_sha256:string;created_by:string}>('SELECT state,table_name,table_sha256,created_by FROM historical_batch WHERE id=$1 FOR UPDATE',[batchId])).rows[0];
 if(!b)throw err('NOT_FOUND',404);
 if(b.state==='Staged'||b.state==='Failed')return {state:b.state};
 await db.query("UPDATE historical_batch SET state='Staging' WHERE id=$1",[batchId]);
 const fail=async(code:string)=>{await db.query("UPDATE historical_batch SET state='Failed',error_code=$2,staged_at=now() WHERE id=$1",[batchId,code]);await audit(db,{id:actorId},'HIST_BATCH_FAILED','HISTORICAL_BATCH',batchId,'FAILED',{reasonCode:code});return {state:'Failed'};};
 const ctx=await loadContext(db);
 let table;try{table=readTable(b.table_name,await store.get(b.table_sha256));}catch(e){return fail(e instanceof TableError?e.code:'TABLE_UNREADABLE');}
 if(table.rows.length>ctx.maxRows)return fail('TABLE_TOO_MANY_ROWS');
 const pdfs=await pdfInfos(db,store,batchId);
 const prepared=table.rows.map(r=>({row:r,...rowData(r,pdfs,ctx.profile)}));
 // Duplicates inside the sheet block every row of the group until the staff fixes or abandons all but one.
 const lnCount=new Map<string,number>();for(const p of prepared){const k=(p.row.cells.ln??'').trim();if(k)lnCount.set(k,(lnCount.get(k)??0)+1);}
 const pdfUse=new Map<string,number>();for(const p of prepared)if(p.pdf)pdfUse.set(p.pdf.fileId,(pdfUse.get(p.pdf.fileId)??0)+1);
 for(const p of prepared){
  const ln=(p.row.cells.ln??'').trim();
  if(p.pdf&&(pdfUse.get(p.pdf.fileId)??0)>1){const i:RowIssue={code:'PDF_SHARED_BY_ROWS',severity:'ERROR',field:'pdf_file'};p.issues.push(i);p.data.staticIssues.push(i);}
  const dup=(lnCount.get(ln)??0)>1;
  const id=(await db.query<{id:string}>("INSERT INTO historical_draft(batch_id,row_no,ln,state,data,issues,pdf_file_id,contributor_ids) VALUES($1,$2,$3,'Draft',$4,'[]',$5,$6) RETURNING id",[batchId,p.row.rowNo,ln||'(blank)',JSON.stringify(p.data),p.pdf?.fileId??null,[actorId]])).rows[0].id;
  await db.query("INSERT INTO historical_draft_revision(draft_id,version,data,actor_id,reason) VALUES($1,1,$2,$3,'นำเข้าจากตาราง')",[id,JSON.stringify(p.data),actorId]);
  await evaluateDraft(db,ctx,{id:actorId},(await loadDraft(db,id,true))!,dup);
 }
 const used=new Set(prepared.map(p=>p.pdf?.fileId).filter(Boolean));
 const batchIssues:{code:string;ref?:string}[]=[];
 for(const f of pdfs)if(!used.has(f.fileId))batchIssues.push({code:'PDF_NOT_USED',ref:f.name});
 const rej=(await db.query<{original_name:string;reject_code:string}>("SELECT original_name,reject_code FROM historical_batch_file WHERE batch_id=$1 AND state='Rejected'",[batchId])).rows;
 for(const r of rej)batchIssues.push({code:`FILE_REJECTED_${r.reject_code}`,ref:r.original_name});
 await db.query("UPDATE historical_batch SET state='Staged',row_count=$2,cutoff_version=$3,policy=$4,issues=$5,staged_at=now() WHERE id=$1",[batchId,table.rows.length,ctx.cutoff?.version??null,JSON.stringify(ctx.policy),JSON.stringify(batchIssues)]);
 await audit(db,{id:actorId},'HIST_BATCH_STAGED','HISTORICAL_BATCH',batchId,'STAGED',{count:table.rows.length});
 return {state:'Staged',rows:table.rows.length};
}

// ---------- Step 2: read and fix ----------
const ABANDON_STATES=['Draft','NotEligible','Discrepancy'];
export async function listBatches(db:Queryable,user:Staff){
 need(user,'history.read','read');
 return (await db.query(`SELECT b.id,b.state,b.table_name,b.row_count,b.error_code,b.created_at,
  count(d.*) FILTER(WHERE d.state='Submitted')::int AS submitted,count(d.*) FILTER(WHERE d.state='Promoted')::int AS promoted,
  count(d.*) FILTER(WHERE d.state IN ('Draft','NotEligible','Discrepancy','Conflict'))::int AS needs_attention
  FROM historical_batch b LEFT JOIN historical_draft d ON d.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`)).rows;
}
export async function getBatch(db:Queryable,user:Staff,id:string){
 need(user,'history.read','read');
 const b=(await db.query<Record<string,unknown>>('SELECT id,state,created_by,created_at,table_name,row_count,error_code,issues,cutoff_version,policy,staged_at FROM historical_batch WHERE id=$1',[z.uuid().parse(id)])).rows[0];
 if(!b)throw err('NOT_FOUND',404);
 const ctx=await loadContext(db);
 const rows=(await db.query<{id:string;row_no:number;ln:string;state:string;version:number;issues:RowIssue[];data:StoredData;contributor_ids:string[];evaluation:{outcome:string;reasons:Reason[];hash:string;cutoff_version:number|null}|null;pdf_name:string|null}>(
  `SELECT d.id,d.row_no,d.ln,d.state,d.version,d.issues,d.data,d.contributor_ids,
   (SELECT json_build_object('outcome',e.outcome,'reasons',e.reasons,'hash',e.hash,'cutoff_version',e.cutoff_version) FROM historical_eligibility_evaluation e WHERE e.id=d.evaluation_id) AS evaluation,
   (SELECT f.original_name FROM historical_batch_file f WHERE f.id=d.pdf_file_id) AS pdf_name
   FROM historical_draft d WHERE d.batch_id=$1 ORDER BY d.row_no`,[id])).rows;
 const files=(await db.query("SELECT id,role,original_name,state,reject_code,byte_size FROM historical_batch_file WHERE batch_id=$1 AND role<>'TABLE' ORDER BY created_at,id",[id])).rows;
 await audit(db,user,'HIST_BATCH_VIEWED','HISTORICAL_BATCH',id,'VIEWED',{count:rows.length});
 return {
  batch:b,ready:contextReady(ctx),blockers:[...(ctx.policyConfigured?[]:['ANCHOR_POLICY_NOT_CONFIGURED']),...(ctx.cutoff?[]:['CUTOFF_NOT_CONFIGURED'])],
  files,
  rows:rows.map(r=>({id:r.id,rowNo:r.row_no,ln:r.ln,state:r.state,version:r.version,issues:r.issues,evaluation:r.evaluation,pdfName:r.pdf_name,
   identifiers:r.data.identifiers,originalLocation:r.data.originalLocation,evidence:r.data.evidence.map(e=>({id:e.id,kind:e.kind,date:e.documentDate,provenance:e.provenance})),events:r.data.events.map(e=>({id:e.id,type:e.type,date:e.date})),
   facts:r.data.facts,pastCertification:r.data.pastCertification,completeness:r.data.completeness,cells:r.data.cells,
   canVerify:!r.contributor_ids.includes(user.id)&&r.state==='Submitted'})),
 };
}

const patchSchema=z.record(z.string(),z.string().max(500));
const FIXABLE=new Set<string>(['ln','hn','name','dob','collection_date','receipt_date','report_date','control_record_date','request_date','consent_date','pdf_file','original_location','request_paper','consent_paper','consent_decision','pregnancy_type','past_certification']);
export async function fixRow(db:Queryable,user:Staff,store:FileStore,draftId:string,rawPatch:unknown,reason:string){
 need(user,'history.draft','write');
 const patch=patchSchema.parse(rawPatch);
 for(const k of Object.keys(patch))if(!FIXABLE.has(k))throw err('COLUMN_NOT_EDITABLE',400);
 if(reason.trim().length<8||reason.length>250)throw err('REASON_REQUIRED',400);
 const d=await loadDraft(db,z.uuid().parse(draftId),true);
 if(!d)throw err('NOT_FOUND',404);
 if(!ABANDON_STATES.includes(d.state))throw err('ROW_NOT_EDITABLE');
 const ctx=await loadContext(db);
 const cells={...d.data.cells,...patch} as Partial<Record<ColumnKey,string>>;
 const pdfs=await pdfInfosCached(db,d.batch_id);
 const {data,pdf}=rowData({rowNo:d.row_no,cells},pdfs,ctx.profile);
 const newLn=(cells.ln??'').trim()||'(blank)';
 const oldLn=d.ln;
 const version=d.version+1;
 const contributors=[...new Set([...d.contributor_ids,user.id])];
 if(d.state!=='Draft')await db.query("UPDATE historical_draft SET state='Draft' WHERE id=$1",[d.id]);
 await db.query('UPDATE historical_draft SET ln=$2,data=$3,pdf_file_id=$4,version=$5,contributor_ids=$6,ln_key=NULL WHERE id=$1',[d.id,newLn,JSON.stringify(data),pdf?.fileId??null,version,contributors]);
 await db.query('INSERT INTO historical_draft_revision(draft_id,version,data,actor_id,reason) VALUES($1,$2,$3,$4,$5)',[d.id,version,JSON.stringify(data),user.id,reason.trim()]);
 const sharing=pdf?(await db.query<{n:string}>("SELECT count(*)::text AS n FROM historical_draft WHERE batch_id=$1 AND pdf_file_id=$2 AND state<>'Abandoned' AND id<>$3",[d.batch_id,pdf.fileId,d.id])).rows[0].n!=='0':false;
 if(sharing)data.staticIssues.push({code:'PDF_SHARED_BY_ROWS',severity:'ERROR',field:'pdf_file'});
 await db.query('UPDATE historical_draft SET data=$2 WHERE id=$1',[d.id,JSON.stringify(data)]);
 const siblings=(await db.query<{n:string}>("SELECT count(*)::text AS n FROM historical_draft WHERE batch_id=$1 AND ln=$2 AND state NOT IN ('Abandoned','Promoted') AND id<>$3",[d.batch_id,newLn,d.id])).rows[0].n;
 const fresh=(await loadDraft(db,d.id,true))!;
 const state=await evaluateDraft(db,ctx,user,fresh,siblings!=='0');
 await audit(db,user,'HIST_ROW_CORRECTED','HISTORICAL_DRAFT',d.id,state.toUpperCase(),{version});
 await refreshSiblings(db,ctx,user,d.batch_id,[oldLn,newLn],d.id);
 return {state,version};
}
async function pdfInfosCached(db:Queryable,batchId:string):Promise<PdfInfo[]>{
 const f=(await db.query<{id:string;original_name:string;sha256:string;parsed:PdfInfo['parsed']}>("SELECT id,original_name,sha256,parsed FROM historical_batch_file WHERE batch_id=$1 AND role IN ('PDF','ZIP_MEMBER') AND state='Parsed' ORDER BY created_at,id",[batchId])).rows;
 return f.map(x=>({fileId:x.id,name:x.original_name,sha256:x.sha256,parsed:x.parsed}));
}
/** After a fix or abandon, a row that was only blocked by a duplicate LN is released once it is the sole holder of that LN. */
async function refreshSiblings(db:Queryable,ctx:HistoricalContext,user:{id:string},batchId:string,lns:string[],exceptId:string){
 for(const ln of new Set(lns.filter(l=>l!=='(blank)'))){
  const group=(await db.query<{id:string}>("SELECT id FROM historical_draft WHERE batch_id=$1 AND ln=$2 AND state NOT IN ('Abandoned','Promoted','Conflict','Submitted') ORDER BY row_no",[batchId,ln])).rows;
  const holders=(await db.query<{n:string}>("SELECT count(*)::text AS n FROM historical_draft WHERE batch_id=$1 AND ln=$2 AND state NOT IN ('Abandoned','Promoted','Conflict')",[batchId,ln])).rows[0].n;
  if(holders!=='1')continue;
  for(const g of group){if(g.id===exceptId)continue;const row=(await loadDraft(db,g.id,true))!;if(row.issues.some(i=>i.code==='DUPLICATE_LN_IN_BATCH'))await evaluateDraft(db,ctx,user,row,false);}
 }
}
export async function abandonRow(db:Queryable,user:Staff,draftId:string,reason:string){
 need(user,'history.draft','write');
 if(reason.trim().length<8||reason.length>250)throw err('REASON_REQUIRED',400);
 const d=await loadDraft(db,z.uuid().parse(draftId),true);
 if(!d)throw err('NOT_FOUND',404);
 if(!ABANDON_STATES.includes(d.state))throw err('ROW_NOT_EDITABLE');
 if(d.state==='Discrepancy')await db.query("UPDATE historical_draft SET state='Draft' WHERE id=$1",[d.id]);
 await db.query("UPDATE historical_draft SET state='Abandoned',ln_key=NULL WHERE id=$1",[d.id]);
 await audit(db,user,'HIST_DRAFT_ABANDONED','HISTORICAL_DRAFT',d.id,'ABANDONED');
 await refreshSiblings(db,await loadContext(db),user,d.batch_id,[d.ln],d.id);
 return {state:'Abandoned'};
}

// ---------- Step 3: independent review and batch confirmation ----------
export const attestationSchema=z.strictObject({
 lnMatchesOriginal:z.boolean(),anchorDateMatchesOriginal:z.boolean(),pdfBindingMatchesOriginal:z.boolean(),identityMatchesOriginal:z.boolean(),
 identityIdentifiersChecked:z.array(z.enum(['HN','NAME','DOB','NATIONAL_ID'])).max(4),
});
export const confirmSchema=z.strictObject({
 idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
 rows:z.array(z.strictObject({draftId:z.uuid(),version:z.number().int().positive(),attestation:attestationSchema})).min(1).max(200),
});
export type RowOutcome={draftId:string;rowNo:number;outcome:'PROMOTED'|'ALREADY_PROMOTED'|'DISCREPANCY'|'CONFLICT'|'NOT_ELIGIBLE'|'REJECTED';code?:string;reasons?:Reason[]};

/**
 * Confirms the rows the second person ticked, each in its own savepoint under its own LN lock, so one bad row never blocks or half-creates another.
 * The reviewer supplies an explicit attestation per row (no batch-wide "all correct" flag). Nothing here can create a release, export or HIS file.
 */
export async function confirmBatch(db:Queryable,user:Staff,batchId:string,lookupKey:Buffer,rawInput:unknown){
 need(user,'history.promote','approve');
 if(lookupKey.length!==32)throw err('LOOKUP_KEY_REQUIRED',500);
 const input=confirmSchema.parse(rawInput);
 const ctx=await loadContext(db);
 if(!contextReady(ctx))throw err('HISTORICAL_POLICY_NOT_CONFIGURED');
 const b=(await db.query<{state:string}>('SELECT state FROM historical_batch WHERE id=$1 FOR UPDATE',[z.uuid().parse(batchId)])).rows[0];
 if(!b)throw err('NOT_FOUND',404);
 if(b.state!=='Staged')throw err('BATCH_NOT_STAGED');
 if(new Set(input.rows.map(r=>r.draftId)).size!==input.rows.length)throw err('DUPLICATE_ROW_IN_REQUEST',400);
 const outcomes:RowOutcome[]=[];
 for(const item of input.rows){
  const sp=`row_${outcomes.length}`;
  await db.query(`SAVEPOINT ${sp}`);
  try{
   const o=await confirmRow(db,user,ctx,batchId,lookupKey,input.idempotencyKey,item);
   await db.query(`RELEASE SAVEPOINT ${sp}`);outcomes.push(o);
  }catch(e){
   await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);await db.query(`RELEASE SAVEPOINT ${sp}`);
   const code=e instanceof LabError?e.code:e instanceof Error&&/^[A-Z0-9_]{3,64}$/.test(e.message)?e.message:/historical|HISTORICAL/.test(String(e))?'DATABASE_GUARD_REFUSED':'ROW_FAILED';
   outcomes.push({draftId:item.draftId,rowNo:0,outcome:'REJECTED',code});
  }
 }
 const count=(o:RowOutcome['outcome'])=>outcomes.filter(x=>x.outcome===o).length;
 await audit(db,user,'HIST_BATCH_CONFIRMED','HISTORICAL_BATCH',batchId,count('PROMOTED')===outcomes.length?'ALL_PROMOTED':'PARTIAL',{count:count('PROMOTED')});
 return {outcomes,summary:{promoted:count('PROMOTED'),alreadyPromoted:count('ALREADY_PROMOTED'),discrepancy:count('DISCREPANCY'),conflict:count('CONFLICT'),rejected:count('REJECTED')}};
}
async function confirmRow(db:Queryable,user:Staff,ctx:HistoricalContext,batchId:string,lookupKey:Buffer,batchKey:string,item:z.infer<typeof confirmSchema>['rows'][number]):Promise<RowOutcome>{
 const peek=await loadDraft(db,item.draftId);
 if(!peek||peek.batch_id!==batchId)return {draftId:item.draftId,rowNo:0,outcome:'REJECTED',code:'NOT_FOUND'};
 if(numericLn(peek.ln))await lockLn(db,peek.ln);
 const d=(await loadDraft(db,item.draftId,true))!;
 const base={draftId:d.id,rowNo:d.row_no};
 if(d.version!==item.version)return {...base,outcome:'REJECTED',code:'STALE_VERSION'};
 const key=hashOf({batchKey,draftId:d.id});
 const promotedKey=d.state==='Promoted'?(await db.query<{promoted_key:string}>('SELECT promoted_key FROM historical_draft WHERE id=$1',[d.id])).rows[0].promoted_key:null;
 const ident={id:d.id,batchId:d.batch_id,ln:d.ln,hn:d.data.identifiers.hn,name:d.data.identifiers.name,dob:d.data.identifiers.dob};
 const facts=await registryFacts(db,ident);
 // Same-batch drafts are not registry findings; cross-batch active drafts and registered LNs are.
 const decision=decidePromotion({
  draft:{id:d.id,state:d.state as never,contributorIds:d.contributor_ids,promotedIdempotencyKey:promotedKey},
  verifier:{id:user.id,hasHistoricalVerifierRole:user.roles.includes('HISTORICAL_VERIFIER')},
  attestation:item.attestation as Attestation,idempotencyKey:key,
  reevaluation:{evidence:d.data.evidence,events:d.data.events,cutoff:ctx.cutoff,activity:facts.activity,policy:{acceptedAnchorKinds:ctx.anchorKinds}},
  registryFindings:facts.precheck.findings.filter(blocking),
 });
 const record=async(action:HistoricalAuditAction,outcome:string,reasonCode?:string)=>audit(db,user,action,'HISTORICAL_DRAFT',d.id,outcome,{reasonCode,version:d.version});
 switch(decision.kind){
  case 'ALREADY_PROMOTED':return {...base,outcome:'ALREADY_PROMOTED'};
  case 'REJECT':await record('HIST_PROMOTE_REJECTED','REJECTED',decision.code);return {...base,outcome:'REJECTED',code:decision.code,reasons:decision.reasons};
  case 'DISCREPANCY':
   await db.query("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) VALUES($1,$2,$3,'DISCREPANCY',$4,$5)",[d.id,d.version,user.id,JSON.stringify(item.attestation),key]);
   await db.query("UPDATE historical_draft SET state='Discrepancy',issues=$2 WHERE id=$1",[d.id,JSON.stringify([...d.issues.filter(i=>!i.code.startsWith('REVIEW_')),...decision.fields.map(f=>({code:`REVIEW_MISMATCH_${f.toUpperCase()}`,severity:'ERROR' as const}))])]);
   await record('HIST_PROMOTE_DISCREPANCY','DISCREPANCY');return {...base,outcome:'DISCREPANCY',code:decision.fields.join(',')};
  case 'NOT_ELIGIBLE':{
   const ev=decision.evaluation;
   const evId=(await db.query<{id:string}>('INSERT INTO historical_eligibility_evaluation(draft_id,draft_version,cutoff_version,cutoff,outcome,reasons,snapshot,hash,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [d.id,d.version,ctx.cutoff!.version,ctx.cutoff!.cutoff,ev.outcome,JSON.stringify(ev.reasons),JSON.stringify(ev.snapshot),ev.hash,user.id])).rows[0].id;
   await db.query("UPDATE historical_draft SET state='NotEligible',evaluation_id=$2 WHERE id=$1",[d.id,evId]);
   await record('HIST_SUBMIT_NOT_ELIGIBLE','NOT_ELIGIBLE',decision.reasons[0]?.code);return {...base,outcome:'NOT_ELIGIBLE',reasons:decision.reasons};}
  case 'CONFLICT':
   await db.query("UPDATE historical_draft SET state='Conflict',ln_key=NULL,issues=$2 WHERE id=$1",[d.id,JSON.stringify([...d.issues,...decision.reasons.map(r=>({code:r.code,severity:'ERROR' as const,ref:r.ref}))])]);
   await record('HIST_PROMOTE_CONFLICT','CONFLICT',decision.reasons[0]?.code);return {...base,outcome:'CONFLICT',reasons:decision.reasons};
  case 'PROMOTE':{
   const ev=decision.evaluation;
   const evId=(await db.query<{id:string}>('INSERT INTO historical_eligibility_evaluation(draft_id,draft_version,cutoff_version,cutoff,outcome,reasons,snapshot,hash,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [d.id,d.version,ctx.cutoff!.version,ctx.cutoff!.cutoff,ev.outcome,JSON.stringify(ev.reasons),JSON.stringify(ev.snapshot),ev.hash,user.id])).rows[0].id;
   await db.query('UPDATE historical_draft SET evaluation_id=$2 WHERE id=$1',[d.id,evId]);
   const vid=(await db.query<{id:string}>("INSERT INTO historical_verification(draft_id,draft_version,verifier_id,result,attestation,batch_key) VALUES($1,$2,$3,'CONFIRMED',$4,$5) RETURNING id",[d.id,d.version,user.id,JSON.stringify(item.attestation),key])).rows[0].id;
   const hn=d.data.identifiers.hn!;
   await db.query('SELECT historical_promote($1,$2,$3,$4)',[d.id,vid,lnHnKey(d.ln,hn,lookupKey),key]);
   await record('HIST_PROMOTED','PROMOTED');return {...base,outcome:'PROMOTED'};
  }
 }
}

// ---------- Original PDF for the reviewer ----------
export async function readBatchPdf(db:Queryable,user:Staff,store:FileStore,batchId:string,fileId:string){
 need(user,'history.read','read');
 const f=(await db.query<{sha256:string;original_name:string}>("SELECT sha256,original_name FROM historical_batch_file WHERE id=$1 AND batch_id=$2 AND role IN ('PDF','ZIP_MEMBER') AND state='Parsed'",[z.uuid().parse(fileId),z.uuid().parse(batchId)])).rows[0];
 if(!f)throw err('NOT_FOUND',404);
 await audit(db,user,'HIST_FILE_VIEWED','HISTORICAL_BATCH',batchId,'VIEWED');
 const bytes=await store.get(f.sha256);
 if(sha256(bytes)!==f.sha256)throw err('ORIGINAL_UNREADABLE',500);
 return {bytes,sha256:f.sha256,name:f.original_name};
}

/** Re-runs the background evaluation for rows still open (e.g. after the Owner configures the Anchor policy or the cutoff). Never touches Submitted/Promoted rows. */
export async function recheckBatch(db:Queryable,user:Staff,batchId:string){
 need(user,'history.draft','write');
 const ctx=await loadContext(db);
 const rows=(await db.query<{id:string}>("SELECT id FROM historical_draft WHERE batch_id=$1 AND state IN ('Draft','NotEligible') ORDER BY row_no",[z.uuid().parse(batchId)])).rows;
 let n=0;
 for(const r of rows){
  const d=(await loadDraft(db,r.id,true))!;
  const holders=(await db.query<{n:string}>("SELECT count(*)::text AS n FROM historical_draft WHERE batch_id=$1 AND ln=$2 AND state NOT IN ('Abandoned','Promoted','Conflict')",[batchId,d.ln])).rows[0].n;
  await evaluateDraft(db,ctx,user,d,holders!=='1');n++;
 }
 return {rechecked:n,ready:contextReady(ctx)};
}

/** Worker entry for the staging job. */
export async function runHistoricalJob(db:Queryable,store:FileStore,payload:unknown){
 const p=z.strictObject({batchId:z.uuid(),actorId:z.uuid()}).parse(payload);
 return stageBatch(db,store,p.batchId,p.actorId);
}
