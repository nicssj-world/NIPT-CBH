import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from './database';
import {tx,labUsers,syntheticCase,receiveS1} from './lab';
import {FileStore} from '../../packages/storage';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {confirmImport} from '../../packages/results/service';
import {syntheticReportPdf,type ReportSpec} from '../../tools/his-simulator/result-pdf';

/** Disposable PGlite + marked synthetic simulator root (simulator/results) + file store. Never touches data/ or a hospital path. */
export async function resultFixture(){
 const db=await testDatabase(),u=await labUsers(db),base=await mkdtemp(path.join(os.tmpdir(),'nipt-p5-')),root=path.join(base,'simulator');
 await mkdir(path.join(root,'results'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 const store=new FileStore(path.join(base,'files')),run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(db,fn);
 return {db:db as PGlite,u,store,root,base,run,close:async()=>{await db.close();await rm(base,{recursive:true,force:true});}};
}
export type ResultFixture=Awaited<ReturnType<typeof resultFixture>>;
let hnSeq=100;
const addDays=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
/** Received S1 with an immutable P2 HN and an electronic Request carrying DOB, EDD (GA 86 days on the collection date) and sex wish. */
export async function receivedCase(f:ResultFixture,o:{hn?:string;dob?:string;pregnancy?:'Singleton'|'Twins';fetalSex?:'Want'|'DoNotWant'|'Unspecified';collection?:string}={}){
 const hn=o.hn??`9900000${String(++hnSeq).padStart(5,'0')}`,collection=o.collection??'2026-10-10';
 const c=await f.run(t=>syntheticCase(t,{staff:f.u.staff,unit:f.u.unit},{pregnancy:o.pregnancy??'Singleton'}));
 await f.run(async t=>{
  await t.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[c.caseId,hn]);
  const payload={draft:{patient:{dob:o.dob??'1996-03-31'},pregnancy:{type:o.pregnancy??'Singleton',edd:addDays(collection,194),fetalSex:o.fetalSex??'DoNotWant'}}};
  await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.u.staff.id]);
  await receiveS1(t,c,new Date(Date.now()-3600000),collection);
 });
 const attempt=(await f.db.query<{id:string;lab_number:string}>('SELECT a.id,coalesce(a.printed_sample_id,n.ln_halos) lab_number FROM analytical_attempt a JOIN specimen_lab_number n ON n.round_id=a.round_id WHERE a.round_id=$1 AND a.attempt_number=1',[c.roundId])).rows[0];
 return {...c,hn,attemptId:attempt.id,labNumber:attempt.lab_number,collection};
}
export const pdfDate=(iso:string)=>{const d=new Date(iso+'T00:00:00Z');return `${String(d.getUTCDate()).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}-${d.getUTCFullYear()}`;};
/** Preview + confirm through the same intake and service code the browser path uses. Returns the new report version id. */
// Distinct reports carry distinct file names (as real BGI files do); name conflicts (A14) are exercised with explicit names.
export async function importReport(f:ResultFixture,spec:ReportSpec|Buffer,user:Principal=f.u.staff,name=`synthetic-${randomUUID().slice(0,8)}.pdf`){
 const bytes=Buffer.isBuffer(spec)?spec:syntheticReportPdf(spec);
 const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:user.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,id,{maxBytes:10*1024*1024,acceptZip:true}));
 const r=await f.run(t=>confirmImport(t,user,{intakeIds:[id]}));
 return {intakeId:id,versionId:r[0].versionId!,outcome:r[0].outcome};
}
export const rowVersion=async(f:ResultFixture,id:string)=>(await f.db.query<{row_version:number;state:string}>('SELECT row_version,state FROM result_report_version WHERE id=$1',[id])).rows[0];
