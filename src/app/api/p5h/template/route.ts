import {NextResponse,type NextRequest} from "next/server";
import {templateCsv} from "../../../../../packages/historical/table";
import {protect} from "../../../../server/http";
import {p5hError} from "../../../../server/p5h";
/** Empty import template (header row only). */
export async function GET(request:NextRequest){try{await protect(request,"history.read",{},"read");return new NextResponse(templateCsv(),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"historical-import-template.csv\"","Cache-Control":"private, no-store"}});}catch(e){return p5hError(e);}}
