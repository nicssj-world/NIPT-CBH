import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,audit,LabError,type Staff} from '../lab/core';
import type {FileStore} from '../storage';
import {sha256} from '../storage';
import {hashOf} from './hash';
import type {DraftData,RowIssue} from './bulk';
type Source={id:string;version:number;state:string;contributor_ids:string[];data:DraftData;issues:RowIssue[];pdf_file_id:string|null};
async function source(db:Queryable,id:string){
 const d=(await db.query<Source>('SELECT id,version,state,contributor_ids,data,issues,pdf_file_id FROM historical_draft WHERE id=$1 FOR UPDATE',[uuid.parse(id)])).rows[0];
 if(!d)throw new LabError('NOT_FOUND',404);return d;
}
async function paperSnapshot(db:Queryable,id:string){return(await db.query("SELECT DISTINCT ON(stage) sequence::text,stage,performed FROM lab_manual_paper_stage WHERE draft_id=$1 ORDER BY stage,sequence DESC",[id])).rows;}
export async function manualReview(db:Queryable,user:Staff,draftId:string){
 await assertSession(db,user);need(user,'history.read','read');const d=await source(db,draftId);
 const review=(await db.query<{id:string;draft_version:number;pdf_file_id:string;pdf_sha256:string;paper_snapshot:unknown;recorded_at:Date}>('SELECT id,draft_version,pdf_file_id,pdf_sha256,paper_snapshot,recorded_at FROM lab_manual_result_review WHERE draft_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',[draftId])).rows[0]??null;
 const current=!!review&&!['Abandoned','Promoted'].includes(d.state)&&review.draft_version===d.version&&review.pdf_file_id===d.pdf_file_id&&review.pdf_sha256===d.data.pdf?.sha256&&hashOf(review.paper_snapshot)===hashOf(await paperSnapshot(db,draftId));
 return {review,current,version:d.version,canReview:user.roles.some(r=>r==='LAB_STAFF'||r==='LAB_CERTIFIER'||r==='APP_ADMIN'),workflow:'LAB_MANUAL_COMPLETE' as const,promotionSeparate:true};
}
const input=z.strictObject({draftId:uuid,version:z.number().int().positive(),lnMatchesOriginal:z.literal(true),pdfBindingMatchesOriginal:z.literal(true),identityMatchesOriginal:z.literal(true),identityIdentifiersChecked:z.array(z.enum(['HN','NAME','DOB','NATIONAL_ID'])).min(2).max(4).refine(a=>new Set(a).size>=2),finalPdfReviewed:z.literal(true)});
/** LAB-UAT-008: operator completion, separate from clinical review and P5H promotion. */
export async function reviewManual(db:Queryable,user:Staff,store:FileStore,raw:unknown){
 await assertSession(db,user);need(user,'history.draft');if(!user.roles.some(r=>r==='LAB_STAFF'||r==='LAB_CERTIFIER'||r==='APP_ADMIN'))throw new LabError('FORBIDDEN',403);
 const v=input.parse(raw),d=await source(db,v.draftId);
 if(d.version!==v.version)throw new LabError('STALE_VERSION',409);
 if(['Abandoned','Promoted'].includes(d.state)||d.issues.some(i=>i.severity==='ERROR')||!d.pdf_file_id||!d.data.pdf)throw new LabError('MANUAL_PDF_IDENTITY_REQUIRED',409);
 const pdf=(await db.query<{sha256:string;state:string;parsed:{ln:string|null;hn:string|null;name:string|null;dob:string|null}|null}>('SELECT sha256,state,parsed FROM historical_batch_file WHERE id=$1 AND batch_id=(SELECT batch_id FROM historical_draft WHERE id=$2)',[d.pdf_file_id,d.id])).rows[0];
 const p=pdf?.parsed,i=d.data.identifiers,hn=(s:string)=>s.replace(/^0+/,'');
 // Two independently comparable identifiers and the original report LN are mandatory.
 if(!p?.ln||p.ln!==d.data.ln||!p.hn||!i.hn||hn(p.hn)!==hn(i.hn)||!p.name||!i.name||p.name.trim().toLocaleUpperCase()!==i.name.trim().toLocaleUpperCase()||!v.identityIdentifiersChecked.includes('HN')||!v.identityIdentifiersChecked.includes('NAME')||pdf.state!=='Parsed'||pdf.sha256!==d.data.pdf.sha256)throw new LabError('MANUAL_PDF_IDENTITY_REQUIRED',409);
 if(sha256(await store.get(pdf.sha256))!==pdf.sha256)throw new LabError('MANUAL_PDF_HASH_MISMATCH',409);
 const {draftId,version,...attestation}=v;
 await db.query('INSERT INTO lab_manual_result_review(draft_id,draft_version,pdf_file_id,pdf_sha256,paper_snapshot,attestation,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[draftId,version,d.pdf_file_id,pdf.sha256,JSON.stringify(await paperSnapshot(db,draftId)),JSON.stringify(attestation),user.id]);
 await audit(db,user,'LAB_MANUAL_FINAL_PDF_REVIEWED','historical_draft',draftId,{reasonCode:'LAB_MANUAL_COMPLETE',outcome:'REVIEWED_ORIGINAL_NO_NEW_CERTIFICATION_OR_HIS'});
 return manualReview(db,user,draftId);
}
