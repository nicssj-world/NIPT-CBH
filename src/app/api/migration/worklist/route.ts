import {NextResponse,type NextRequest} from 'next/server';
import {protect} from '../../../../server/http';
import {p5Error,noStore} from '../../../../server/p5';
import {withTransaction} from '../../../../../packages/db/connection';
import {migrationWorklist} from '../../../../../packages/migration/worklist';
export async function GET(request:NextRequest){try{const user=await protect(request,'worksheet.read');return NextResponse.json(await withTransaction(db=>migrationWorklist(db,user)),{headers:noStore});}catch(e){return p5Error(e);}}
