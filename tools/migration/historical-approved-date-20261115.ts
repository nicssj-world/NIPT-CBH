/** One-time operator script (Owner decision 2026-11-15): dates every result reported by the previous system (historical_reported_result) by the
 *  "Approved Date" printed on its own PDF, so the statistics count it in the month it was reported instead of the month it was imported.
 *  Those ReadyGen PDFs print "Approved Date: 04 - Nov - 2026" and no "Reported Date:", and the parsed evidence is immutable, so the date read
 *  from the very same bytes (hash checked) goes to historical_result_approved_date (migration 228, insert-only). Results certified in NIPT-CBH
 *  are never touched. It lives in tools/migration because `nipt-admin ops-run` only runs scripts from there.
 *    dry run: nipt-admin ops-run --root <root> --script tools\migration\historical-approved-date-20261115.ts -- [--out <dir>] [--actor <username>]
 *    apply:   nipt-admin ops-run --root <root> --script tools\migration\historical-approved-date-20261115.ts -- --apply --out <new dir> [--actor <username>]
 *  DRY RUN IS THE DEFAULT and runs the very code --apply runs: each version in its own transaction, ROLLED BACK instead of committed.
 *  --apply needs a verified backup younger than 24 h, checked before any SQL. A version whose PDF has no readable Approved Date, or two
 *  different ones, is reported and left dated by its import. Running it again only handles versions that still have no date.
 *  The report is for the operator: LN and dates, never a patient name. */
import {existsSync,mkdirSync,openSync,writeSync,closeSync,rmSync,appendFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {audit,type Staff} from '../../packages/lab/core';
import {approvedDateOf} from '../../packages/results/approved-date';
import {reportedDaySql} from '../../packages/results/query';

export const HISTORICAL_APPROVED_DATE_CODE='HISTORICAL_APPROVED_DATE_20261115';
export type ApprovedOutcome='RECORDED'|'NOT_FOUND'|'UNREADABLE'|'CONFLICT'|'ORIGINAL_UNREADABLE'|'EXTRACT_FAILED';
export type ApprovedRow={versionId:string;ln:string|null;importedDay:string;approvedOn:string|null;outcome:ApprovedOutcome;raw:string|null};
/** Reads the text of the stored PDF. Throws ORIGINAL_UNREADABLE (missing / hash mismatch) or EXTRACT_FAILED. */
export type PdfText=(sha256:string)=>Promise<string>;

type Cand={id:string;sha256:string;ln:string|null;imported_day:string};
// Only versions the statistics still date by their import: no printed Reported Date and no Approved Date recorded yet.
const CANDIDATES=`SELECT v.id,v.sha256,h.ln,to_char(v.imported_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') imported_day
 FROM historical_reported_result h JOIN result_report_version v ON v.id=h.version_id
 WHERE (${reportedDaySql}) IS NULL AND NOT EXISTS(SELECT 1 FROM historical_result_approved_date ad WHERE ad.version_id=v.id)
 ORDER BY v.imported_at,v.id`;

/** Dry run (apply=false): every version in a transaction that is rolled back. Apply: every version in its own committed transaction; `onRow` runs after each one. */
export async function runHistoricalApprovedDate(db:Queryable,actor:Staff,pdfText:PdfText,o:{apply:boolean;onRow?:(r:ApprovedRow)=>void}):Promise<{rows:ApprovedRow[]}>{
 const rows:ApprovedRow[]=[],push=(r:ApprovedRow)=>{rows.push(r);o.onRow?.(r);};
 const cands=(await db.query<Cand>(CANDIDATES)).rows;
 for(const c of cands){
  const base={versionId:c.id,ln:c.ln,importedDay:c.imported_day};
  let text:string;
  try{text=await pdfText(c.sha256);}catch(e){push({...base,approvedOn:null,outcome:(e instanceof Error&&e.message==='EXTRACT_FAILED')?'EXTRACT_FAILED':'ORIGINAL_UNREADABLE',raw:null});continue;}
  const d=approvedDateOf(text);
  if(d.value===null){push({...base,approvedOn:null,outcome:d.reason,raw:d.raw});continue;}
  await db.query('BEGIN');
  try{
   await db.query('INSERT INTO historical_result_approved_date(version_id,sha256,approved_on,raw,actor_id) VALUES($1,$2,$3,$4,$5)',[c.id,c.sha256,d.value,d.raw,actor.id]);
   await audit(db,actor,'HISTORICAL_APPROVED_DATE_RECORDED','RESULT_VERSION',c.id,{outcome:'RECORDED',reasonCode:HISTORICAL_APPROVED_DATE_CODE});
   await db.query(o.apply?'COMMIT':'ROLLBACK');
  }catch(e){await db.query('ROLLBACK');throw e;}  // a refusal here is a bug or a lost connection: stop; earlier versions stay committed
  push({...base,approvedOn:d.value,outcome:'RECORDED',raw:d.raw});
 }
 return {rows};
}

// ---------- report ----------
const COLS=['versionId','ln','importedDay','approvedOn','outcome','dryRun','raw'] as const;
// A cell starting with = + - @ would be run as a formula by a spreadsheet.
const cell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const mdCell=(v:unknown)=>String(v===null||v===undefined?'':v).replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const csvLine=(r:ApprovedRow,apply:boolean)=>[r.versionId,r.ln,r.importedDay,r.approvedOn,r.outcome,!apply,r.raw].map(cell).join(',')+'\r\n';
export function markdownOf(rows:ApprovedRow[],apply:boolean,dir:string){
 const count=(f:(r:ApprovedRow)=>string)=>Object.entries(rows.reduce<Record<string,number>>((a,r)=>({...a,[f(r)]:(a[f(r)]??0)+1}),{})).sort();
 const table=(h:string[],rs:unknown[][])=>[`| ${h.join(' | ')} |`,`| ${h.map(()=>'---').join(' | ')} |`,...rs.map(r=>`| ${r.map(mdCell).join(' | ')} |`)].join('\n');
 const rec=rows.filter(r=>r.outcome==='RECORDED');
 return [`# Approved Date of previous-system results ${HISTORICAL_APPROVED_DATE_CODE} - ${apply?'APPLIED':'DRY RUN (nothing stays in the database)'}`,'',`Report folder: ${mdCell(dir)}`,'',
  `Rows: ${rows.length}. ${apply?'Dated by their Approved Date:':'Would be dated by their Approved Date:'} ${rec.length}.`,'',
  '## By outcome',table(['outcome','rows'],count(r=>r.outcome).map(([k,n])=>[k,n])),'',
  '## Month: imported -> Approved',table(['imported month','approved month','rows'],count(r=>`${r.importedDay.slice(0,7)} -> ${r.approvedOn?.slice(0,7)??'(stays)'}`).map(([k,n])=>[...k.split(' -> '),n])),'',
  '## Every row',table(['version','LN','imported','approved','outcome','text on the PDF'],rows.map(r=>[r.versionId,r.ln,r.importedDay,r.approvedOn,r.outcome,r.raw])),''].join('\n');
}
/** Creates the folder and both files exclusively (never overwrites). Rows are appended as they finish; finish() writes the Markdown summary. */
export function openReport(dir:string,apply:boolean){
 const stem=path.join(dir,`historical-approved-date-${apply?'apply':'dry-run'}`);
 if(existsSync(stem+'.csv')||existsSync(stem+'.md'))throw new Error('REPORT_FILES_EXIST');
 mkdirSync(dir,{recursive:true});
 const csv=openSync(stem+'.csv','wx');closeSync(csv);
 appendFileSync(stem+'.csv','\ufeff'+COLS.join(',')+'\r\n');
 let appended=0;
 return {stem,append:(r:ApprovedRow)=>{appended++;appendFileSync(stem+'.csv',csvLine(r,apply));},
  /** Removes the empty files this run created (only if no row was written), so the same folder can be reused. */
  discard:()=>{if(appended)return;rmSync(stem+'.csv',{force:true});rmSync(stem+'.md',{force:true});},
  finish:(rows:ApprovedRow[])=>{const md=openSync(stem+'.md','w');writeSync(md,markdownOf(rows,apply,dir));closeSync(md);}};
}

// ---------- CLI ----------
export type Deps={connect:()=>Promise<{db:Queryable;close:()=>Promise<void>}>;pdfText:PdfText;verifiedBackup:()=>Promise<{at?:string|null}>;defaultOut:()=>string;log:(line:string)=>void};
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
  const {rows}=await runHistoricalApprovedDate(conn.db,actor,deps.pdfText,{apply,onRow:report.append});
  report.finish(rows);
  deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',rows:rows.length,recorded:rows.filter(x=>x.outcome==='RECORDED').length,report:report.stem+'.csv / .md'}));
  if(out===undefined)deps.log('รายงานมี LN — ลบโฟลเดอร์เมื่อใช้งานเสร็จ');
  return {rows,report:report.stem};
 }catch(e){report.discard();throw e;}
 finally{await conn?.close();}
}
const realDeps:Deps={
 connect:async()=>{const {pool}=await import('../../packages/db/connection');const p=pool(),client=await p.connect();return {db:client as unknown as Queryable,close:async()=>{client.release();await p.end();}};},
 pdfText:async sha=>{
  const {FileStore}=await import('../../packages/storage');const {extract}=await import('../../packages/results/extract');
  const root=process.env.FILE_STORE_ROOT;if(!root)throw new Error('ORIGINAL_UNREADABLE');
  const bytes=await new FileStore(path.resolve(root)).get(sha);  // checks the hash
  let extracted:Awaited<ReturnType<typeof extract>>;
  try{extracted=await extract(bytes);}catch{throw new Error('EXTRACT_FAILED');}
  if(extracted.container==='ZIP_BATCH')throw new Error('EXTRACT_FAILED');  // a result PDF is never a ZIP batch
  return extracted.text;
 },
 verifiedBackup:async()=>{const {verifiedMigrationBackup}=await import('../../packages/migration/service');return verifiedMigrationBackup();},
 defaultOut:()=>path.join(os.tmpdir(),`nipt-historical-approved-date-20261115-${new Date().toISOString().replace(/[:.]/g,'-')}`),
 log:l=>{process.stdout.write(l+'\n');}
};
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2),realDeps).catch(e=>{process.stderr.write(String(e instanceof Error?e.message:e)+'\n');process.exit(1);});
