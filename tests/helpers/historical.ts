import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from './database';
import {tx,labUsers} from './lab';
import {FileStore} from '../../packages/storage';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import type {Staff} from '../../packages/lab/core';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {createBatch,stageBatch,getBatch,confirmBatch} from '../../packages/historical/service';
import {syntheticReportPdf,syntheticZip,type ReportSpec} from '../../tools/his-simulator/result-pdf';
import {pdfDate} from './results';

/** Disposable PGlite for P5H: users (maker, second maker, verifier), file store, Maker-Checker settings. All data is synthetic. */
export const LOOKUP_KEY=Buffer.alloc(32,7);
export async function histFixture(){
 const db=await testDatabase();
 const u=await labUsers(db);
 const maker={...u.staff,permissions:['HISTORICAL_ENTRY']} as Staff,maker2={...u.staff2,permissions:['HISTORICAL_ENTRY']} as Staff;
 const vid=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.verifier','ผู้ตรวจจำลอง','$argon2id$v=19$synthetic') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'HISTORICAL_VERIFIER')",[vid]);
 const verifier={id:vid,roles:['HISTORICAL_VERIFIER'],unitIds:[],permissions:[]} as unknown as Staff;
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p5h-'));const store=new FileStore(path.join(base,'files'));
 const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(db,fn);
 const activate=async(key:string,value:unknown)=>run(async t=>{const id=await proposeSetting(t,u.certifier,key,value,'SYNTHETIC_P5H_POLICY');await validateSetting(t,u.certifier,id,async()=>true);await approveSetting(t,u.approver,id);await activateSetting(t,u.approver,id);return id;});
 /** Synthetic cutoff + Anchor (a): test values only, never an Owner decision. */
 const configure=async(cutoff='2026-01-01',anchorPolicy:'A_FINAL_REPORT'|'B_FINAL_REPORT_OR_CONTROL_RECORD'='A_FINAL_REPORT',minimumProfile:'OD18_A_IDENTITY_AND_ORIGINAL'|'OD18_B_BALANCED'|'PENDING_OD18'='OD18_B_BALANCED')=>{
  await activate('go_live_cutoff',{cutoff,impactReportHash:'a'.repeat(64)});
  await activate('historical_backfill',{anchorPolicy,minimumProfile,maxBatchRows:100});
 };
 return {db:db as PGlite,u,maker,maker2,verifier,store,run,activate,configure,base,close:async()=>{await db.close();await rm(base,{recursive:true,force:true});}};
}
export type HistFixture=Awaited<ReturnType<typeof histFixture>>;

export type SheetRow=Partial<Record<string,string>>;
const COLS=['ln','hn','name','dob','collection_date','receipt_date','report_date','control_record_date','request_date','consent_date','pdf_file','original_location','request_paper','consent_paper','consent_decision','pregnancy_type','past_certification'];
export const csvOf=(rows:SheetRow[])=>Buffer.from(COLS.join(',')+'\r\n'+rows.map(r=>COLS.map(c=>{const v=r[c]??'';return /[",\r\n]/.test(v)?`"${v.replaceAll('"','""')}"`:v;}).join(',')).join('\r\n')+'\r\n','utf8');
/** One valid synthetic row. LN 2610xxxxxx, HN 990xxxx (the synthetic HN family), report dated before the synthetic cutoff. */
export const goodRow=(n:number,over:SheetRow={}):SheetRow=>({ln:`2610${String(100000+n)}`,hn:`990${String(1000+n)}`,name:`SYNTHETIC PATIENT ${n}`,dob:'1995-04-0'+(1+n%9),collection_date:'2025-11-1'+(n%9),receipt_date:'2025-11-2'+(n%9),report_date:'2025-12-1'+(n%9),
 pdf_file:`report-${n}.pdf`,original_location:`SYNTHETIC-CABINET-${1+n%5}`,request_paper:'Y',consent_paper:'Y',consent_decision:'ยินยอม (ตามที่เขียน)',pregnancy_type:'Singleton',...over});
export const pdfFor=(r:SheetRow,over:Partial<ReportSpec>={})=>syntheticReportPdf({kind:'SINGLETON',labNumber:r.ln!,hn:r.hn!,name:r.name,dob:r.dob?pdfDate(r.dob):undefined,collection:r.collection_date?pdfDate(r.collection_date):'10-Nov-2025',received:r.receipt_date?pdfDate(r.receipt_date):undefined,reported:r.report_date?pdfDate(r.report_date):undefined,...over});

/** Upload + stage in one step (the worker job body), returning the batch id. */
export async function importBatch(f:HistFixture,rows:SheetRow[],pdfs:{name:string;bytes:Buffer}[],as:Staff=f.maker,opts:{zip?:boolean;tableName?:string}={}){
 const files=opts.zip?[{name:'reports.zip',bytes:syntheticZip(pdfs.map(p=>({name:p.name,data:p.bytes})))}]:pdfs;
 const {batchId}=await f.run(t=>createBatch(t,as,f.store,{table:{name:opts.tableName??'historical.csv',bytes:csvOf(rows)},files,idempotencyKey:randomUUID()}));
 await f.run(t=>stageBatch(t,f.store,batchId,as.id));
 return batchId;
}
export const attest=(over: Partial<{lnMatchesOriginal:boolean;anchorDateMatchesOriginal:boolean;pdfBindingMatchesOriginal:boolean;identityMatchesOriginal:boolean;identityIdentifiersChecked:('HN'|'NAME'|'DOB'|'NATIONAL_ID')[]}>={})=>({lnMatchesOriginal:true,anchorDateMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'] as ('HN'|'NAME'|'DOB'|'NATIONAL_ID')[],...over});
export async function view(f:HistFixture,batchId:string,as:Staff=f.verifier){return f.run(t=>getBatch(t,as,batchId));}
export async function confirmAll(f:HistFixture,batchId:string,as:Staff=f.verifier,key=randomUUID()){
 const v=await view(f,batchId,as);
 const rows=v.rows.filter(r=>r.state==='Submitted').map(r=>({draftId:r.id,version:r.version,attestation:attest()}));
 return f.run(t=>confirmBatch(t,as,batchId,LOOKUP_KEY,{idempotencyKey:key,rows}));
}
export type {Principal};
