import {randomUUID,createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {scopedCase,P2Error,type Staff} from './service';
import {requestP2Pdf,type P2PdfInput} from '../pdf/p2';
type Cached={id:string;caseId:string;documentId:string;sessionId:string;hash:string;bytes:Buffer;expiresAt:Date};
// Process memory is ephemeral, never FileStore/disk. Bound capacity and TTL; no assets survive process exit.
const cache=new Map<string,Cached>();
function purge(){const now=Date.now();for(const [id,p] of cache)if(p.expiresAt.getTime()<=now)cache.delete(id);while(cache.size>=64)cache.delete(cache.keys().next().value!);}
async function log(db:Queryable,user:Staff,p:Cached,intent:string){await db.query('INSERT INTO p2_document_access(case_id,document_id,session_id,actor_id,intent,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[p.caseId,p.documentId,user.sessionId,user.id,intent,p.hash]);}
export async function createDocumentPreview(db:Queryable,user:Staff,caseId:string,documentId:string,render:(s:P2PdfInput)=>Promise<Buffer>=requestP2Pdf){
 const c=await scopedCase(db,user,caseId,'document.request.read','read');if(!user.sessionId)throw new P2Error('STAFF_SESSION_REQUIRED',401);
 const doc=(await db.query<{id:string;kind:'REQUEST'|'CONSENT';template_version:P2PdfInput['templateVersion'];content_hash:string;payload:Record<string,unknown>;round_id:string}>('SELECT * FROM p2_document_revision WHERE id=$1 AND case_id=$2',[documentId,caseId])).rows[0];if(!doc)throw new P2Error('DOCUMENT_NOT_FOUND',404);
 const finals=(await db.query<{payload:Record<string,unknown>;content_hash:string}>('SELECT payload,content_hash FROM p2_final_consent WHERE document_id=$1',[documentId])).rows;
 const signatures=await db.query('SELECT id FROM p2_consent_signature WHERE document_id=$1',[documentId]);
 if(finals.length>1||signatures.rows.length>1)throw new P2Error('AMBIGUOUS_CONSENT_EVIDENCE_REQUIRES_GOVERNANCE',409);
 const final=finals[0];
 const bytes=await render({id:doc.id,kind:doc.kind,templateVersion:doc.template_version,hash:final?.content_hash??doc.content_hash,payload:doc.payload,finalConsent:final?.payload??null,generatedAt:new Date().toISOString()});if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||bytes.length>5*1024*1024)throw new P2Error('INVALID_PDF');
 // Recheck session/scope after the renderer roundtrip as signing may have frozen staff meanwhile.
 await scopedCase(db,user,c.id,'document.request.read','read');purge();const ttl=Number(process.env.P2_PREVIEW_TTL_SECONDS??900);if(!Number.isFinite(ttl)||ttl<30||ttl>900)throw new P2Error('PREVIEW_TTL_INVALID');
 const p:Cached={id:randomUUID(),caseId,documentId,sessionId:user.sessionId,hash:createHash('sha256').update(bytes).digest('hex'),bytes,expiresAt:new Date(Date.now()+ttl*1000)};cache.set(p.id,p);setTimeout(()=>cache.delete(p.id),ttl*1000).unref();await log(db,user,p,'preview');return {id:p.id,hash:p.hash,expiresAt:p.expiresAt};
}
export function clearDocumentSession(sessionId:string){for(const [id,p] of cache)if(p.sessionId===sessionId)cache.delete(id);}
export async function readDocumentPreview(db:Queryable,user:Staff,id:string,intent:'preview'|'download'|'print'){
 purge();const p=cache.get(id);if(!p||p.sessionId!==user.sessionId)throw new P2Error('PREVIEW_EXPIRED_OR_UNAUTHORIZED',403);await scopedCase(db,user,p.caseId,'document.request.read','read');await log(db,user,p,intent);return {bytes:p.bytes,hash:p.hash,documentId:p.documentId};
}
