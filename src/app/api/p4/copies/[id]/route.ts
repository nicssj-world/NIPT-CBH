import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import * as rec from "../../../../../../packages/lab/records";
import {readJson} from "../../../../../server/http";
import {p4Mutation,noStore} from "../../../../../server/p4";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return p4Mutation(request,"P4_COPY_RECALL",async user=>{const {id}=await params;const input={...await readJson(request),copyId:id};return NextResponse.json(await withTransaction(db=>rec.recallCopy(db,user,input)),{headers:noStore});});}
