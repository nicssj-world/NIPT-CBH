import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,caseVisible,type Staff} from '../lab/core';
import {worklistAll,type ReportDeps} from '../readygen/reports';
import {validationGateIssues,releaseReviewed} from './service';
import {readHisDeliveryStatuses,type HisDeliveryStatus} from './his-status';

// The results board read model: one place that says which tab every report is in.
//   ACTION = somebody must do something (a HALOS row on HOLD, or a PDF that is unlinked / in conflict / blocked / linked but not ready)
//   READY  = waiting to be sent to HIS (PendingCertification)
//   SENT   = CertifiedReleased
export type BoardRow={key:string;source:'HALOS'|'READYGEN';versionId:string|null;halosRowId:string|null;rowVersion:number|null;ln:string|null;hn:string|null;lnHalos:string|null;sampleId:string|null;template:string|null;
 abnormal:boolean;reviewed:boolean;reasons:{code:string;fixHref?:string}[];hisDelivery?:HisDeliveryStatus;pdfHref:string|null};
export type BoardTab='ACTION'|'READY'|'SENT';

/** Where a person fixes the cause of a reason code. Codes that need no data fix (e.g. UNLINKED) have no link. */
const PATIENT_DATA=/^(PET_|PREGNANCY_TYPE|CLINICAL_DATA|CONSENT_|HN_|COLLECTION_DATE|DOB|GA_|SAMPLEINFO_)/;
/** Reasons whose cause is the approved interpretation ruleset, product map or report template (exact codes; anything else gets no settings link). */
const RULESET_CODES=new Set(['INTERPRETATION_RULESET_NOT_APPROVED','RULESET_VERSION_MISMATCH','PRODUCT_UNRECOGNIZED','PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED','REPORT_MASTER_NOT_INSTALLED','NO_CALL_RENDERING_NOT_APPROVED','CLINICAL_RULES_NOT_APPROVED','NOTICE_TEMPLATE_NOT_APPROVED']);
export const fixHrefFor=(code:string,caseId:string|null):string|undefined=>
 RULESET_CODES.has(code)?'/settings?key=report_interpretation':caseId&&PATIENT_DATA.test(code)?`/cases/${caseId}`:undefined;

const schema=z.strictObject({tab:z.enum(['ACTION','READY','SENT']),q:z.string().trim().max(40).default(''),page:z.number().int().min(1).max(1000).default(1),pageSize:z.number().int().min(10).max(100).default(50),scope:z.enum(['PATIENT','EQA']).default('PATIENT')});
const OPEN_ACTION=['Unlinked','LinkConflict','ValidationBlocked','Linked'];
const TAB_OF:Record<string,BoardTab>={Unlinked:'ACTION',LinkConflict:'ACTION',ValidationBlocked:'ACTION',Linked:'ACTION',PendingCertification:'READY',CertifiedReleased:'SENT'};
const STATE_REASON:Record<string,string>={Unlinked:'UNLINKED',LinkConflict:'LINK_CONFLICT',ValidationBlocked:'VALIDATION_BLOCKED',Linked:'AWAITING_REVIEW'};

type V={id:string;state:string;row_version:number;case_id:string|null;origin:string;template_kind:string;abnormal:boolean;changed:Date;ln:string|null;ln_halos:string|null;hn:string|null;sample_id:string|null;unit_id:string|null;registration_origin:string|null;is_eqa:boolean};

/** Upper bounds of what one board call reads. `truncated` in the response says a bound cut rows off. Not part of the API input; tests pass smaller ones. */
export const BOARD_CAPS={halos:500,versions:1000};
export async function releaseQueue(db:Queryable,user:Staff,deps:ReportDeps,input:unknown,caps=BOARD_CAPS){
 await assertSession(db,user);need(user,'result.review','read');
 const d=schema.parse(input),q=d.q.replace(/[%_\\]/g,'');
 // Versions: not historical, kind RESULT. The visible set is the same for the three tabs so the counts add up.
 const fetched=(await db.query<V>(
  `SELECT v.id,v.state,v.row_version,v.case_id,v.origin,v.template_kind,COALESCE((v.parsed->>'abnormal')::boolean,false) abnormal,v.state_changed_at changed,
    COALESCE(l.ln,v.parsed->'identifiers'->'labNumber'->>'value') ln,n.ln_halos,COALESCE(ci.hn,v.parsed->'identifiers'->'hn'->>'value') hn,a.printed_sample_id sample_id,
    (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=v.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin,
    (v.case_id IS NOT NULL AND EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id=v.case_id)) is_eqa
   FROM result_report_version v LEFT JOIN specimen_round r ON r.id=v.round_id LEFT JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN specimen_lab_number n ON n.round_id=v.round_id
   LEFT JOIN p2_case_identity ci ON ci.case_id=v.case_id LEFT JOIN nipt_case c ON c.id=v.case_id LEFT JOIN analytical_attempt a ON a.id=v.attempt_id
   WHERE v.kind='RESULT' AND v.state=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id) AND (c.id IS NULL OR c.registration_origin<>'HISTORICAL')
    AND ($2='' OR COALESCE(l.ln,v.parsed->'identifiers'->'labNumber'->>'value') LIKE $2||'%' OR ltrim(COALESCE(ci.hn,v.parsed->'identifiers'->'hn'->>'value'),'0') LIKE ltrim($2,'0')||'%'
     OR a.printed_sample_id ILIKE '%'||$2||'%' OR n.ln_halos ILIKE '%'||$2||'%')
   ORDER BY v.state_changed_at DESC,v.id DESC LIMIT $3`,[[...OPEN_ACTION,'PendingCertification','CertifiedReleased'],q,caps.versions+1])).rows;
 const versionsTruncated=fetched.length>caps.versions,vs=fetched.slice(0,caps.versions).filter(r=>r.is_eqa===(d.scope==='EQA')&&(!r.case_id||caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin??'ANC'})));
 // HALOS rows still on HOLD with no report version yet (a row that already has a version is that version's row).
// A HALOS row on HOLD and a version of the same patient and round can both be listed (different keys): the row says the report cannot be made yet, the version is a PDF that exists. Both stay visible on purpose.
 // Computed once per call; counts, rows and total of every tab come from this one read, so counts[tab] always equals what paging that tab reaches.
 const w=await worklistAll(db,user,deps,{q:d.q,status:'HOLD',scope:d.scope},caps.halos),halos=w.rows.filter(r=>!r.versionId);
 const byTab=(t:BoardTab)=>vs.filter(v=>TAB_OF[v.state]===t);
 const counts={ACTION:halos.length+byTab('ACTION').length,READY:byTab('READY').length,SENT:byTab('SENT').length};

 type Item={at:number;halos?:typeof halos[number];v?:V};
 const items:Item[]=d.tab==='ACTION'
  ?[...halos.map(h=>({at:new Date(h.importedAt).getTime(),halos:h})),...byTab('ACTION').map(v=>({at:new Date(v.changed).getTime(),v}))].sort((a,b)=>b.at-a.at)
  :byTab(d.tab).map(v=>({at:new Date(v.changed).getTime(),v}));
 const total=items.length,start=(d.page-1)*d.pageSize,slice=items.slice(start,start+d.pageSize);
 const vids=slice.flatMap(i=>i.v?[i.v.id]:[]);
 const delivery=d.tab==='SENT'?await readHisDeliveryStatuses(db,vids):new Map<string,HisDeliveryStatus>();
 const rows:BoardRow[]=[];
 for(const i of slice){
  if(i.halos){const h=i.halos;
   rows.push({key:`halos:${h.rowId}`,source:'HALOS',versionId:null,halosRowId:h.rowId,rowVersion:null,ln:h.ln,hn:h.hn,lnHalos:h.lnHalos,sampleId:h.sampleId,template:h.template,abnormal:false,reviewed:false,
    reasons:h.holds.map(x=>{const href=fixHrefFor(x.code,h.caseId);return {code:x.code,...(href?{fixHref:href}:{})};}),pdfHref:null});continue;}
  const v=i.v!;let reasons:BoardRow['reasons']=[];
  if(d.tab==='ACTION'){
   const codes:string[]=[STATE_REASON[v.state]];
   if(v.state==='ValidationBlocked'||v.state==='Linked'){
    const g=await validationGateIssues(db,v.id).catch(()=>({failed:[] as string[],pending:[] as string[]}));
    // failed = 'RG-nn:REASON', pending = 'RG-nn:GOVERNANCE:REASON'; the reason is what a person can act on.
    const gate=[...g.failed.map(x=>x.split(':')[1]),...g.pending.map(x=>x.split(':')[2])].filter(Boolean);
    if(gate.length)codes.splice(0,codes.length,...gate);
   }
   reasons=[...new Set(codes)].map(code=>{const href=fixHrefFor(code,v.case_id);return {code,...(href?{fixHref:href}:{})};});
  }
  rows.push({key:`version:${v.id}`,source:v.origin==='INTERNAL_GENERATED'?'HALOS':'READYGEN',versionId:v.id,halosRowId:null,rowVersion:v.row_version,ln:v.ln,hn:v.hn,lnHalos:v.ln_halos,sampleId:v.sample_id,template:v.template_kind,
   abnormal:v.abnormal,reviewed:d.tab==='READY'||d.tab==='SENT'?await releaseReviewed(db,v.id):false,reasons,...(delivery.get(v.id)?{hisDelivery:delivery.get(v.id)}:{}),pdfHref:`/api/p5/results/${v.id}/file`});
 }
 return {rows,counts,truncated:w.truncated||versionsTruncated,page:{number:d.page,size:d.pageSize,total,totalPages:Math.max(1,Math.ceil(total/d.pageSize)),hasNext:start+d.pageSize<total}};
}
