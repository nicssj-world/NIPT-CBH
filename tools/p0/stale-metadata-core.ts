// Detection logic for the read-only stale-metadata inventory (Plan Rev 3.4 §5.1 step 6). SELECT statements only.
type Q={query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}>};
const TASK_META=/^task\.(\d+)\.(date|run|operator|extractionLotExp|libraryLotExp)$/;
const OWNER:Record<string,string>={operator:'F2-05',extractionLotExp:'F2-13',libraryLotExp:'F2-14'};
/** Planned fields that make the source emit the cell (a lot/expiry cell is source-supplied by the lot or the expiry). */
const PLAN:Record<string,string[]>={operator:['operator'],extractionLotExp:['extractionLot','extractionExpiry'],libraryLotExp:['libraryLot','libraryExpiry']};
export type StaleFinding={batchId:string;revision:number;key:string;reason:'TASK_NOT_FINALIZED_AT_REVISION'|'VALUE_NOT_FROM_LAB_SOURCE'};
/** Revisions holding Task metadata that the Lab source did not supply, and native controlled documents issued from them. */
export async function staleMetadataInventory(db:Q){
 const revisions=(await db.query<{id:string;batch_id:string;revision:number;values:Record<string,unknown>;created_at:Date}>('SELECT id,batch_id,revision,values,created_at FROM task_workbook_revision ORDER BY batch_id,revision')).rows;
 const findings:StaleFinding[]=[];
 for(const r of revisions){
  const snaps=new Map((await db.query<{sheet_number:number;payload:{plan:Record<string,string|null>}}>(`SELECT DISTINCT ON(t.sheet_number) t.sheet_number,p.payload FROM lab_placement_snapshot p JOIN lab_task_sheet t ON t.id=p.sheet_id WHERE p.batch_id=$1 AND p.created_at<=$2 ORDER BY t.sheet_number,p.revision DESC`,[r.batch_id,r.created_at])).rows.map(s=>[s.sheet_number,s.payload.plan]));
  const obs=new Set((await db.query<{k:string}>(`SELECT DISTINCT t.sheet_number||':'||o.field_id k FROM lab_observation o JOIN lab_task_sheet t ON t.id=o.sheet_id WHERE o.batch_id=$1 AND o.recorded_at<=$2`,[r.batch_id,r.created_at])).rows.map(x=>x.k));
  for(const [key,value] of Object.entries(r.values??{})){
   const m=TASK_META.exec(key);if(!m||value===''||value===null)continue;
   const sheet=Number(m[1]),field=m[2],plan=snaps.get(sheet);
   if(!plan){findings.push({batchId:r.batch_id,revision:r.revision,key,reason:'TASK_NOT_FINALIZED_AT_REVISION'});continue;}
   if(field in PLAN&&!PLAN[field].some(k=>plan[k])&&!obs.has(`${sheet}:${OWNER[field]}`))findings.push({batchId:r.batch_id,revision:r.revision,key,reason:'VALUE_NOT_FROM_LAB_SOURCE'});
  }
 }
 const affected=[...new Set(findings.map(f=>`${f.batchId}:${f.revision}`))];
 const documents=affected.length?(await db.query<{id:string;doc_code:string;form:string;kind:string;revision:number;status:string;workbook_revision:number}>(`SELECT d.id,d.doc_code,d.form,d.kind,d.revision,d.status,(d.snapshot->>'workbookRevision')::int workbook_revision FROM lab_document d WHERE d.snapshot->>'nativeMaster'='true' AND (d.batch_id::text||':'||(d.snapshot->>'workbookRevision'))=ANY($1::text[])`,[affected])).rows:[];
 return {revisionsScanned:revisions.length,findings,affectedIssuedDocuments:documents};
}
