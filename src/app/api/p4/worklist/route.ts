import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as intake from "../../../../../packages/lab/intake";
import {protect,readJson} from "../../../../server/http";
import {p4Error,p4Mutation,noStore} from "../../../../server/p4";
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json(await withTransaction(db=>intake.labWorklist(db,user)),{headers:noStore});}catch(e){return p4Error(e);}}
const actions:Record<string,(db:import("../../../../../packages/db/connection").Queryable,user:import("../../../../../packages/lab/core").Staff,input:unknown)=>Promise<unknown>>={acceptSpecimen:intake.acceptSpecimen,receiveRedraw:intake.receiveRedraw,recoverLnHalos:intake.recoverLnHalos,orderRedraw:intake.orderRedraw,cancelRedraw:intake.cancelRedraw,orderRepeat:intake.orderRepeat,setUrgent:intake.setUrgent,setHold:intake.setHold};
export async function POST(request:NextRequest){return p4Mutation(request,"P4_WORKLIST",async user=>{const {action,...data}=await readJson(request);if(typeof action!=="string"||!(action in actions))throw new Error("ACTION_NOT_ALLOWED");return NextResponse.json(await withTransaction(db=>actions[action](db,user,data)),{headers:noStore});});}
