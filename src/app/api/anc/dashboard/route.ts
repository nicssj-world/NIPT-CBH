import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {dashboard} from '../../../../../packages/anc/service';
import {recordPhiAccess} from '../../../../../packages/db/phi-access';
import {protect} from '../../../../server/http';
import {noStore,p4Error} from '../../../../server/p4';

export async function GET(request:NextRequest){
 try{const user=await protect(request);const result=await withTransaction(async db=>{
  await db.query('SET TRANSACTION READ ONLY');
  return dashboard(db,user,Object.fromEntries(request.nextUrl.searchParams));
 });
 // A read-only clinical snapshot must still retain the registry PHI-access audit contract.
 // Audit failure prevents returning identifiers; no patient data is copied into the audit payload.
 if(result.queue.items.length)await withTransaction(db=>recordPhiAccess(db,user.id,result.queue.items.map(c=>c.id),'REGISTRY_VIEW'));
 return NextResponse.json(result,{headers:noStore});}catch(error){return p4Error(error);}
}
