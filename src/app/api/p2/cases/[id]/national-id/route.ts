import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {caseNationalId} from '../../../../../../../packages/p2/service';
import {protect} from '../../../../../../server/http';
import {p2Error,noStore} from '../../../../../../server/p2/http';
import {resultStore} from '../../../../../../server/p5';

/** The case's national ID for the requisition summary: the ANC request's value, else the one carried by the PET. Read-only, no-store, PHI-access-logged. */
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
 try{const user=await protect(request),{id}=await context.params;return NextResponse.json(await withTransaction(db=>caseNationalId(db,resultStore(),user,id)),{headers:noStore});}
 catch(e){return p2Error(e);}
}
