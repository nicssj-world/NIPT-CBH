import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
export async function auditP2Denial(db:Queryable,actorId:string,operation:string,error:unknown){
 const code=error instanceof Error?error.message:'';
 if(code!=='FORBIDDEN'&&code!=='MAKER_CHECKER_REQUIRED')return;
 await appendAudit(db,{actorId,action:'P2_MUTATION_DENIED',resourceType:'P2_OPERATION',details:{reasonCode:operation,outcome:code,synthetic:true}});
}
