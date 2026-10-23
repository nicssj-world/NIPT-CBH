import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import * as svc from "../../../../../packages/run-photos/service";
import {protect,readJson} from "../../../../server/http";
import {photoMutation,photoError,noStore} from "../../../../server/run-photos";
export async function GET(request:NextRequest){try{const user=await protect(request,"settings.read",{},"read");return NextResponse.json(await withTransaction(db=>svc.storageOverview(db,user)),{headers:noStore});}catch(e){return photoError(e);}}
// test: checks a candidate path now, as the storing account. activate: re-tests that same path and switches new uploads to it.
export async function POST(request:NextRequest){return photoMutation(request,"RUN_PHOTO_STORAGE",async user=>{if(!user.roles.includes('APP_ADMIN'))throw new Error('FORBIDDEN');const {action,...data}=await readJson(request);
 if(action==="test")return NextResponse.json(await svc.testStoragePath(user,{path:data.path}),{headers:noStore});
 if(action!=="activate")throw new Error("ACTION_NOT_ALLOWED");
 const tested=await svc.testStoragePath(user,{path:data.path});
 if(!tested.receipt.ok)return NextResponse.json({code:"STORAGE_TEST_FAILED",error:"ทดสอบที่เก็บไม่ผ่าน จึงยังไม่เปลี่ยน Path — ดูรายการตรวจด้านล่าง",receipt:tested.receipt},{status:422,headers:noStore});
 return NextResponse.json({...await withTransaction(db=>svc.activateStoragePath(db,user,data,tested)),receipt:tested.receipt},{headers:noStore});});}
