import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {dismissHalosRow} from "../../../../../../../packages/readygen/halos-import";
import {readJson} from "../../../../../../server/http";
import {noStore} from "../../../../../../server/p5";
import {task3Mutation} from "../../../../../../server/task3";
/** Hide a HALOS result row that will never be reported (reason required; refused when its report is already Final). */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return task3Mutation(request,"TASK3_HALOS_ROW_DISMISS",async user=>{const {id}=await params,data=await readJson(request);
 await withTransaction(db=>dismissHalosRow(db,user,{reason:data.reason,rowId:id}));return NextResponse.json({outcome:"DISMISSED"},{headers:noStore});});}
