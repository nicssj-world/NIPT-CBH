import {authorize} from '../security/policy';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {uuid,LabError,need,audit,type Staff} from './core';
import {batchDetail,type PlacementPayload} from './batch';
import {workbookWorkspace,type WorkbookDeps} from '../workbook/service';
import {calculateOwnerPooling,exportOwnerPoolingCsv,ownerDilution,poolConcentrationOutOfRange,type PhysicalQc} from '../pooling/owner-master';
import {exportOwnerNifty,petDisplayName,type VendorRow} from '../sequencing/owner-export';
import {readPet} from '../inbound/process';
import type {RequestDraft} from '../p2/schema';
import {digest} from '../pooling/calculation';
import {niftyPatientEligible} from '../sequencing/owner-task-import';

/** Pool volumes depend on placement and QC, not unrelated Seq/QC2 form edits. */
export function qcSourceHash(slots:PlacementPayload['slots'],values:Record<string,unknown>){
 return digest({slots,values:Object.fromEntries(Object.entries(values).filter(([k])=>/^slot\.\d+\.libraryQc$|^qc\.[123]\./.test(k)).sort(([a],[b])=>a.localeCompare(b)))});
}

export async function benchSource(db:Queryable,user:Staff,batchId:string,deps:WorkbookDeps){
 const workbook=await workbookWorkspace(db,user,batchId,deps),batch=await batchDetail(db,user,batchId);
 const placements=(await db.query<{payload:PlacementPayload}>(`SELECT DISTINCT ON(t.sheet_number) p.payload FROM lab_placement_snapshot p JOIN lab_task_sheet t ON t.id=p.sheet_id WHERE t.batch_id=$1 ORDER BY t.sheet_number,p.revision DESC`,[batchId])).rows;
 const slots=placements.flatMap(p=>p.payload.slots).sort((a,b)=>a.slot-b.slot);
 return {workbook,batch,slots};
}
export async function benchWorkspace(db:Queryable,user:Staff,batchId:string,deps:WorkbookDeps){
 const s=await benchSource(db,user,uuid.parse(batchId),deps);
 const actualPooling=(await db.query<{id:string;members:{slot:number;pooled:boolean;actualVolume?:number;reason?:string}[];note:string;current:boolean}>(`SELECT id,members,note,lab_actual_pooling_current(id) current FROM lab_actual_pooling WHERE batch_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1`,[batchId])).rows[0]??null;
 return {canNoCall:authorize(user,'attempt.noCall'),canRepeat:authorize(user,'repeat.order'),canRedraw:authorize(user,'redraw.order'),batchId,runLabel:s.batch.batch.runLabel,version:s.workbook.version,revision:s.workbook.draft?.revision??0,values:s.workbook.values,automaticKeys:Object.keys(s.workbook.automaticValues),sourceStale:s.workbook.sourceStale,finalized:s.slots.length===48,
  actualPooling,
  slots:s.batch.slots.map(slot=>({attemptId:slot.assignment?.attemptId??null,caseId:slot.assignment?.caseId??null,roundId:slot.assignment?.roundId??null,attemptState:slot.assignment?.attemptState??null,outcomeStatus:slot.assignment?.outcomeStatus??null,overallOrdinal:slot.assignment?.overallOrdinal??null,exceptional:slot.assignment?.exceptional??false,slot:slot.slot,sheet:slot.sheet,kind:slot.controlLabel??(slot.assignment?'PATIENT':'EMPTY'),sampleId:slot.assignment?.printedSampleId??slot.controlCode??'',hisLn:slot.assignment?.hisLn??null,hn:slot.assignment?.hn??null,roundNumber:slot.assignment?.roundNumber??null})),
  seqFields:s.workbook.matrix.bindings.filter(f=>f.sheet==='Seq Task-G50').map(f=>({key:f.key,type:f.dataType,label:s.workbook.matrix.cells.find(c=>c.sheet===f.sheet&&c.cell===f.cell)?.text.replaceAll('☐','').trim()||f.source})),
  exports:(await db.query<{id:string;kind:string;source_sha256:string}>('SELECT id,kind,source_sha256,file_sha256,created_at,workbook_revision_id FROM lab_bench_export WHERE batch_id=$1 ORDER BY created_at DESC',[batchId])).rows.map(e=>({...e,current:e.kind==='POOL_CSV'?e.source_sha256===qcSourceHash(s.slots,s.workbook.values)&&!s.workbook.sourceStale:null}))};
}
export async function savedSource(db:Queryable,user:Staff,batchId:string,deps:WorkbookDeps){
 const s=await benchSource(db,user,batchId,deps);need(user,'qc.record');
 if(!s.workbook.draft||s.workbook.sourceStale)throw new LabError('TASK_CURRENT_DRAFT_REQUIRED',409);
 if(s.slots.length!==48||s.slots.some((slot,i)=>slot.slot!==i+1))throw new LabError('ALL_TASK_PLACEMENTS_REQUIRED',409);
 return s;
}
export async function benchPooling(db:Queryable,user:Staff,batchId:string,deps:WorkbookDeps){
 const s=await savedSource(db,user,batchId,deps),values=s.workbook.values;
 for(let strip=1;strip<=3;strip++)for(const standard of ['standard1','standard2','standard2Concentration'])if(typeof values[`qc.${strip}.${standard}`]!=='number')throw new LabError('QC_NINE_STANDARDS_REQUIRED',422);
 const rows:PhysicalQc[]=s.slots.map(slot=>({slot:slot.slot,sampleId:slot.printedSampleId??slot.printedControlId??'',kind:slot.control==='positive'?'PC':slot.control==='negative'?'NC':slot.control==='blank'?'BLANK':slot.attemptId?'PATIENT':'EMPTY',concentration:typeof values[`slot.${slot.slot}.libraryQc`]==='number'?String(values[`slot.${slot.slot}.libraryQc`]):null}));
 let calculation:ReturnType<typeof calculateOwnerPooling>;try{calculation=calculateOwnerPooling(deps.master,rows);}catch(e){throw new LabError(e instanceof Error?e.message:'POOL_CALCULATION_INVALID',422);}
 const concentration=values['pool.concentration'],c1=values['pool.dilutionC1'];
 let dilution:ReturnType<typeof ownerDilution>|null=null,dilutionError:string|null=null;
 if(typeof c1==='number')try{dilution=ownerDilution(deps.master,String(c1));}catch(e){dilutionError=e instanceof Error?e.message:'DILUTION_INVALID';}
 return {revision:s.workbook.draft!.revision,sourceSha256:qcSourceHash(s.slots,values),calculation,poolConcentration:typeof concentration==='number'?String(concentration):null,outOfRange:typeof concentration==='number'?poolConcentrationOutOfRange(String(concentration)):false,dilution,dilutionError};
}
export async function benchExport(db:Queryable,user:Staff,input:unknown,deps:WorkbookDeps){
 const d=z.strictObject({batchId:uuid,revision:z.number().int().positive(),kind:z.enum(['POOL_CSV','NIFTY_XLSX'])}).parse(input),s=await savedSource(db,user,d.batchId,deps);
 if(s.workbook.draft!.revision!==d.revision)throw new LabError('TASK_DRAFT_VERSION_CONFLICT',409);
 let bytes:Buffer,mapping:unknown=[],sourceHash:string;
 if(d.kind==='POOL_CSV'){
  const template=process.env.NIPT_POOL_CSV_TEMPLATE;if(!template)throw new LabError('POOL_CSV_TEMPLATE_REQUIRED',409);
  const pool=await benchPooling(db,user,d.batchId,deps);bytes=exportOwnerPoolingCsv(await readFile(template),pool.calculation);sourceHash=pool.sourceSha256;
 }else{
  need(user,'handoff.create');
  const template=process.env.NIPT_NIFTY_XLSX_TEMPLATE;if(!template)throw new LabError('NIFTY_TEMPLATE_REQUIRED',409);
  const rows:VendorRow[]=[];
  for(const slot of s.slots){
   if(slot.control==='blank'||!slot.control&&!slot.attemptId)continue;
   if(slot.control){rows.push({slot:slot.control==='positive'?1:25,kind:slot.control==='positive'?'PC':'NC',sampleId:slot.printedControlId!});continue;}
   const lineage=(await db.query<{attempt_number:number;overall_ordinal:number;repeat_order_id:string|null;previous_seq:boolean}>(`SELECT a.attempt_number,a.overall_ordinal,a.repeat_order_id,EXISTS(
    SELECT 1 FROM analytical_attempt prior JOIN lab_slot_assignment p ON p.attempt_id=prior.id
    WHERE prior.round_id=a.round_id AND p.batch_id<>$2 AND (
     EXISTS(SELECT 1 FROM task_workbook_revision w WHERE w.batch_id=p.batch_id AND NULLIF(btrim(w.values->>'seq.date'),'') IS NOT NULL AND NULLIF(btrim(w.values->>'seq.operator'),'') IS NOT NULL)
     OR EXISTS(SELECT 1 FROM p4c_sequencing_attempt q JOIN p4c_dnb_attempt d ON d.id=q.dnb_id WHERE d.batch_id=p.batch_id)
    )) previous_seq FROM analytical_attempt a WHERE a.id=$1`,[slot.attemptId,d.batchId])).rows[0];
   if(!lineage||!niftyPatientEligible({attemptNumber:lineage.attempt_number,repeatOrderId:lineage.repeat_order_id,previousSeqOnSameRound:lineage.previous_seq}))throw new LabError('VENDOR_ATTEMPT_PROVENANCE_REQUIRED',409,{slot:slot.slot});
   const source=(await db.query<{ln:string;hn:string;sha256:string;filename:string;draft:RequestDraft|null;doctor:string|null;edd:string|null;pregnancy:'Singleton'|'Twins'|null}>(`SELECT l.ln,i.hn,f.sha256,f.filename,w.draft,COALESCE(d.name,ld.name) doctor,COALESCE(w.draft#>>'{pregnancy,edd}',lr.edd::text) edd,COALESCE(w.draft#>>'{pregnancy,type}',lr.pregnancy) pregnancy
    FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id JOIN p2_case_identity i ON i.case_id=r.case_id JOIN his_order o ON o.round_id=r.id JOIN his_inbound_file f ON f.id=o.inbound_file_id
    LEFT JOIN p2_workspace w ON w.round_id=r.id LEFT JOIN p2_doctor_version d ON d.id=(w.draft#>>'{ordering,doctorVersionId}')::uuid
    LEFT JOIN LATERAL (SELECT * FROM lab_operational_registration x WHERE x.case_id=r.case_id ORDER BY (x.round_id=r.id) DESC,x.created_at DESC LIMIT 1) lr ON true LEFT JOIN p2_doctor_version ld ON ld.id=lr.doctor_version_id WHERE r.id=$1 AND r.case_id=$2`,[slot.roundId,slot.caseId])).rows[0];
   if(!source||!source.edd||!['Singleton','Twins'].includes(source.pregnancy??''))throw new LabError('VENDOR_REQUEST_PROVENANCE_REQUIRED',409,{slot:slot.slot});
   const pet=await readPet(deps.store,source);
   if(pet.ln!==source.ln||pet.hn!==source.hn||source.draft?.patient.syntheticName&&petDisplayName(source.draft?.patient.syntheticName)!==petDisplayName(pet.name)||source.draft?.patient.dob&&source.draft?.patient.dob!==pet.dob.slice(0,10))throw new LabError('VENDOR_IDENTITY_MISMATCH',409,{slot:slot.slot});
   rows.push({attemptId:slot.attemptId!,roundId:slot.roundId!,caseId:slot.caseId!,overallOrdinal:lineage.overall_ordinal,slot:slot.slot,kind:'PATIENT',sampleId:slot.printedSampleId!,ln:pet.ln,hn:pet.hn,name:pet.name,identity:pet.identity,dob:pet.dob.slice(0,10),collectionAt:pet.specimenAt,receivedAt:pet.receivedAt,edd:source.edd,pregnancy:source.pregnancy as 'Singleton'|'Twins',doctor:source.doctor??''});
  }
  const exported=exportOwnerNifty(await readFile(template),rows);bytes=exported.bytes;mapping=exported.mapping;sourceHash=digest({revision:s.workbook.draft!.id,rows});
  await recordPhiAccess(db,user.id,s.slots.flatMap(slot=>slot.caseId?[slot.caseId]:[]),'CASE_DETAIL_VIEW');
 }
 const fileHash=await deps.store.put(bytes),row=(await db.query<{id:string}>('INSERT INTO lab_bench_export(batch_id,workbook_revision_id,kind,source_sha256,file_sha256,mapping,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[d.batchId,s.workbook.draft!.id,d.kind,sourceHash,fileHash,JSON.stringify(mapping),user.id])).rows[0];
 await audit(db,user,'LAB_BENCH_EXPORTED','lab_bench_export',row.id,{outcome:d.kind,version:d.revision});
 return {id:row.id,bytes,sha256:fileHash,kind:d.kind};
}
