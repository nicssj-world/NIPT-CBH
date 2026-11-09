/** One-time operator script (Owner decision 2026-11-09): the ReadyGen PDFs the previous system already sent to HIS still sit in "ต้องจัดการ". This links each one to its patient
 *  where the rule allows it and marks it "มีผลใน HIS แล้ว", so ANC sees the result on the patient and it is never sent again. It lives in tools/migration because
 *  `nipt-admin ops-run` only runs scripts from there.
 *    dry run: nipt-admin ops-run --root <root> --script tools\migration\backlog-his-present-20261109.ts -- [--out <dir>] [--actor <username>]
 *    apply:   nipt-admin ops-run --root <root> --script tools\migration\backlog-his-present-20261109.ts -- --apply --out <new dir> [--actor <username>]
 *  DRY RUN IS THE DEFAULT and uses the very code --apply uses: each version runs in its own transaction that is ROLLED BACK instead of committed, so the report
 *  shows exactly what --apply would do and nothing stays in the database. --apply needs a verified backup younger than 24 h, checked before any SQL.
 *  Scope = what the board lists in "ต้องจัดการ" (Unlinked, LinkConflict, and Linked / ValidationBlocked results whose open items are more than "ส่ง HIS" itself records).
 *  A result waiting to be sent ("รอส่ง HIS") is NEVER touched: it may be a result HIS does not hold yet. A LinkConflict is reported (a person decided it).
 *  An unlinked PDF is linked only by the same clean rule as the board (HN + lab number, exactly one current latest attempt, nobody decided it before); everything else is
 *  reported with its reason and is picked by hand ("เลือกผู้ป่วย", with the "มีผลใน HIS แล้ว" box). The identity guard of "มีผลใน HIS แล้ว" still applies: a PDF that contradicts
 *  the patient (HN, date of birth, lab number) is linked but not marked. Nothing here records a review or QC5, certifies, voids, or sends to HIS.
 *  The report is for the operator: HN and lab numbers, never a patient name. */
import {existsSync,mkdirSync,openSync,writeSync,closeSync,rmSync,appendFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {LabError,audit,type Staff} from '../../packages/lab/core';
import {linkAndShowInHis,type ShowOutcome} from '../../packages/results/his-present';

export const BACKLOG_HIS_PRESENT_CODE='BACKLOG_HIS_PRESENT_20261109';
export type PresentOutcome=ShowOutcome;
export type PresentRow={versionId:string;from:string;to:string;outcome:PresentOutcome;reason:string|null;pdfHn:string|null;pdfLab:string|null;ln:string|null;hn:string|null};

type Cand={id:string;state:string;pdf_hn:string|null;pdf_lab:string|null;round_id:string|null;current_round_id:string|null;ln:string|null;hn:string|null};
const SELECT_VERSION=`SELECT v.id,v.state,v.parsed->'identifiers'->'hn'->>'value' pdf_hn,v.parsed->'identifiers'->'labNumber'->>'value' pdf_lab,v.round_id,c.current_round_id,l.ln,i.hn
 FROM result_report_version v LEFT JOIN nipt_case c ON c.id=v.case_id LEFT JOIN specimen_round r ON r.id=v.round_id LEFT JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN p2_case_identity i ON i.case_id=v.case_id`;
// Newest first: when two PDFs belong to one round the newest links and the older one is reported as SERIES_NOT_EMPTY.
const CANDIDATES=`${SELECT_VERSION}
 WHERE v.kind='RESULT' AND v.origin='EXTERNAL_READYGEN' AND v.state IN ('Unlinked','LinkConflict','ValidationBlocked','Linked')
  AND NOT EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id) AND (c.id IS NULL OR c.registration_origin<>'HISTORICAL')
 ORDER BY v.imported_at DESC,v.id`;
const REFUSALS=/^(AUTO_LINK_[A-Z_]+|LINK_PROPOSAL_OPEN|VERSION_CONFLICT)$/;
const codeOf=(e:unknown)=>e instanceof LabError?e.code:(e as {code?:string}).code==='23505'?'AUTO_LINK_CONCURRENT_SERIES':e instanceof Error?e.message:'';
const fresh=async(db:Queryable,id:string)=>(await db.query<Cand>(`${SELECT_VERSION} WHERE v.id=$1`,[id])).rows[0];
const token=(s:string)=>s.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80);

/** One version, inside the caller's transaction: the same function the board's button uses (packages/results/his-present.ts). skipWaiting keeps the script to what the board lists
 *  in "ต้องจัดการ": a result waiting to be sent is never marked here. */
async function presentOne(db:Queryable,actor:Staff,c:Cand,claimed:Set<string>):Promise<PresentRow>{
 const r=await linkAndShowInHis(db,actor,c.id,{claimed,skipWaiting:true,note:BACKLOG_HIS_PRESENT_CODE});
 return {versionId:c.id,from:r.from,to:r.to,outcome:r.outcome,reason:r.reason,pdfHn:c.pdf_hn,pdfLab:c.pdf_lab,ln:c.ln,hn:c.hn};
}

/** Dry run (apply=false): every version in a transaction that is rolled back. Apply: every version in its own committed transaction; `onRow` runs after each one. */
export async function runBacklogHisPresent(db:Queryable,actor:Staff,o:{apply:boolean;onRow?:(r:PresentRow)=>void}):Promise<{rows:PresentRow[]}>{
 const rows:PresentRow[]=[],claimed=new Set<string>(),push=(r:PresentRow)=>{rows.push(r);o.onRow?.(r);};
 const ids=(await db.query<Cand>(CANDIDATES)).rows.map(c=>c.id);
 const settle=async(id:string,r:PresentRow)=>{
  await audit(db,actor,'RESULT_BACKLOG_HIS_PRESENT','RESULT_VERSION',id,{previousState:r.from,resultingState:r.to,outcome:r.reason?token(r.reason):r.outcome,reasonCode:BACKLOG_HIS_PRESENT_CODE});
  await db.query(o.apply?'COMMIT':'ROLLBACK');push(r);
 };
 for(const id of ids){
  await db.query('BEGIN');
  try{
   const c=await fresh(db,id);
   await settle(id,await presentOne(db,actor,c,claimed));
  }catch(e){
   await db.query('ROLLBACK');
   const code=codeOf(e);
   // Recoverable: a refusal by the service or the DB for this one version. Anything else (lost connection, bug) stops the run; earlier versions stay committed.
   if(!(e instanceof LabError)&&!REFUSALS.test(code))throw e;
   const c=await fresh(db,id);
   push({versionId:id,from:c.state,to:c.state,outcome:'NOT_CHANGED',reason:code,pdfHn:c.pdf_hn,pdfLab:c.pdf_lab,ln:c.ln,hn:c.hn});
  }
 }
 return {rows};
}

// ---------- report ----------
const COLS=['versionId','from','to','outcome','dryRun','reason','pdfHn','pdfLabNumber','ln','hn'] as const;
// A cell starting with = + - @ would be run as a formula by a spreadsheet.
const cell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const mdCell=(v:unknown)=>String(v===null||v===undefined?'':v).replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const csvLine=(r:PresentRow,apply:boolean)=>[r.versionId,r.from,r.to,r.outcome,!apply,r.reason,r.pdfHn,r.pdfLab,r.ln,r.hn].map(cell).join(',')+'\r\n';
export function markdownOf(rows:PresentRow[],apply:boolean,dir:string){
 const count=(f:(r:PresentRow)=>string)=>Object.entries(rows.reduce<Record<string,number>>((a,r)=>({...a,[f(r)]:(a[f(r)]??0)+1}),{})).sort();
 const table=(h:string[],rs:unknown[][])=>[`| ${h.join(' | ')} |`,`| ${h.map(()=>'---').join(' | ')} |`,...rs.map(r=>`| ${r.map(mdCell).join(' | ')} |`)].join('\n');
 const shown=rows.filter(r=>r.outcome==='SHOWN'||r.outcome==='LINKED_AND_SHOWN').length;
 return [`# Backlog "มีผลใน HIS แล้ว" ${BACKLOG_HIS_PRESENT_CODE} - ${apply?'APPLIED':'DRY RUN (nothing stays in the database)'}`,'',`Report folder: ${mdCell(dir)}`,'',
  `Rows: ${rows.length}. ${apply?'Shown on the patient and off the board:':'Would be shown on the patient and leave the board:'} ${shown}.`,'',
  '## By outcome',table(['outcome','rows'],count(r=>r.outcome).map(([k,n])=>[k,n])),'',
  '## Not changed / not shown, by reason (pick these by hand on the board, or fix the data first)',table(['reason','rows'],count(r=>r.reason??'(none)').filter(([k])=>k!=='(none)').map(([k,n])=>[k,n])),'',
  '## Every row',table(['version','from','to','outcome','reason','HN (PDF)','lab no. (PDF)','LN','HN'],rows.map(r=>[r.versionId,r.from,r.to,r.outcome,r.reason,r.pdfHn,r.pdfLab,r.ln,r.hn])),''].join('\n');
}
/** Creates the folder and both files exclusively (never overwrites). Rows are appended as they finish; finish() writes the Markdown summary. */
export function openReport(dir:string,apply:boolean){
 const stem=path.join(dir,`backlog-his-present-${apply?'apply':'dry-run'}`);
 if(existsSync(stem+'.csv')||existsSync(stem+'.md'))throw new Error('REPORT_FILES_EXIST');
 mkdirSync(dir,{recursive:true});
 const csv=openSync(stem+'.csv','wx');closeSync(csv);
 appendFileSync(stem+'.csv','\ufeff'+COLS.join(',')+'\r\n');
 let appended=0;
 return {stem,append:(r:PresentRow)=>{appended++;appendFileSync(stem+'.csv',csvLine(r,apply));},
  /** Removes the empty files this run created (only if no row was written), so the same folder can be reused. */
  discard:()=>{if(appended)return;rmSync(stem+'.csv',{force:true});rmSync(stem+'.md',{force:true});},
  finish:(rows:PresentRow[])=>{const md=openSync(stem+'.md','w');writeSync(md,markdownOf(rows,apply,dir));closeSync(md);}};
}
/** Report text without touching the file system (tests, previews). */
export const reportOf=(rows:PresentRow[],apply:boolean)=>({csv:'\ufeff'+COLS.join(',')+'\r\n'+rows.map(r=>csvLine(r,apply)).join(''),md:markdownOf(rows,apply,'')});

// ---------- CLI ----------
export type Deps={connect:()=>Promise<{db:Queryable;close:()=>Promise<void>}>;verifiedBackup:()=>Promise<{at?:string|null}>;defaultOut:()=>string;log:(line:string)=>void};
export async function main(argv:string[],deps:Deps){
 const arg=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];},apply=argv.includes('--apply'),out=arg('out');
 if(out!==undefined&&(out.startsWith('--')||!out.trim()))throw new Error('OUT_DIR_INVALID');
 if(apply&&!out)throw new Error('OUT_DIR_REQUIRED_FOR_APPLY');
 if(apply){ // only after a fresh verified backup; checked before any SQL
  const b=await deps.verifiedBackup().catch(()=>null),age=b?.at?Math.round((Date.now()-Date.parse(b.at))/60000):null;
  if(age===null||!(age<=24*60))throw new Error('VERIFIED_BACKUP_REQUIRED');
 }
 const dir=path.resolve(out??deps.defaultOut());
 const report=openReport(dir,apply);   // fails before the database is touched
 deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',reportFolder:dir,note:apply?'run in a quiet period':'nothing stays in the database'}));
 let conn:Awaited<ReturnType<Deps['connect']>>|undefined;
 try{
  conn=await deps.connect();
  const r=(await conn.db.query<{id:string}>("SELECT u.id FROM app_user u WHERE u.username=$1 AND u.enabled AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='APP_ADMIN' AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))",[arg('actor')??'admin'])).rows[0];
  if(!r)throw new Error('APP_ADMIN_ACTOR_NOT_AVAILABLE');
  const actor:Staff={id:r.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
  const {rows}=await runBacklogHisPresent(conn.db,actor,{apply,onRow:report.append});
  report.finish(rows);
  deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',rows:rows.length,shown:rows.filter(x=>x.outcome==='SHOWN'||x.outcome==='LINKED_AND_SHOWN').length,report:report.stem+'.csv / .md'}));
  if(out===undefined)deps.log('รายงานมี HN/LN — ลบโฟลเดอร์เมื่อใช้งานเสร็จ');
  return {rows,report:report.stem};
 }catch(e){report.discard();throw e;}
 finally{await conn?.close();}
}
const realDeps:Deps={
 connect:async()=>{const {pool}=await import('../../packages/db/connection');const p=pool(),client=await p.connect();return {db:client as unknown as Queryable,close:async()=>{client.release();await p.end();}};},
 verifiedBackup:async()=>{const {verifiedMigrationBackup}=await import('../../packages/migration/service');return verifiedMigrationBackup();},
 defaultOut:()=>path.join(os.tmpdir(),`nipt-backlog-his-present-20261109-${new Date().toISOString().replace(/[:.]/g,'-')}`),
 log:l=>{process.stdout.write(l+'\n');}
};
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2),realDeps).catch(e=>{process.stderr.write(String(e instanceof Error?e.message:e)+'\n');process.exit(1);});
