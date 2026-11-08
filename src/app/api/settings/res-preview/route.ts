import {NextResponse,type NextRequest} from "next/server";
import {protect,readJson} from "../../../../server/http";
import {settingsError} from "../../../../server/settings-errors";
import {previewOperationalRes} from "../../../../../packages/p6/res";
/** Live example of the .res file for the HIS outbound profile form — fictional data only, nothing is stored or sent. */
export async function POST(request:NextRequest){try{await protect(request,"settings.read");const input=await readJson(request);
 const operator=typeof input.operatorHisId==="string"&&input.operatorHisId?input.operatorHisId:null;
 return NextResponse.json(previewOperationalRes({...(input.profile as object),syntheticOnly:false,style:input.resultStyle??"full"},operator),{headers:{"Cache-Control":"no-store"}});}
 catch(e){if(e instanceof Error&&e.name==="ZodError")return NextResponse.json({error:"ค่าที่กรอกยังไม่ถูกต้อง ตรวจรูปแบบแต่ละช่อง"},{status:422});return settingsError(e);}}
