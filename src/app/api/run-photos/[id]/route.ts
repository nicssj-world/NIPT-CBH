import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as svc from "../../../../../packages/run-photos/service";
import {readJson} from "../../../../server/http";
import {photoMutation,noStore} from "../../../../server/run-photos";
const actions={edit:svc.editPhoto,move:svc.movePhoto,retract:svc.retractPhoto};
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return photoMutation(request,"RUN_PHOTO_CHANGE",async user=>{const {id}=await params;const {action,...data}=await readJson(request);
 if(typeof action!=="string"||!(action in actions))throw new Error("ACTION_NOT_ALLOWED");
 return NextResponse.json(await withTransaction(db=>actions[action as keyof typeof actions](db,user,id,data)),{headers:noStore});});}
