import type {Queryable} from '../db/connection';
import type {Staff} from '../lab/core';
import {LabError} from '../lab/core';
import {MASTER_SHA256,SHEETS} from './master';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook,type WorkbookDeps} from './service';
import {poolDilutionReady} from './dilution';
import {digest} from '../pooling/calculation';

export type NativeIssueInput={batchId:string;form:'F2'|'F3'|'F4'|'F5';kind:'PRE_WORK'|'COMPLETED';sheetNumber?:number;poolId?:string;dnbId?:string;evidence:unknown};
export type NativeIssue={bytes:Buffer;snapshot:Record<string,unknown>;templateVersion:string};
export type NativeIssuePort=(db:Queryable,user:Staff,input:NativeIssueInput)=>Promise<NativeIssue>;
export function isNativeIssue(snapshot:unknown):snapshot is Record<string,unknown>&{nativeMaster:true} {
 return !!snapshot&&typeof snapshot==='object'&&(snapshot as Record<string,unknown>).nativeMaster===true;
}
/** Issue through the existing draft/export path, then freeze BOTH native artifacts under the controlled document. */
export async function issueNativeWorkbook(db:Queryable,user:Staff,input:NativeIssueInput,deps:WorkbookDeps):Promise<NativeIssue>{
 const workspace=await workbookWorkspace(db,user,input.batchId,deps);
 if(input.form==='F4'&&input.kind==='COMPLETED'&&!poolDilutionReady(workspace.values))throw new LabError('TASK_POOL_CONCENTRATION_REQUIRED',422);
 const sheet=input.form==='F2'?SHEETS[(input.sheetNumber??0)-1]:input.form==='F3'?SHEETS[3]:input.form==='F4'?SHEETS[4]:SHEETS[5];
 if(!sheet)throw new LabError('TASK_SHEET_REQUIRED',422);
 if(input.kind==='PRE_WORK'){
  const planKey=(key:string)=>/^slot\.\d+\.printedSampleId$/.test(key)||/^task\.\d+\.(?:date|run|operator|extractionLotExp|libraryLotExp)$/.test(key)||['qc.date','qc.operator','pool.date','pool.operator','pool.instrumentCsvFileStem','seq.date','seq.operator','seq.instrument','seq.barcodeType','seq.dnbId'].includes(key);
  const actuals=workspace.matrix.bindings.filter(b=>b.sheet===sheet&&!planKey(b.key)).filter(b=>{const v=workspace.values[b.key];return v!==undefined&&v!==null&&v!==false&&v!=='';});
  if(actuals.length)throw new LabError('TASK_PREWORK_ACTUALS_PRESENT',409,{keys:actuals.map(b=>b.key)});
 }
 const currentDnb=(await db.query<{id:string;pool_id:string}>('SELECT d.id,p.pool_id FROM p4c_dnb_attempt d JOIN p4b_pool_snapshot p ON p.id=d.pool_snapshot_id WHERE d.batch_id=$1 ORDER BY d.attempt_number DESC LIMIT 1',[input.batchId])).rows[0];
 if(input.dnbId&&currentDnb?.id!==input.dnbId)throw new LabError('TASK_CURRENT_DNB_REQUIRED',409);
 if(input.poolId){const pool=(await db.query<{id:string}>('SELECT id FROM p4b_pool_attempt WHERE batch_id=$1 ORDER BY attempt_number DESC LIMIT 1',[input.batchId])).rows[0];if(pool?.id!==input.poolId||currentDnb&&currentDnb.pool_id!==input.poolId)throw new LabError('TASK_CURRENT_POOL_REQUIRED',409);}
 const draft=await saveWorkbookDraft(db,user,{batchId:input.batchId,expectedVersion:workspace.version,expectedRevision:workspace.draft?.revision??0,values:workspace.values},deps);
 const xlsx=await exportWorkbook(db,user,{batchId:input.batchId,revision:draft.revision,format:'XLSX'},deps);
 const pdf=await exportWorkbook(db,user,{batchId:input.batchId,revision:draft.revision,format:'PDF',sheet},deps);
 return {bytes:pdf.bytes,templateVersion:MASTER_SHA256,snapshot:{nativeMaster:true,synthetic:false,form:input.form,kind:input.kind,sheet,masterSha256:MASTER_SHA256,batchId:input.batchId,poolId:input.poolId??null,dnbId:input.dnbId??null,workbookRevision:draft.revision,sourceSha256:draft.source_sha256,valuesSha256:digest(draft.values),xlsxExportId:xlsx.id,pdfExportId:pdf.id,xlsxSha256:xlsx.sha256,pdfSha256:pdf.sha256,evidence:input.evidence}};
}
