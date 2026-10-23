import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {protect} from '../../../../../../server/http';
import {p5hError,noStore} from '../../../../../../server/p5h';
import {z} from 'zod';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await protect(request,'history.read',{},'read');const {id}=await params;return NextResponse.json(await withTransaction(async db=>(await db.query(`SELECT r.version,r.created_at,r.reason,u.display_name actor,r.data#>>'{pdf,fileId}' pdf_file_id,d.batch_id FROM historical_draft_revision r JOIN historical_draft d ON d.id=r.draft_id JOIN app_user u ON u.id=r.actor_id WHERE r.draft_id=$1 ORDER BY r.version DESC LIMIT 100`,[z.uuid().parse(id)])).rows),{headers:noStore});}catch(e){return p5hError(e);}}
