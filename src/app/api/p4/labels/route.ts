import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as intake from "../../../../../packages/lab/intake";
import {readJson} from "../../../../server/http";
import {p4Mutation,noStore,putLabelSheet} from "../../../../server/p4";
// Preview and print return a session-bound sheet id; the browser loads the exact HTML from /api/p4/label-sheet/[id].
export async function POST(request:NextRequest){return p4Mutation(request,"P4_LABELS",async user=>{const {action,...data}=await readJson(request);
 if(!user.sessionId)throw new Error("UNAUTHENTICATED");
 if(action==="preview"){const r=await withTransaction(db=>intake.previewLabels(db,user,data));return NextResponse.json({sheetId:putLabelSheet(r.html,user.sessionId),reprint:r.reprint,stickers:r.stickers,halves:r.halves,codes:r.codes},{headers:noStore});}
 if(action==="print"){const r=await withTransaction(db=>intake.printLabels(db,user,data));return NextResponse.json({sheetId:putLabelSheet(r.html,user.sessionId),jobId:r.jobId,kind:r.kind},{headers:noStore});}
 throw new Error("ACTION_NOT_ALLOWED");});}
