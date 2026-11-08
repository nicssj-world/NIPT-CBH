/** One-time operator script (Owner decision 2026-11-07, design spec 3.6 / 5.6): re-links results that the OLD, stricter link rule left stuck, under the
 *  new rule (HN + lab number, exactly one current latest attempt). It lives in tools/migration because `nipt-admin ops-run` only runs scripts from there.
 *    nipt-admin ops-run --root <root> --script tools\migration\backlog-relink-20261107.ts -- [--apply] [--out <dir>] [--actor <username>]
 *  DRY RUN IS THE DEFAULT: it runs in a READ ONLY transaction that is always rolled back, calls no write function and writes no audit row.
 *  --apply works one version at a time in its own SAVEPOINT, audits each one (BACKLOG_RELINK_20261107) and commits at the end.
 *  It NEVER records a review or QC5, certifies, voids, sends to HIS or picks a patient on anybody's behalf.
 *  The report (CSV + Markdown) is for the operator: it holds HN and lab numbers but never a patient name. */
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {LabError,audit,type Staff} from '../../packages/lab/core';
import {autoLinkUnique,unlinkVersion,backlogRelinkPreview,backlogRevalidate,validationGateIssues,releaseReviewed} from '../../packages/results/service';
import {isSendResolvable} from '../../packages/results/release-queue';

export const BACKLOG_REASON_CODE='BACKLOG_RELINK_20261107';
export type RelinkRow={versionId:string;source:'READYGEN'|'HALOS';from:string;to:string;wouldBecome:boolean;
 match:{hn:string|null;ln:string|null;lnHalos:string|null}|null;rule:string|null;reason:string|null;board:'READY'|'ACTION'|'NONE';reviewed:boolean;gateReasons:string[];pdfHn:string|null;pdfLab:string|null};

type Cand={id:string;state:string;origin:string;row_version:number;supersedes_id:string|null;pdf_hn:string|null;pdf_lab:string|null;round_id:string|null;current_round_id:string|null;link_mode:string|null;ln:string|null;ln_halos:string|null;hn:string|null};
const SELECT_VERSION=`SELECT v.id,v.state,v.origin,v.row_version,v.supersedes_id,v.parsed->'identifiers'->'hn'->>'value' pdf_hn,v.parsed->'identifiers'->'labNumber'->>'value' pdf_lab,v.round_id,c.current_round_id,v.link_mode,
  l.ln,n.ln_halos,i.hn
 FROM result_report_version v LEFT JOIN nipt_case c ON c.id=v.case_id LEFT JOIN specimen_round r ON r.id=v.round_id LEFT JOIN case_ln l ON l.id=r.case_ln_id
  LEFT JOIN specimen_lab_number n ON n.round_id=v.round_id LEFT JOIN p2_case_identity i ON i.case_id=v.case_id`;
const CANDIDATES=`${SELECT_VERSION}
 WHERE v.kind='RESULT' AND NOT EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id) AND (c.id IS NULL OR c.registration_origin<>'HISTORICAL')
  AND (v.state IN ('Unlinked','LinkConflict','ValidationBlocked','Linked')
   OR (v.state NOT IN ('CertifiedReleased','Voided','Superseded','RejectedImport') AND EXISTS(SELECT 1 FROM internal_report ir WHERE ir.version_id=v.id AND ir.state='Final')))
 ORDER BY v.imported_at DESC,v.id`;
// Newest first: when two stuck PDFs belong to one round the newest links and the older one is reported as SERIES_NOT_EMPTY.
const REFUSALS=/^(AUTO_LINK_[A-Z_]+|LINK_PROPOSAL_OPEN|VERSION_CONFLICT|UNLINK_NOT_ALLOWED|UNLINK_REVISION_PROHIBITED)$/;
const codeOf=(e:unknown)=>e instanceof LabError?e.code:(e as {code?:string}).code==='23505'?'AUTO_LINK_CONCURRENT_SERIES':e instanceof Error?e.message:'';
const gateCodes=(g:{failed:string[];pending:string[]})=>[...g.failed.map(x=>x.split(':')[1]),...g.pending.map(x=>x.split(':')[2])].filter((x):x is string=>!!x);

async function boardOf(db:Queryable,id:string,state:string,preview?:{failed:string[];pending:string[]}|null){
 if(state==='PendingCertification')return {board:'READY' as const,gateReasons:[] as string[],reviewed:await releaseReviewed(db,id)};
 if(state==='Linked'||state==='ValidationBlocked'){
  const g=preview??await validationGateIssues(db,id);
  return {board:isSendResolvable(g)?'READY' as const:'ACTION' as const,gateReasons:gateCodes(g),reviewed:preview?false:await releaseReviewed(db,id)};
 }
 return {board:'ACTION' as const,gateReasons:[] as string[],reviewed:false};
}
const linkedMatch=(c:Cand)=>c.round_id?{hn:c.hn,ln:c.ln,lnHalos:c.ln_halos}:null;

/** Dry run (apply=false) is read only by construction: BEGIN READ ONLY, only read functions, always ROLLBACK. */
export async function runBacklogRelink(db:Queryable,actor:Staff,o:{apply:boolean}):Promise<{rows:RelinkRow[]}>{
 await db.query(o.apply?'BEGIN':'BEGIN TRANSACTION READ ONLY');
 try{
  const cands=(await db.query<Cand>(CANDIDATES)).rows,rows:RelinkRow[]=[],claimed=new Set<string>();
  for(const c of cands){
   const base={versionId:c.id,source:c.origin==='INTERNAL_GENERATED'?'HALOS' as const:'READYGEN' as const,from:c.state,pdfHn:c.pdf_hn,pdfLab:c.pdf_lab};
   const done=async(to:string,match:RelinkRow['match'],rule:string|null,reason:string|null,preview?:{failed:string[];pending:string[]}|null)=>{
    const b=await boardOf(db,c.id,to,preview);rows.push({...base,to,wouldBecome:!o.apply,match,rule,reason,...b});};
   if(c.round_id&&c.round_id!==c.current_round_id){await done(c.state,linkedMatch(c),c.link_mode,'ROUND_NOT_CURRENT');continue;}
   if(!o.apply){
    const p=await backlogRelinkPreview(db,c.id);
    if(c.state==='Unlinked'||c.state==='LinkConflict'){
     const unlinkBlocked=c.state==='LinkConflict'&&!!c.supersedes_id;
     const to0=c.state==='LinkConflict'&&!unlinkBlocked?'Unlinked':c.state;
     const free=!!p.match&&!p.reason&&!unlinkBlocked&&!!p.roundId&&!claimed.has(p.roundId);
     if(free){claimed.add(p.roundId!);await done(p.gate?.eligible?'PendingCertification':'ValidationBlocked',p.match,p.match!.rule,null,p.gate);}
     else await done(to0,p.match,p.match?.rule??null,unlinkBlocked?'UNLINK_REVISION_PROHIBITED':p.roundId&&claimed.has(p.roundId)?'SERIES_NOT_EMPTY':p.reason);
    }else if(c.state==='PendingCertification')await done(c.state,linkedMatch(c),c.link_mode,'ALREADY_WAITING_FOR_HIS');
    else await done(p.gate?.eligible?'PendingCertification':'ValidationBlocked',linkedMatch(c),c.link_mode,null,p.gate);
    continue;
   }
   // ---- apply ----
   let state=c.state,reason:string|null=null,match=linkedMatch(c),rule=c.link_mode;
   const step=async<T>(name:string,fn:()=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;code:string}>=>{
    await db.query(`SAVEPOINT ${name}`);
    try{const value=await fn();await db.query(`RELEASE SAVEPOINT ${name}`);return {ok:true,value};}
    catch(e){const code=codeOf(e);if(!(e instanceof LabError)&&!REFUSALS.test(code)&&code!=='AUTO_LINK_CONCURRENT_SERIES')throw e;
     await db.query(`ROLLBACK TO SAVEPOINT ${name}`);await db.query(`RELEASE SAVEPOINT ${name}`);return {ok:false,code};}
   };
   if(state==='LinkConflict'){
    // The only allowed transition out of LinkConflict is → Unlinked.
    const u=await step('relink_unlink',()=>unlinkVersion(db,actor,{versionId:c.id,reason:'ล้างงานค้างครั้งเดียวตามกฎจับคู่ใหม่ (BACKLOG_RELINK_20261107)',expectedRowVersion:c.row_version}));
    if(u.ok){state='Unlinked';match=null;rule=null;}else reason=u.code;
   }
   if(state==='Unlinked'&&!reason){
    const r=await step('relink_link',async()=>{
     const x=await autoLinkUnique(db,actor,c.id);
     return x.linked?{linked:true as const,state:x.version.state}:{linked:false as const,reason:x.reason};
    });
    if(!r.ok)reason=r.code;
    else if(!r.value.linked)reason=r.value.reason;
    else{state=r.value.state;
     const m=(await db.query<Cand>(`${SELECT_VERSION} WHERE v.id=$1`,[c.id])).rows[0];match=m?linkedMatch(m):null;rule='AUTO_UNIQUE';}
   }else if(state==='Linked'||state==='ValidationBlocked'){
    const r=await step('relink_validate',()=>backlogRevalidate(db,actor,c.id));
    if(r.ok)state=r.value;else reason=r.code;
   }else if(state==='PendingCertification')reason='ALREADY_WAITING_FOR_HIS';
   await done(state,match,rule,reason);
   // One audit row per processed version, whatever happened (the actor is the operator account running the script).
   await audit(db,actor,'RESULT_BACKLOG_RELINK','RESULT_VERSION',c.id,{previousState:c.state,resultingState:state,outcome:reason?reason.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80):'RELINKED',reasonCode:BACKLOG_REASON_CODE});
  }
  await db.query(o.apply?'COMMIT':'ROLLBACK');
  return {rows};
 }catch(e){await db.query('ROLLBACK');throw e;}
}

// ---------- report ----------
const COLS=['versionId','source','from','to','dryRun','pdfHn','pdfLabNumber','matchHn','matchLn','matchLnHalos','rule','reason','board','reviewed','gateReasons'] as const;
// A cell starting with = + - @ would be run as a formula by a spreadsheet.
const cell=(v:unknown)=>{let s=v===null||v===undefined?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export function reportOf(rows:RelinkRow[],apply:boolean){
 const line=(r:RelinkRow)=>[r.versionId,r.source,r.from,r.to,r.wouldBecome,r.pdfHn,r.pdfLab,r.match?.hn,r.match?.ln,r.match?.lnHalos,r.rule,r.reason,r.board,r.reviewed,r.gateReasons.join(' ')].map(cell).join(',');
 const csv=[COLS.join(','),...rows.map(line)].join('\r\n')+'\r\n';
 const count=(f:(r:RelinkRow)=>string)=>Object.entries(rows.reduce<Record<string,number>>((a,r)=>({...a,[f(r)]:(a[f(r)]??0)+1}),{})).sort();
 const table=(h:string[],rs:(string|number|boolean|null)[][])=>[`| ${h.join(' | ')} |`,`| ${h.map(()=>'---').join(' | ')} |`,...rs.map(r=>`| ${r.map(x=>x===null?'':String(x)).join(' | ')} |`)].join('\n');
 const md=[`# Backlog re-link ${BACKLOG_REASON_CODE} - ${apply?'APPLIED':'DRY RUN (nothing was written)'}`,'',
  `Rows: ${rows.length}. ${apply?'"to" is the state after the run.':'"to" is what each row WOULD become; rows are evaluated one by one, a later row of the same round is reported SERIES_NOT_EMPTY.'}`,'',
  '## By state',table(['from','to','rows'],count(r=>r.from+'|'+r.to).map(([k,n])=>[...k.split('|'),n])),'',
  '## Board after',table(['board','rows'],count(r=>r.board).map(([k,n])=>[k,n])),'',
  '## Not linked, by reason',table(['reason','rows'],count(r=>r.reason??'(none)').map(([k,n])=>[k,n])),'',
  '## Every row',table(['version','source','from','to','HN (PDF)','lab no. (PDF)','match HN','match LN','LN Halos','rule','reason','board','reviewed','gate'],
   rows.map(r=>[r.versionId,r.source,r.from,r.to,r.pdfHn,r.pdfLab,r.match?.hn??null,r.match?.ln??null,r.match?.lnHalos??null,r.rule,r.reason,r.board,r.reviewed,r.gateReasons.join(' ')])),''].join('\n');
 return {csv,md};
}
export function writeReport(dir:string,rows:RelinkRow[],apply:boolean){
 mkdirSync(dir,{recursive:true});const {csv,md}=reportOf(rows,apply),stem=path.join(dir,`backlog-relink-${apply?'apply':'dry-run'}`);
 writeFileSync(stem+'.csv','﻿'+csv,{flag:'wx'});writeFileSync(stem+'.md',md,{flag:'wx'});return stem;
}

// ---------- CLI ----------
async function main(){
 const argv=process.argv.slice(2),arg=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];},apply=argv.includes('--apply');
 const {pool}=await import('../../packages/db/connection');
 const p=pool(),client=await p.connect();
 try{
  const r=(await client.query<{id:string}>("SELECT u.id FROM app_user u WHERE u.username=$1 AND u.enabled AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='APP_ADMIN' AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))",[arg('actor')??'admin'])).rows[0];
  if(!r)throw Error('APP_ADMIN_ACTOR_NOT_AVAILABLE');
  const actor:Staff={id:r.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
  if(apply){ // like the historical migration: only after a fresh verified backup
   const {verifiedMigrationBackup}=await import('../../packages/migration/service');
   const b=await verifiedMigrationBackup(),age=b.at?Math.round((Date.now()-Date.parse(b.at))/60000):null;
   if(age===null||age>24*60)throw Error('VERIFIED_BACKUP_TOO_OLD_OR_UNDATED');
  }
  const {rows}=await runBacklogRelink(client,actor,{apply});
  const stem=writeReport(path.resolve(arg('out')??`backlog-relink-20261107-${new Date().toISOString().replace(/[:.]/g,'-')}`),rows,apply);
  process.stdout.write(JSON.stringify({mode:apply?'APPLY':'DRY_RUN',rows:rows.length,report:stem+'.csv / .md'})+'\n');
 }finally{client.release();await p.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write(String(e instanceof Error?e.message:e)+'\n');process.exit(1);});
