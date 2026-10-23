import {NextResponse,type NextRequest} from "next/server";
import {templateXlsx} from "../../../../../packages/historical/table";
import {protect} from "../../../../server/http";
import {p5hError} from "../../../../server/p5h";
/** Empty import template (header row only). */
export async function GET(request:NextRequest){try{await protect(request,"history.read",{},"read");return new NextResponse(new Uint8Array(templateXlsx()),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=\"historical-import-template.xlsx\"","Cache-Control":"private, no-store"}});}catch(e){return p5hError(e);}}
