/** One-time operator script (Owner decision 2026-11-23): fills "ครรภ์ที่" (gravida) from a HIS ANC export for released results still waiting on
 *  ลงผลสปสช. whose request has none. Those are paper Lab cases whose request check was saved without ครรภ์ที่, so the HIS ANC import (which only
 *  fills cases still waiting for the check) skips them. The value goes where a saved check puts it (p2_workspace draft.pregnancy.gravida,
 *  as p2/service paperReview does), so ลงผลสปสช. shows it; the check record and the released result are not touched.
 *  A case matches a HIS row exactly as the HIS ANC import matches: the CID (as the PET identity key) and the HN of its stored PET.
 *  It lives in tools/migration because `nipt-admin ops-run` only runs scripts from there.
 *    dry run: nipt-admin ops-run --root <root> --script tools\migration\nhso-gravida-from-his-20261123.ts -- --file <NIPT-5.xlsx> [--out <dir>] [--actor <username>]
 *    apply:   nipt-admin ops-run --root <root> --script tools\migration\nhso-gravida-from-his-20261123.ts -- --file <NIPT-5.xlsx> --apply --out <new dir> [--actor <username>]
 *  DRY RUN IS THE DEFAULT and runs the very code --apply runs: each case in its own transaction, ROLLED BACK instead of committed.
 *  --apply needs a verified backup younger than 24 h, checked before any SQL. Rows of the file that disagree on ครรภ์ที่ for one patient are
 *  reported (CONFLICT) and left empty. Running it again only handles cases that still have no ครรภ์ที่.
 *  The report is for the operator: LN and ครรภ์ที่, never a patient name, HN or CID. */
import {existsSync,mkdirSync,openSync,writeSync,closeSync,rmSync,appendFileSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {audit,type Staff} from '../../packages/lab/core';
import {identityLookup} from '../../packages/security/envelope';
import {parseHisAncWorkbook,type HisAncRow} from '../../packages/his-anc/parse';

export const NHSO_GRAVIDA_CODE='NHSO_GRAVIDA_FROM_HIS_20261123';
export type GravidaOutcome='FILLED'|'NOT_IN_FILE'|'NO_GRAVIDA_IN_FILE'|'CONFLICT'|'NO_PET_IDENTITY'|'NO_REQUEST_DRAFT';
export type GravidaRow={caseId:string;ln:string|null;gravida:number|null;outcome:GravidaOutcome};

type Cand={case_id:string;ln:string|null;ws_round_id:string|null;identity_key:string|null;hn:string|null};
// Released results still waiting on ลงผลสปสช. (no CONFIRMED / NOT_NHSO decision), as nhso-entry lists them, whose request draft and every
// paper check of the case have no ครรภ์ที่. The draft is the one ลงผลสปสช. reads: the release round's workspace first, else the newest round's.
export const CANDIDATES=`SELECT DISTINCT ON (rr.case_id) rr.case_id,l.ln,w.round_id ws_round_id,pet.parsed->>'identityKey' identity_key,pet.parsed->>'hn' hn
 FROM result_release rr JOIN nipt_case c ON c.id=rr.case_id JOIN specimen_round s ON s.id=rr.round_id JOIN case_ln l ON l.id=s.case_ln_id
 LEFT JOIN LATERAL (SELECT w.round_id,w.draft FROM p2_workspace w JOIN specimen_round x ON x.id=w.round_id
   WHERE w.case_id=rr.case_id ORDER BY (w.round_id=rr.round_id) DESC,x.round_number DESC LIMIT 1) w ON true
 LEFT JOIN LATERAL (SELECT f.parsed FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id
   WHERE o.round_id=rr.round_id ORDER BY o.his_received_at DESC LIMIT 1) pet ON true
 WHERE rr.state='Active' AND rr.kind='RESULT' AND c.registration_origin<>'HISTORICAL'
  AND NOT EXISTS(SELECT 1 FROM eqa_case q WHERE q.case_id=rr.case_id)
  AND (SELECT x.kind FROM nhso_result_entry_event x WHERE x.release_id=rr.id ORDER BY x.sequence DESC LIMIT 1) IS NULL
  AND jsonb_typeof(w.draft#>'{pregnancy,gravida}') IS DISTINCT FROM 'number'
  AND NOT EXISTS(SELECT 1 FROM p2_paper_review p WHERE p.case_id=rr.case_id AND p.kind='REQUEST' AND jsonb_typeof(p.panel->'gravida')='number')
 ORDER BY rr.case_id,rr.certified_at DESC`;

const hnKey=(hn:string)=>hn.trim().replace(/^0+/,'');
/** ครรภ์ที่ per patient (PET identity key + HN): every value the file gives, so a disagreement is seen. Rows without a valid identifier are not used. */
export function gravidaIndex(rows:readonly HisAncRow[],lookupKey:Buffer){
 const m=new Map<string,{rows:number;values:Set<number>}>();
 for(const r of rows){
  if(r.incomplete==='BAD_IDENTIFIER')continue;
  const k=identityLookup(r.cid,lookupKey)+'|'+hnKey(r.hn),e=m.get(k)??{rows:0,values:new Set<number>()};
  e.rows++;if(r.gravida!==null)e.values.add(r.gravida);m.set(k,e);
 }
 return m;
}

/** Dry run (apply=false): every case in a transaction that is rolled back. Apply: every case in its own committed transaction; `onRow` runs after each one. */
export async function runNhsoGravida(db:Queryable,actor:Staff,file:Buffer,lookupKey:Buffer,o:{apply:boolean;onRow?:(r:GravidaRow)=>void}):Promise<{rows:GravidaRow[]}>{
 const index=gravidaIndex(parseHisAncWorkbook(file),lookupKey);
 const rows:GravidaRow[]=[],push=(r:GravidaRow)=>{rows.push(r);o.onRow?.(r);};
 for(const c of (await db.query<Cand>(CANDIDATES)).rows){
  const base={caseId:c.case_id,ln:c.ln};
  if(!c.identity_key||!c.hn){push({...base,gravida:null,outcome:'NO_PET_IDENTITY'});continue;}
  if(!c.ws_round_id){push({...base,gravida:null,outcome:'NO_REQUEST_DRAFT'});continue;}
  const hit=index.get(c.identity_key+'|'+hnKey(c.hn));
  if(!hit){push({...base,gravida:null,outcome:'NOT_IN_FILE'});continue;}
  if(hit.values.size===0){push({...base,gravida:null,outcome:'NO_GRAVIDA_IN_FILE'});continue;}
  if(hit.values.size>1){push({...base,gravida:null,outcome:'CONFLICT'});continue;}
  const gravida=[...hit.values][0];
  await db.query('BEGIN');
  try{
   // Fill the blank only: a value saved meanwhile wins (the row is then not updated and the case is reported as having none to fill).
   const u=await db.query(`UPDATE p2_workspace SET draft=jsonb_set(draft,'{pregnancy,gravida}',to_jsonb($2::int),true),version=version+1,updated_by=$3,updated_at=clock_timestamp()
     WHERE round_id=$1 AND jsonb_typeof(draft->'pregnancy')='object' AND jsonb_typeof(draft#>'{pregnancy,gravida}') IS DISTINCT FROM 'number' RETURNING round_id`,[c.ws_round_id,gravida,actor.id]);
   if(!u.rows.length){await db.query('ROLLBACK');push({...base,gravida:null,outcome:'NO_REQUEST_DRAFT'});continue;}
   await audit(db,actor,'NHSO_GRAVIDA_FROM_HIS','CASE',c.case_id,{outcome:'FILLED',reasonCode:NHSO_GRAVIDA_CODE});
   await db.query(o.apply?'COMMIT':'ROLLBACK');
  }catch(e){await db.query('ROLLBACK');throw e;}  // a refusal here is a bug or a lost connection: stop; earlier cases stay committed
  push({...base,gravida,outcome:'FILLED'});
 }
 return {rows};
}

// ---------- report ----------
const COLS=['caseId','ln','gravida','outcome','dryRun'] as const;
const cell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const mdCell=(v:unknown)=>String(v===null||v===undefined?'':v).replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const csvLine=(r:GravidaRow,apply:boolean)=>[r.caseId,r.ln,r.gravida,r.outcome,!apply].map(cell).join(',')+'\r\n';
export function markdownOf(rows:GravidaRow[],apply:boolean,dir:string){
 const count=Object.entries(rows.reduce<Record<string,number>>((a,r)=>({...a,[r.outcome]:(a[r.outcome]??0)+1}),{})).sort();
 const table=(h:string[],rs:unknown[][])=>[`| ${h.join(' | ')} |`,`| ${h.map(()=>'---').join(' | ')} |`,...rs.map(r=>`| ${r.map(mdCell).join(' | ')} |`)].join('\n');
 return [`# ครรภ์ที่ from HIS for ลงผลสปสช. ${NHSO_GRAVIDA_CODE} - ${apply?'APPLIED':'DRY RUN (nothing stays in the database)'}`,'',`Report folder: ${mdCell(dir)}`,'',
  `Cases: ${rows.length}. ${apply?'Filled:':'Would be filled:'} ${rows.filter(r=>r.outcome==='FILLED').length}.`,'',
  '## By outcome',table(['outcome','cases'],count),'',
  '## Every case',table(['LN','ครรภ์ที่','outcome'],rows.map(r=>[r.ln,r.gravida,r.outcome])),''].join('\n');
}
/** Creates the folder and both files exclusively (never overwrites). Rows are appended as they finish; finish() writes the Markdown summary. */
export function openReport(dir:string,apply:boolean){
 const stem=path.join(dir,`nhso-gravida-${apply?'apply':'dry-run'}`);
 if(existsSync(stem+'.csv')||existsSync(stem+'.md'))throw new Error('REPORT_FILES_EXIST');
 mkdirSync(dir,{recursive:true});
 const csv=openSync(stem+'.csv','wx');closeSync(csv);
 appendFileSync(stem+'.csv','\ufeff'+COLS.join(',')+'\r\n');
 let appended=0;
 return {stem,append:(r:GravidaRow)=>{appended++;appendFileSync(stem+'.csv',csvLine(r,apply));},
  discard:()=>{if(appended)return;rmSync(stem+'.csv',{force:true});rmSync(stem+'.md',{force:true});},
  finish:(rows:GravidaRow[])=>{const md=openSync(stem+'.md','w');writeSync(md,markdownOf(rows,apply,dir));closeSync(md);}};
}

// ---------- CLI ----------
export type Deps={connect:()=>Promise<{db:Queryable;close:()=>Promise<void>}>;readFile:(p:string)=>Buffer;lookupKey:()=>Buffer;verifiedBackup:()=>Promise<{at?:string|null}>;defaultOut:()=>string;log:(line:string)=>void};
export async function main(argv:string[],deps:Deps){
 const arg=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];},apply=argv.includes('--apply'),out=arg('out'),file=arg('file');
 if(!file||file.startsWith('--'))throw new Error('FILE_REQUIRED');
 if(out!==undefined&&(out.startsWith('--')||!out.trim()))throw new Error('OUT_DIR_INVALID');
 if(apply&&!out)throw new Error('OUT_DIR_REQUIRED_FOR_APPLY');
 const bytes=deps.readFile(file),key=deps.lookupKey();
 parseHisAncWorkbook(bytes);   // a wrong or unreadable file fails before anything else
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
  const {rows}=await runNhsoGravida(conn.db,actor,bytes,key,{apply,onRow:report.append});
  report.finish(rows);
  deps.log(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',cases:rows.length,filled:rows.filter(x=>x.outcome==='FILLED').length,report:report.stem+'.csv / .md'}));
  if(out===undefined)deps.log('รายงานมี LN — ลบโฟลเดอร์เมื่อใช้งานเสร็จ');
  return {rows,report:report.stem};
 }catch(e){report.discard();throw e;}
 finally{await conn?.close();}
}
const realDeps:Deps={
 connect:async()=>{const {pool}=await import('../../packages/db/connection');const p=pool(),client=await p.connect();return {db:client as unknown as Queryable,close:async()=>{client.release();await p.end();}};},
 readFile:p=>readFileSync(p),
 lookupKey:()=>{const f=process.env.IDENTITY_LOOKUP_KEY_FILE;if(!f)throw new Error('IDENTITY_LOOKUP_KEY_FILE_MISSING');return readFileSync(f);},
 verifiedBackup:async()=>{const {verifiedMigrationBackup}=await import('../../packages/migration/service');return verifiedMigrationBackup();},
 defaultOut:()=>path.join(os.tmpdir(),`nipt-nhso-gravida-20261123-${new Date().toISOString().replace(/[:.]/g,'-')}`),
 log:l=>{process.stdout.write(l+'\n');}
};
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2),realDeps).catch(e=>{process.stderr.write(String(e instanceof Error?e.message:e)+'\n');process.exit(1);});
