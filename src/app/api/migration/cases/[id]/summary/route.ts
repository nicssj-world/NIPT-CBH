import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {readMigrationResultSummary} from '../../../../../../../packages/migration/result-summary';
import {protect} from '../../../../../../server/http';
import {p5Error,noStore} from '../../../../../../server/p5';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const user=await protect(request,'result.review'),{id}=await params;return NextResponse.json(await withTransaction(db=>readMigrationResultSummary(db,user,id)),{headers:noStore});}catch(e){return p5Error(e);}
}
