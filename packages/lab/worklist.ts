import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {pageFields,clampPage,offsetOf,type PageMeta} from '../db/pagination';
import {authorize} from '../security/policy';
import {assertSession,need,attemptFacts,pendingPolicy,assignmentDecision,candidatePrintedId,caseVisible,gestationalAge,type Staff,type AttemptRow} from './core';
import {compareReceive} from './receive-sort';
import {specimenDisplayCode} from './rules';

export type QueueCategory='READY'|'GATE_BLOCKED'|'IN_BATCH'|'IN_PROGRESS'|'QC_FAILED'|'NEEDS_DECISION'|'REDRAW_EXPECTED'|'LN_HALOS_MISSING'|'OTHER';
const iso=(d:Date|null)=>d?d.toISOString():null;

export function worklistRow(r:AttemptRow,policy:'HOLD'|'PROCEED_SYNTHETIC_LABELLED'){
 const gate=r.attempt_state==='Ready'?assignmentDecision(r,policy):null;
 const category:QueueCategory=r.attempt_state==='Ready'?(gate!.eligible?'READY':'GATE_BLOCKED'):r.attempt_state==='Assigned'?'IN_BATCH':r.attempt_state==='InProgress'?'IN_PROGRESS':r.attempt_state==='QcFailed'?'QC_FAILED':['Stopped','BatchCancelled'].includes(r.attempt_state)?'NEEDS_DECISION':'OTHER';
 const code=r.ln_halos?specimenDisplayCode(r.ln_halos,r.pregnancy,r.ln_halos_resampling):r.ln_halos; // OD-R1a: BASE[D][R]
 return {kind:'ATTEMPT' as const,category,caseId:r.case_id,roundId:r.round_id,roundNumber:r.round_number,receivedSource:r.received_source,receivedAt:iso(r.received_at),hisLn:r.ln,lnHalos:r.ln_halos,labelCode:code,pregnancy:r.pregnancy,ga:gestationalAge(r),
  attemptId:r.attempt_id,attemptNumber:r.attempt_number,attemptState:r.attempt_state,printedSampleId:candidatePrintedId(r).id,repeat:r.repeat_order_id?{level:r.repeat_level,state:r.repeat_state}:null,
  urgent:r.urgent,urgentReason:r.urgent_reason,hold:r.hold?{stage:r.hold_stage}:null,resumeDecisionRequired:r.resume_decision_required,qcFailedStage:r.qc_failed_stage,
  gate:gate&&{eligible:gate.eligible,syntheticPendingAccepted:gate.syntheticPendingAccepted,failed:gate.failed,pending:gate.pending},
  placement:r.slot_batch_id?{batchId:r.slot_batch_id,runLabel:r.run_label,slot:r.slot_number,sheetState:r.sheet_state}:null,labels:{prints:r.label_prints,lastPrintedAt:iso(r.last_label_print)}};
}
export type WorklistAttempt=ReturnType<typeof worklistRow>;
export type WorklistExpected={kind:'REDRAW_EXPECTED';category:QueueCategory;caseId:string;roundId:string;roundNumber:number;hisLn:string;requestedAt:string;reasonCode:string;previousLnHalos:string|null};
export type WorklistMissing={kind:'LN_HALOS_MISSING';category:QueueCategory;caseId:string;roundId:string;roundNumber:number;hisLn:string;receivedAt:string;receivedSource:string};

export const WORKLIST_TABS=['READY','GATE_BLOCKED','IN_BATCH','DECISION','REDRAW_EXPECTED','LN_HALOS_MISSING'] as const;
export type WorklistTab=typeof WORKLIST_TABS[number];
/** Ready attempts are classified (Ready vs Gate-blocked) by the Owner-locked assignment gate, which is evaluated in TypeScript on the full
 * per-attempt facts. That is done in bounded chunks and only for attempts still in state Ready, in the order of the requested sort.
 * Up to READY_SCAN_LIMIT attempts are always classified (exact counts and totals). Beyond that the scan continues only until the requested page of
 * the active Ready/Gate tab is full, so an eligible case behind many Gate-blocked ones is still reachable by paging and FIFO order is never broken;
 * totals are then a lower bound (`scan.capped`). READY_HARD_LIMIT bounds the id list itself. */
export const READY_SCAN_LIMIT=10000;
export const READY_HARD_LIMIT=100000;
const CHUNK=400;

const flag=z.union([z.boolean(),z.enum(['0','1','true','false'])]).default(false).transform(v=>v===true||v==='1'||v==='true');
const inputSchema=z.strictObject({tab:z.enum(WORKLIST_TABS).default('READY'),q:z.string().trim().max(80).default(''),round:z.enum(['ALL','S1','S2']).default('ALL'),unprinted:flag,urgent:flag,sort:z.enum(['asc','desc']).default('asc'),...pageFields(50)});
export type WorklistInput=z.input<typeof inputSchema>;

export type WorklistPage={policy:string;operational:boolean;generatedAt:string;tab:WorklistTab;counts:Record<WorklistTab,number>;scan:{capped:boolean;limit:number;scanned:number;ready:number};page:PageMeta;
 filters:{q:string;round:'ALL'|'S1'|'S2';unprinted:boolean;urgent:boolean;sort:'asc'|'desc'};attempts:WorklistAttempt[];expected:WorklistExpected[];missing:WorklistMissing[]};

const FIRST_UNIT=`(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1)`;
// Same population as the original worklist: the live attempt (highest number) of each case's current round, never historical imports.
const ATTEMPTS=`FROM analytical_attempt a JOIN specimen_round_current r ON r.id=a.round_id JOIN nipt_case c ON c.id=a.case_id JOIN case_ln l ON l.id=r.case_ln_id
 LEFT JOIN specimen_lab_number n ON n.round_id=r.id LEFT JOIN lab_slot_assignment sa ON sa.attempt_id=a.id AND sa.removed_at IS NULL LEFT JOIN lab_batch b ON b.id=sa.batch_id
 WHERE c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL' AND a.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=a.round_id)
 AND (COALESCE(${FIRST_UNIT}::text,'')||':'||c.registration_origin)=ANY($1::text[])`;
/** Same row set as ATTEMPTS but only the two tables the filter needs. The full ATTEMPTS join multiplies two opaque selectivity guesses (latest-attempt
 * sub-select x scope expression) down to "1 row", so PostgreSQL nests seq scans of specimen_round/case_ln per attempt: O(N^2), ~8 s at 12 000 Ready.
 * Counting and listing ids needs neither table; the FIFO sort keys are fetched afterwards for exactly these ids (an array of known length plans well). */
const ATTEMPT_IDS=`FROM analytical_attempt a JOIN nipt_case c ON c.id=a.case_id
 WHERE c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL' AND a.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=a.round_id)
 AND (COALESCE(${FIRST_UNIT}::text,'')||':'||c.registration_origin)=ANY($1::text[])`;
const TWINS=`(SELECT x.pt FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'type' pt FROM p2_document_revision d WHERE d.round_id=a.round_id AND d.kind='REQUEST'
   UNION ALL SELECT p.created_at,p.panel->>'pregnancyType' FROM p2_paper_review p WHERE p.round_id=a.round_id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.pt IN ('Singleton','Twins') ORDER BY x.created_at DESC LIMIT 1)='Twins'`;
const fifoSql=(dir:'asc'|'desc')=>`r.received_at ${dir==='asc'?'ASC':'DESC'} NULLS LAST,l.ln ASC,a.id ASC`; // null receipt last in both directions, immutable tie keys (receive-sort.ts)

/** (unit, origin) pairs this user may read, exactly as authorize() decides per case ("" = a case with no unit scope). */
async function readableScope(db:Queryable,user:Staff){
 const units=(await db.query<{id:string}>('SELECT id FROM unit')).rows.map(u=>u.id);
 const pairs:string[]=[];
 for(const o of ['ANC','LAB_DIRECT','HISTORICAL'] as const){
  if(authorize(user,'case.read',{unitId:undefined,origin:o},'read'))pairs.push(':'+o);
  for(const u of units)if(authorize(user,'case.read',{unitId:u,origin:o},'read'))pairs.push(u+':'+o);
 }
 return pairs;
}

/** Facts of the given attempts in bounded chunks (the heavy per-attempt read; never more than CHUNK ids at once). */
async function factsOf(db:Queryable,ids:readonly string[],chunk=CHUNK){
 const out:AttemptRow[]=[];
 for(let i=0;i<ids.length;i+=chunk)out.push(...await attemptFacts(db,'a.id=ANY($1::uuid[])',[ids.slice(i,i+chunk)]));
 return out;
}
type Light={attemptId:string;hisLn:string;receivedAt:Date|null;category:QueueCategory;lnHalos:string|null;labelCode:string|null;printedSampleId:string|null;roundNumber:number;prints:number;urgent:boolean;runLabel:string|null};
const lowerIncludes=(q:string,...v:(string|null|undefined)[])=>!q||v.some(x=>x?.toLowerCase().includes(q));

type Read={data:WorklistPage;caseIds:string[]};
/** One bounded page of one tab. Counts for every tab are exact (Ready/Gate within `scan.limit`). Does not write the PHI-access audit. */
/** Test seam: shrink the exact-scan window and chunk size so the beyond-limit path can be exercised with a small fixture. */
export type ScanTuning={scanLimit?:number;chunk?:number;hardLimit?:number};
async function readWorklist(db:Queryable,user:Staff,raw:unknown,tuning:ScanTuning={}):Promise<Read>{
 const SCAN=tuning.scanLimit??READY_SCAN_LIMIT,STEP=tuning.chunk??CHUNK,HARD=tuning.hardLimit??READY_HARD_LIMIT;
 await assertSession(db,user);need(user,'worksheet.read','read');
 const f=inputSchema.parse(raw);const q=f.q.toLowerCase();
 const {policy}=await pendingPolicy(db);
 const scope=await readableScope(db,user);
 // Counts that need no per-attempt facts.
 const c=(await db.query<{ready:number;in_batch:number;decision:number}>(`SELECT count(*) FILTER (WHERE a.state='Ready')::int ready,count(*) FILTER (WHERE a.state IN ('Assigned','InProgress'))::int in_batch,count(*) FILTER (WHERE a.state NOT IN ('Ready','Assigned','InProgress'))::int decision ${ATTEMPT_IDS}`,[scope])).rows[0];
 const expectedFrom=`FROM specimen_round_current r JOIN nipt_case c ON c.id=r.case_id AND c.current_round_id=r.id JOIN case_ln l ON l.id=r.case_ln_id JOIN redraw_request d ON d.id=r.redraw_request_id
  WHERE r.round_number>=2 AND r.state='Expected' AND (COALESCE(${FIRST_UNIT}::text,'')||':'||c.registration_origin)=ANY($1::text[])`;
 const missingFrom=`FROM specimen_round_current r JOIN nipt_case c ON c.id=r.case_id AND c.current_round_id=r.id JOIN case_ln l ON l.id=r.case_ln_id
  WHERE r.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.round_id=r.id) AND (COALESCE(${FIRST_UNIT}::text,'')||':'||c.registration_origin)=ANY($1::text[])`;
 const cnt=async(from:string)=>Number((await db.query<{n:string}>(`SELECT count(*)::text n ${from}`,[scope])).rows[0].n);
 const counts:Record<WorklistTab,number>={READY:0,GATE_BLOCKED:0,IN_BATCH:c.in_batch,DECISION:c.decision,REDRAW_EXPECTED:await cnt(expectedFrom),LN_HALOS_MISSING:await cnt(missingFrom)};
 // Ready/Gate: classify the Ready attempts (FIFO order) by the Owner-locked gate, in bounded chunks.
 let capped=false,scanned=0,readyTotal=0;const ready:Light[]=[];
 const rowMatches=(x:Light)=>x.category===f.tab&&lowerIncludes(q,x.hisLn,x.lnHalos,x.labelCode,x.printedSampleId,x.runLabel)&&(f.round==='ALL'||(f.round==='S1'?x.roundNumber===1:x.roundNumber>1))&&(!f.unprinted||x.prints===0)&&(!f.urgent||x.urgent);
 const classify=async()=>{
  const activeRG=f.tab==='READY'||f.tab==='GATE_BLOCKED';
  const readyIds=(await db.query<{id:string}>(`SELECT a.id ${ATTEMPT_IDS} AND a.state='Ready'`,[scope])).rows.map(r=>r.id);
  const ids=readyIds.length?(await db.query<{id:string}>(`SELECT a.id FROM analytical_attempt a JOIN specimen_round_current r ON r.id=a.round_id JOIN case_ln l ON l.id=r.case_ln_id WHERE a.id=ANY($1::uuid[]) ORDER BY ${fifoSql(activeRG?f.sort:'asc')}`,[readyIds])).rows.map(r=>r.id):[];
  const hard=ids.length>HARD;if(hard)ids.length=HARD;
  const need=activeRG?(f.page-1)*f.pageSize+f.pageSize:0;let matched=0;
  for(let i=0;i<ids.length;i+=STEP){
   if(i>=SCAN&&(!activeRG||matched>=need))break; // past the exact window: only keep going to fill the requested page
   for(const r of await factsOf(db,ids.slice(i,i+STEP),STEP)){const w=worklistRow(r,policy);const row:Light={attemptId:r.attempt_id,hisLn:r.ln,receivedAt:r.received_at,category:w.category,lnHalos:w.lnHalos,labelCode:w.labelCode,printedSampleId:w.printedSampleId,roundNumber:r.round_number,prints:r.label_prints,urgent:r.urgent,runLabel:r.run_label};ready.push(row);if(activeRG&&rowMatches(row))matched++;}
   scanned=Math.min(i+STEP,ids.length);
  }
  readyTotal=ids.length;capped=hard||scanned<ids.length;
 };
 // The tab badges show Ready and Gate together, so the classification runs for every request (bounded by READY_SCAN_LIMIT).
 await classify();
 counts.READY=ready.filter(x=>x.category==='READY').length;counts.GATE_BLOCKED=ready.filter(x=>x.category==='GATE_BLOCKED').length;
 let attempts:WorklistAttempt[]=[],expected:WorklistExpected[]=[],missing:WorklistMissing[]=[];let meta:PageMeta;let caseIds:string[]=[];
 const visible=<T extends {unit_id:string|null;registration_origin:string}>(rows:T[])=>rows.filter(r=>caseVisible(user,r));
 if(f.tab==='READY'||f.tab==='GATE_BLOCKED'){
  const dir=f.sort,rows=ready.filter(rowMatches)
   .sort((a,b)=>compareReceive({receivedAt:a.receivedAt,keys:[a.hisLn,a.attemptId]},{receivedAt:b.receivedAt,keys:[b.hisLn,b.attemptId]},dir));
  meta=clampPage(f.page,rows.length,f.pageSize);if(capped)meta={...meta,totalPages:meta.totalPages+1}; // unscanned attempts may hold more rows: keep "next" available
  const ids=rows.slice(offsetOf(meta),offsetOf(meta)+meta.size).map(x=>x.attemptId),byId=new Map((await factsOf(db,ids)).map(r=>[r.attempt_id,r]));
  attempts=ids.flatMap(id=>{const r=byId.get(id);return r&&caseVisible(user,r)?[worklistRow(r,policy)]:[];});
 }else if(f.tab==='IN_BATCH'||f.tab==='DECISION'){
  const values:unknown[]=[scope],p=(v:unknown)=>{values.push(v);return '$'+values.length;};
  const where=[f.tab==='IN_BATCH'?"a.state IN ('Assigned','InProgress')":"a.state NOT IN ('Ready','Assigned','InProgress')"];
  if(q){const t=p(q);where.push(`(strpos(lower(l.ln),${t})>0 OR strpos(lower(COALESCE(n.ln_halos,'')),${t})>0 OR strpos(lower(COALESCE(a.printed_sample_id,'')),${t})>0 OR strpos(lower(COALESCE(b.run_label,'')),${t})>0
   OR strpos(lower(COALESCE(n.ln_halos,'')||CASE WHEN ${TWINS} THEN 'D' ELSE '' END||CASE WHEN n.original_round_id IS NOT NULL THEN 'R' ELSE '' END),${t})>0)`);}
  if(f.round!=='ALL')where.push(f.round==='S1'?'r.round_number=1':'r.round_number>1');
  if(f.unprinted)where.push('NOT EXISTS(SELECT 1 FROM label_print_item i WHERE i.round_id=r.id)');
  if(f.urgent)where.push("COALESCE((SELECT e.event_type='URGENT_SET' FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('URGENT_SET','URGENT_CLEARED') ORDER BY e.sequence DESC LIMIT 1),false)");
  const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n ${ATTEMPTS} AND ${where.join(' AND ')}`,values)).rows[0].n);
  meta=clampPage(f.page,total,f.pageSize);
  const ids=(await db.query<{id:string}>(`SELECT a.id ${ATTEMPTS} AND ${where.join(' AND ')} ORDER BY ${fifoSql(f.sort)} LIMIT ${meta.size} OFFSET ${offsetOf(meta)}`,values)).rows.map(r=>r.id);
  const byId=new Map((await factsOf(db,ids)).map(r=>[r.attempt_id,r]));
  attempts=ids.flatMap(id=>{const r=byId.get(id);return r&&caseVisible(user,r)?[worklistRow(r,policy)]:[];});
 }else if(f.tab==='REDRAW_EXPECTED'){
  const values:unknown[]=[scope],cond=q?(values.push(q),`AND (strpos(lower(l.ln),$2)>0 OR strpos(lower(COALESCE((SELECT n.ln_halos FROM specimen_lab_number n WHERE n.round_id=d.source_round_id),'')),$2)>0)`):'';
  meta=clampPage(f.page,Number((await db.query<{n:string}>(`SELECT count(*)::text n ${expectedFrom} ${cond}`,values)).rows[0].n),f.pageSize);
  const rows=(await db.query<{case_id:string;round_id:string;round_number:number;ln:string;requested_at:Date;reason_code:string;unit_id:string|null;registration_origin:string;previous_ln_halos:string|null}>(
   `SELECT r.case_id,r.id round_id,r.round_number,l.ln,d.requested_at,d.reason_code,${FIRST_UNIT} unit_id,c.registration_origin,(SELECT n.ln_halos FROM specimen_lab_number n WHERE n.round_id=d.source_round_id) previous_ln_halos
    ${expectedFrom} ${cond} ORDER BY d.requested_at,r.id LIMIT ${meta.size} OFFSET ${offsetOf(meta)}`,values)).rows;
  expected=visible(rows).map(r=>({kind:'REDRAW_EXPECTED' as const,category:'REDRAW_EXPECTED' as QueueCategory,caseId:r.case_id,roundId:r.round_id,roundNumber:r.round_number,hisLn:r.ln,requestedAt:r.requested_at.toISOString(),reasonCode:r.reason_code,previousLnHalos:r.previous_ln_halos}));
 }else{
  const values:unknown[]=[scope],cond=q?(values.push(q),`AND strpos(lower(l.ln),$2)>0`):'';
  meta=clampPage(f.page,Number((await db.query<{n:string}>(`SELECT count(*)::text n ${missingFrom} ${cond}`,values)).rows[0].n),f.pageSize);
  const rows=(await db.query<{case_id:string;round_id:string;round_number:number;ln:string;received_at:Date;received_source:string;unit_id:string|null;registration_origin:string}>(
   `SELECT r.case_id,r.id round_id,r.round_number,l.ln,r.received_at,r.received_source,${FIRST_UNIT} unit_id,c.registration_origin ${missingFrom} ${cond} ORDER BY r.received_at,r.id LIMIT ${meta.size} OFFSET ${offsetOf(meta)}`,values)).rows;
  missing=visible(rows).map(r=>({kind:'LN_HALOS_MISSING' as const,category:'LN_HALOS_MISSING' as QueueCategory,caseId:r.case_id,roundId:r.round_id,roundNumber:r.round_number,hisLn:r.ln,receivedAt:r.received_at.toISOString(),receivedSource:r.received_source}));
 }
 caseIds=[...new Set([...attempts.map(a=>a.caseId),...expected.map(e=>e.caseId),...missing.map(m=>m.caseId)])];
 return {caseIds,data:{policy,operational:process.env.NIPT_MODE==='operational',generatedAt:new Date().toISOString(),tab:f.tab,counts,scan:{capped,limit:SCAN,scanned,ready:readyTotal},page:meta,filters:{q:f.q,round:f.round,unprinted:f.unprinted,urgent:f.urgent,sort:f.sort},attempts,expected,missing}};
}

/** The paged worklist served to the Lab page and `GET /api/p4/worklist`. PHI-access audit: exactly the cases disclosed in this response (at most one page). */
export async function labWorklistPage(db:Queryable,user:Staff,raw:unknown={},tuning:ScanTuning={}):Promise<WorklistPage>{
 const {data,caseIds}=await readWorklist(db,user,raw,tuning);
 if(caseIds.length)await recordPhiAccess(db,user.id,caseIds,'REGISTRY_VIEW');
 return data;
}

/** Every row of every tab, assembled from bounded pages (diagnostics and tests; the application never loads the whole worklist in one response). */
export async function labWorklist(db:Queryable,user:Staff){
 const all=async<T>(tab:WorklistTab,pick:(d:WorklistPage)=>T[])=>{const out:T[]=[];for(let page=1;;page++){const {data}=await readWorklist(db,user,{tab,page,pageSize:100});out.push(...pick(data));if(page>=data.page.totalPages)return {rows:out,data};}};
 const attempts:WorklistAttempt[]=[];let policy='HOLD',operational=false;
 for(const tab of ['READY','GATE_BLOCKED','IN_BATCH','DECISION'] as const){const r=await all(tab,d=>d.attempts);attempts.push(...r.rows);policy=r.data.policy;operational=r.data.operational;}
 attempts.sort((a,b)=>compareReceive({receivedAt:a.receivedAt,keys:[a.hisLn,a.attemptId]},{receivedAt:b.receivedAt,keys:[b.hisLn,b.attemptId]},'asc'));
 const expected=(await all('REDRAW_EXPECTED',d=>d.expected)).rows,missing=(await all('LN_HALOS_MISSING',d=>d.missing)).rows;
 const caseIds=[...new Set([...attempts.map(a=>a.caseId),...expected.map(e=>e.caseId),...missing.map(m=>m.caseId)])].slice(0,200);
 if(caseIds.length)await recordPhiAccess(db,user.id,caseIds,'REGISTRY_VIEW');
 return {policy,attempts,expected,missing,operational,generatedAt:new Date().toISOString()};
}
