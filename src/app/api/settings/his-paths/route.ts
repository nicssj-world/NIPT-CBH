import {NextResponse,type NextRequest} from "next/server";
import {protect,readJson} from "../../../../server/http";
import {settingsError} from "../../../../server/settings-errors";
import {pool,withTransaction} from "../../../../../packages/db/connection";
import {hisPathOverview,proposeHisPaths,applyHisPaths} from "../../../../../packages/settings/his-paths";
import {resultFolderSettingValid} from "../../../../../packages/results/folder";
import {simulatorRoot} from "../../../../../packages/integrations/scanner";
/** OWNER-LAB-055/059: HIS folder paths — overview (GET), test a change (propose), apply a tested change (apply). */
export async function GET(request:NextRequest){try{const user=await protect(request,"settings.read");return NextResponse.json(await hisPathOverview(pool(),user),{headers:{"Cache-Control":"no-store"}});}catch(e){return settingsError(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request,"settings.read"),input=await readJson(request);
 const result=await withTransaction<unknown>(async db=>{if(input.operation==="apply")return applyHisPaths(db,user,input);if(input.operation==="propose")return proposeHisPaths(db,user,input,path=>resultFolderSettingValid(simulatorRoot(),path));throw new Error("INVALID_OPERATION");});
 return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});}catch(e){return settingsError(e);}}
