import type {Queryable} from "../../packages/db/connection";
import {authorize} from "../../packages/security/policy";
import {batchDetail} from "../../packages/lab/batch";
import {observationsView,dispositionsView,documentCopies,sheetCompleteness,qcCompleteness} from "../../packages/lab/records";
import {FIELDS} from "../../packages/lab/fields";
import {QC1_CRITERIA} from "../../packages/lab/qc";
import {pendingPolicy,DISPOSITION_REASONS,type Staff} from "../../packages/lab/core";

/** Everything the F1 batch workspace renders, computed server-side; buttons follow server authorization, not role names. */
export async function batchWorkspace(db:Queryable,user:Staff,id:string){
 const detail=await batchDetail(db,user,id);
 const [observations,dispositions,copies,{policy}]=await Promise.all([observationsView(db,user,id),dispositionsView(db,user,id),documentCopies(db,user,id),pendingPolicy(db)]);
 const completeness=await Promise.all([1,2,3].map(async n=>{const c=await sheetCompleteness(db,id,n);return {sheet:n,ready:c.ready,missingFields:c.missingFields,slots:c.slots,open:c.open};}));
 const qc=await qcCompleteness(db,id);
 const can=(action:string,op:"write"|"propose"|"approve"|"read"="write")=>authorize(user,action,{actorId:"another-person"},op);
 return {...detail,observations,dispositions,copies,completeness,policy,
  qc:{ready:qc.ready,rows:qc.rows.map(r=>({slot:r.slot,status:r.status,decision:r.decision,observationId:r.obs?.id??null,attemptId:r.x?.attemptId??null})),standards:qc.standards.map(s=>s?{id:s.id,status:s.status}:null),operator:qc.operator?{id:qc.operator.id,status:qc.operator.status}:null},
  fields:FIELDS.map(f=>({id:f.id,item:f.item,form:f.form,scope:f.scope,kind:f.kind,cls:f.cls,label:f.label,source:f.source,sheets:[1,2,3].filter(n=>f.required(n))})),
  criteria:QC1_CRITERIA,dispositionReasons:DISPOSITION_REASONS,
  allowed:{draft:can("batch.draft"),assign:can("batch.assign"),finalize:can("batch.finalize"),amend:can("batch.amend"),unlock:can("batch.unlock"),execute:can("execution.record"),transcribe:can("observation.transcribe"),
   verify:can("observation.verify","approve")||can("observation.verify"),qcRecord:can("qc.record"),qcAccept:can("qc.accept"),dispositionPropose:can("slot.disposition","propose"),dispositionConfirm:can("slot.disposition","approve"),
   recall:can("document.recall"),obsoletePrint:can("document.obsolete.print"),labels:can("label.print")}};
}
