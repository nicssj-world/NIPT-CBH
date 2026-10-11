import type {Queryable} from './connection';
import {appendAudit} from './audit';
// Caller supplies only cases already authorized for the response and owns the transaction.
// No LN, name, identity, clinical content, IP or raw request is persisted here.
export async function recordPhiAccess(db:Queryable,actorId:string,caseIds:readonly string[],purpose:'REGISTRY_VIEW'|'CASE_DETAIL_VIEW'){
 const ids=[...new Set(caseIds)];if(ids.length>200)throw Error('ACCESS_LOG_LIMIT');
 for(const id of ids)await db.query('INSERT INTO phi_access_log(actor_id,case_id,purpose) VALUES($1,$2,$3)',[actorId,id,purpose]);
 if(ids.length)await appendAudit(db,{actorId,action:'PHI_ACCESSED',resourceType:'PHI_ACCESS_LOG',details:{outcome:purpose,count:ids.length,synthetic:true}});
}
