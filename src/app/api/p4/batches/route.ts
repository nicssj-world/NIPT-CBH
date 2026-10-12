import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as batch from "../../../../../packages/lab/batch";
import {protect} from "../../../../server/http";
import {p4Error,p4Mutation,noStore} from "../../../../server/p4";
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await withTransaction(db=>batch.listBatches(db,user)),{headers:noStore});}catch(e){return p4Error(e);}}
export async function POST(request:NextRequest){return p4Mutation(request,"P4_BATCH_CREATE",async user=>NextResponse.json(await withTransaction(db=>batch.createBatch(db,user)),{headers:noStore}));}
