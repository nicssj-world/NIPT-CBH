/** One-time operator script (Owner decision 2026-11-07, design spec 3.6 / 5.6): re-links results that the OLD, stricter link rule left stuck, under the
 *  new rule (HN + lab number, exactly one current latest attempt). It lives in tools/migration because `nipt-admin ops-run` only runs scripts from there.
 *    dry run: nipt-admin ops-run --root <root> --script tools\migration\backlog-relink-20261107.ts -- [--out <dir>] [--actor <username>]
 *    apply:   nipt-admin ops-run --root <root> --script tools\migration\backlog-relink-20261107.ts -- --apply --out <new dir> [--actor <username>]
 *  DRY RUN IS THE DEFAULT: one READ ONLY transaction, always rolled back, no write function, no audit row.
 *  --apply decides each version with the SAME function the dry run uses and acts only when that decision says so. Every version is its own
 *  transaction (BEGIN ... audit ... COMMIT), so the global audit lock and the row locks are held for one version at a time; run it in a quiet period.
 *  Rows are appended to the report only after their COMMIT. A LinkConflict is reported and never touched (a person decided it; the board's
 *  pick/discard path is theirs). It NEVER records a review or QC5, certifies, voids, sends to HIS or picks a patient on anybody's behalf.
 *  The report is for the operator: HN and lab numbers, never a patient name. */
import {existsSync,mkdirSync,rmSync,openSync,writeSync,ftruncateSync,closeSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {LabError,audit,type Staff} from '../../packages/lab/core';
import {autoLinkUnique,backlogRelinkPreview,backlogRevalidate,validationGateIssues,releaseReviewed} from '../../packages/results/service';
import {isSendResolvable} from '../../packages/results/release-queue';

export const BACKLOG_REASON_CODE='BACKLOG_RELINK_20261107';
export type RelinkRow={versionId:string;source:'READYGEN'|'HALOS';from:string;to:string;wouldBecome:boolean;
 match:{hn:string|null;ln:string|null;lnHalos:string|null}|null;rule:string|null;contract:string|null;reason:string|null;board:'READY'|'ACTION';reviewed:boolean;gateReasons:string[];pdfHn:string|null;pdfLab:string|null};

type Cand={id:string;state:string;origin:string;pdf_hn:string|null;pdf_lab:string|null;round_id:string|null;current_round_id:string|null;link_mode:string|null;ln:string|null;ln_halos:string|null;hn:string|null};
type Gate={failed:string[];pending:string[]};
const SELECT_VERSION=`SELECT v.id,v.state,v.origin,v.parsed->'identifiers'->'hn'->>'value' pdf_hn,v.parsed->'identifiers'->'labNumber'->>'value' pdf_lab,v.round_id,c.current_round_id,v.link_mode,
  l.ln,n.ln_halos,i.hn
 FROM result_report_version v LEFT JOIN nipt_case c ON c.id=v.case_id LEFT JOIN specimen_round r ON r.id=v.round_id LEFT JOIN case_ln l ON l.id=r.case_ln_id
  LEFT JOIN specimen_lab_number n ON n.round_id=v.round_id LEFT JOIN p2_case_identity i ON i.case_id=v.case_id`;
const CANDIDATES=`${SELECT_VERSION}
 WHERE v.kind='RESULT' AND NOT EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id) AND (c.id IS NULL OR c.registration_origin<>'HISTORICAL')
  AND (v.state IN ('Unlinked','LinkConflict','ValidationBlocked','Linked')
   OR (v.state NOT IN ('CertifiedReleased','Voided','Superseded','RejectedImport') AND EXISTS(SELECT 1 FROM internal_report ir WHERE ir.version_id=v.id AND ir.state='Final')))
 ORDER BY v.imported_at DESC,v.id`;
// Newest first: when two stuck PDFs belong to one round the newest links and the older one is reported as SERIES_NOT_EMPTY.
const REFUSALS=/^(AUTO_LINK_[A-Z_]+|LINK_PROPOSAL_OPEN|VERSION_CONFLICT)$/;
const codeOf=(e:unknown)=>e instanceof LabError?e.code:(e as {code?:string}).code==='23505'?'AUTO_LINK_CONCURRENT_SERIES':e instanceof Error?e.message:'';
const gateCodes=(g:Gate)=>[...g.failed.map(x=>x.split(':')[1]),...g.pending.map(x=>x.split(':')[2])].filter((x):x is string=>!!x);
const linkedMatch=(c:Cand)=>c.round_id?{hn:c.hn,ln:c.ln,lnHalos:c.ln_halos}:null;

type Decision={action:'LINK'|'REVALIDATE'|'NONE';to:string;match:RelinkRow['match'];rule:string|null;contract:string|null;reason:string|null;gate:Gate|null};
/** THE decision, shared by the dry run and --apply. Read only. `claimed` holds the rounds an earlier row of this run links (identical in both modes). */
async function decide(db:Queryable,actor:Staff,c:Cand,claimed:Set<string>):Promise<Decision>{
 const none=(reason:string,match:RelinkRow['match']=linkedMatch(c),rule:string|null=c.link_mode):Decision=>({action:'NONE',to:c.state,match,rule,contract:null,reason,gate:null});
 // HALOS-generated reports link through their own frozen-export contract and exact attempt: this script only reports them (R13).
 if(c.origin==='INTERNAL_GENERATED'){
  if(c.state==='LinkConflict')return none('LINK_CONFLICT_NEEDS_HUMAN');
  if(c.state==='PendingCertification')return none('ALREADY_WAITING_FOR_HIS');
  if(c.state==='Unlinked')return none('INTERNAL_REPORT_LINKS_BY_FROZEN_EXPORT_ONLY',null,null);
  if(c.state==='Linked'||c.state==='ValidationBlocked')return none('INTERNAL_REPORT_HANDLED_ON_BOARD');
  return none('STATE_NOT_HANDLED');
 }
 if(c.round_id&&c.round_id!==c.current_round_id)return none('ROUND_NOT_CURRENT');
 if(c.state==='LinkConflict')return none('LINK_CONFLICT_NEEDS_HUMAN');
 if(c.state==='PendingCertification')return none('ALREADY_WAITING_FOR_HIS');
 if(c.state==='Unlinked'){
  const p=await backlogRelinkPreview(db,actor,c.id);
  if(p.humanDecided)return none('HUMAN_DECISION_EXISTS',null,null);
  if(!p.match)return none(p.reason??'NOT_A_CLEAN_MATCH',null,null);
  if(p.reason||!p.roundId||claimed.has(p.roundId))return none(p.reason??'SERIES_NOT_EMPTY',null,null);
  claimed.add(p.roundId);
  return {action:'LINK',to:p.gate?.eligible?'PendingCertification':'ValidationBlocked',match:{hn:p.match.hn,ln:p.match.ln,lnHalos:p.match.lnHalos},rule:p.match.rule,contract:p.match.contract,reason:null,gate:p.gate};
 }
 if(c.state==='Linked'||c.state==='ValidationBlocked'){
  const p=await backlogRelinkPreview(db,actor,c.id);
  if(!p.gate)return none('NO_GATE_DECISION');
  return {action:'REVALIDATE',to:p.gate.eligible?'PendingCertification':'ValidationBlocked',match:linkedMatch(c),rule:c.link_mode,contract:null,reason:null,gate:p.gate};
 }
 return none('STATE_NOT_HANDLED');
}

/** Row for the report. `gate` is the predicted gate (dry run, rows that would change); otherwise the real, current one. */
async function rowOf(db:Queryable,c:Cand,d:Decision,to:string,reason:string|null,wouldBecome:boolean,predicted:Gate|null):Promise<RelinkRow>{
 let board:'READY'|'ACTION'='ACTION',gateReasons:string[]=[],reviewed=false;
 if(to==='PendingCertification'){board='READY';}
 else if(to==='Linked'||to==='ValidationBlocked'){const g=predicted??await validationGateIssues(db,c.id);board=isSendResolvable(g)?'READY':'ACTION';gateReasons=gateCodes(g);}
 if(['PendingCertification','Linked','ValidationBlocked'].includes(to))reviewed=predicted&&d.action==='LINK'?false:await releaseReviewed(db,c.id);
 return {versionId:c.id,source:c.origin==='INTERNAL_GENERATED'?'HALOS':'READYGEN',from:c.state,to,wouldBecome,match:d.match,rule:d.rule,contract:d.contract,reason,board,reviewed,gateReasons,pdfHn:c.pdf_hn,pdfLab:c.pdf_lab};
}
const fresh=async(db:Queryable,id:string)=>(await db.query<Cand>(`${SELECT_VERSION} WHERE v.id=$1`,[id])).rows[0];

/** Dry run (apply=false): BEGIN TRANSACTION READ ONLY, read functions only, always ROLLBACK. Apply: one transaction per version; `onRow` runs after each COMMIT. */
export async function runBacklogRelink(db:Queryable,actor:Staff,o:{apply:boolean;onRow?:(r:RelinkRow)=>void}):Promise<{rows:RelinkRow[]}>{
 const rows:RelinkRow[]=[],claimed=new Set<string>(),push=(r:RelinkRow)=>{rows.push(r);o.onRow?.(r);};
 if(!o.apply){
  await db.query('BEGIN TRANSACTION READ ONLY');
  try{
   for(const c of (await db.query<Cand>(CANDIDATES)).rows){const d=await decide(db,actor,c,claimed);
    push(await rowOf(db,c,d,d.to,d.reason,true,d.action==='NONE'?null:d.gate));}
  }finally{await db.query('ROLLBACK');}
  return {rows};
 }
 const ids=(await db.query<Cand>(CANDIDATES)).rows.map(c=>c.id);
 for(const id of ids){
  await db.query('BEGIN');
  try{
   const c=await fresh(db,id);const d=await decide(db,actor,c,claimed);
   let to=d.to,reason=d.reason,shown=d;
   if(d.action==='LINK'){
    const x=await autoLinkUnique(db,actor,id);
    if(x.linked)to=x.version.state;else{to=c.state;reason=x.reason;shown={...d,match:null,rule:null,contract:null};}   // refused: no predicted match next to Unlinked
   }else if(d.action==='REVALIDATE')to=await backlogRevalidate(db,actor,id);
   const row=await rowOf(db,c,shown,to,reason,false,null);
   if(c.origin!=='INTERNAL_GENERATED')await audit(db,actor,'RESULT_BACKLOG_RELINK','RESULT_VERSION',id,{previousState:c.state,resultingState:to,outcome:reason?reason.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80):'RELINKED',reasonCode:BACKLOG_REASON_CODE});
   await db.query('COMMIT');push(row);
  }catch(e){
   await db.query('ROLLBACK');
   const code=codeOf(e);
   // Recoverable: a refusal by the service or the DB for this one version. Anything else (lost connection, bug) stops the run; earlier versions stay committed.
   if(!(e instanceof LabError)&&!REFUSALS.test(code))throw e;
   const c=await fresh(db,id);const none:Decision={action:'NONE',to:c.state,match:c.state==='Unlinked'?null:linkedMatch(c),rule:c.state==='Unlinked'?null:c.link_mode,contract:null,reason:code,gate:null};
   await db.query('BEGIN');
   try{
    const row=await rowOf(db,c,none,c.state,code,false,null);
    if(c.origin!=='INTERNAL_GENERATED')await audit(db,actor,'RESULT_BACKLOG_RELINK','RESULT_VERSION',id,{previousState:c.state,resultingState:c.state,outcome:code.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80),reasonCode:BACKLOG_REASON_CODE});
    await db.query('COMMIT');push(row);
   }catch(e2){await db.query('ROLLBACK');throw e2;}
  }
 }
 return {rows};
}

// ---------- report ----------
const COLS=['versionId','source','from','to','dryRun','pdfHn','pdfLabNumber','matchHn','matchLn','matchLnHalos','rule','contract','reason','board','reviewed','gateReasons'] as const;
// A cell starting with = + - @ would be run as a formula by a spreadsheet.
const cell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const mdCell=(v:unknown)=>String(v===null||v===undefined?'':v).replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const csvLine=(r:RelinkRow)=>[r.versionId,r.source,r.from,r.to,r.wouldBecome,r.pdfHn,r.pdfLab,r.match?.hn,r.match?.ln,r.match?.lnHalos,r.rule,r.contract,r.reason,r.board,r.reviewed,r.gateReasons.join(' ')].map(cell).join(',')+'\r\n';
export function markdownOf(rows:RelinkRow[],apply:boolean,dir:string){
 const count=(f:(r:RelinkRow)=>string)=>Object.entries(rows.reduce<Record<string,number>>((a,r)=>({...a,[f(r)]:(a[f(r)]??0)+1}),{})).sort();
 const table=(h:string[],rs:unknown[][])=>[`| ${h.join(' | ')} |`,`| ${h.map(()=>'---').join(' | ')} |`,...rs.map(r=>`| ${r.map(mdCell).join(' | ')} |`)].join('\n');
 return [`# Backlog re-link ${BACKLOG_REASON_CODE} - ${apply?'APPLIED':'DRY RUN (nothing was written to the database)'}`,'',
  `Report folder: ${mdCell(dir)}`,apply?'Run --apply in a quiet period: each version is its own transaction and briefly takes the global audit lock. Rows appear here only after their COMMIT.':'','',
  `Rows: ${rows.length}. ${apply?'"to" is the state after the run.':'"to" is what each row WOULD become; rows are decided one by one with the same function --apply uses.'}`,'',
  '## By state',table(['from','to','rows'],count(r=>r.from+'|'+r.to).map(([k,n])=>[...k.split('|'),n])),'',
  '## Board after',table(['board','rows'],count(r=>r.board).map(([k,n])=>[k,n])),'',
  '## Not linked / not changed, by reason',table(['reason','rows'],count(r=>r.reason??'(none)').map(([k,n])=>[k,n])),'',
  '## Every row',table(['version','source','from','to','HN (PDF)','lab no. (PDF)','match HN','match LN','LN Halos','rule','contract','reason','board','reviewed','gate'],
   rows.map(r=>[r.versionId,r.source,r.from,r.to,r.pdfHn,r.pdfLab,r.match?.hn,r.match?.ln,r.match?.lnHalos,r.rule,r.contract,r.reason,r.board,r.reviewed,r.gateReasons.join(' ')])),''].join('\n');
}
/** Creates the folder and both files exclusively (never overwrites). Rows are appended as they are committed; finish() writes the Markdown summary. */
export function openReport(dir:string,apply:boolean){
 const stem=path.join(dir,`backlog-relink-${apply?'apply':'dry-run'}`);
 if(existsSync(stem+'.csv')||existsSync(stem+'.md'))throw new Error('REPORT_FILES_EXIST');
 mkdirSync(dir,{recursive:true});
 const csv=openSync(stem+'.csv','wx'),md=openSync(stem+'.md','wx');
 writeSync(csv,'\ufeff'+COLS.join(',')+'\r\n');writeSync(md,`# Backlog re-link ${BACKLOG_REASON_CODE} - INCOMPLETE (the run has not finished)\n`);
 let appended=0;
 return {stem,append:(r:RelinkRow)=>{appended++;writeSync(csv,csvLine(r));},
  /** Removes the empty INCOMPLETE files this run created (only if no row was written), so the same folder can be reused. */
  discard:()=>{if(appended)return;closeSync(csv);closeSync(md);rmSync(stem+'.csv',{force:true});rmSync(stem+'.md',{force:true});},
  finish:(rows:RelinkRow[])=>{ftruncateSync(md,0);writeSync(md,markdownOf(rows,apply,dir),0);closeSync(csv);closeSync(md);}};
}
/** Report text without touching the file system (tests, previews). */
export const reportOf=(rows:RelinkRow[],apply:boolean)=>({csv:'\ufeff'+COLS.join(',')+'\r\n'+rows.map(csvLine).join(''),md:markdownOf(rows,apply,'')});

// ---------- CLI ----------
export type Deps={connect:()=>Promise<{db:Queryable;close:()=>Promise<void>}>;verifiedBackup:()=>Promise<{at?:string|null}>;defaultOut:()=>string;log:(line:string)=>void};
export async function main(argv:string[],deps:Deps){
 const arg=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];},apply=argv.includes('--apply'),out=arg('out');
 if(out!==undefined&&(out.startsWith('--')||!out.trim()))throw new Error('OUT_DIR_INVALID');
 if(apply&&!out)throw new Error('OUT_DIR_REQUIRED_FOR_APPLY');
 if(apply){ // like the historical migration: only after a fresh verified backup; checked before any SQL
  const b=await deps.verifiedBackup().catch(()=>null),age=b?.at?Math.round((Date.now()-Date.parse(b.at))/60000):null;
  if(age===null||!(age<=24*60))throw new Error('VERIFIED_BACKUP_REQUIRED');
 }
 const dir=path.resolve(out??deps.defaultOut());
 const report=openReport(dir,apply);   // fails (EEXIST / REPORT_FILES_EXIST) before the database is touched
 deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',reportFolder:dir,note:apply?'run in a quiet period':'nothing is written to the database'}));
 let conn:Awaited<ReturnType<Deps['connect']>>|undefined;
 try{
  conn=await deps.connect();
  const r=(await conn.db.query<{id:string}>("SELECT u.id FROM app_user u WHERE u.username=$1 AND u.enabled AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='APP_ADMIN' AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))",[arg('actor')??'admin'])).rows[0];
  if(!r)throw new Error('APP_ADMIN_ACTOR_NOT_AVAILABLE');
  const actor:Staff={id:r.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
  const {rows}=await runBacklogRelink(conn.db,actor,{apply,onRow:report.append});
  report.finish(rows);
  deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',rows:rows.length,report:report.stem+'.csv / .md'}));
  // The report names patients (HN/LN) and, without --out, sits in the server's temp folder: say so as the very last line.
  if(out===undefined)deps.log('รายงานมี HN/LN — ลบโฟลเดอร์เมื่อใช้งานเสร็จ');
  return {rows,report:report.stem};
 }catch(e){report.discard();throw e;}
 finally{await conn?.close();}
}
const realDeps:Deps={
 connect:async()=>{const {pool}=await import('../../packages/db/connection');const p=pool(),client=await p.connect();return {db:client as unknown as Queryable,close:async()=>{client.release();await p.end();}};},
 verifiedBackup:async()=>{const {verifiedMigrationBackup}=await import('../../packages/migration/service');return verifiedMigrationBackup();},
 defaultOut:()=>path.join(os.tmpdir(),`nipt-backlog-relink-20261107-${new Date().toISOString().replace(/[:.]/g,'-')}`),
 log:l=>{process.stdout.write(l+'\n');}
};
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2),realDeps).catch(e=>{process.stderr.write(String(e instanceof Error?e.message:e)+'\n');process.exit(1);});
