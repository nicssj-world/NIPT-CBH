import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {listLabOperators} from "../../../../../packages/lab/operators";
import {protect} from "../../../../server/http";
import {p4Error,noStore} from "../../../../server/p4";
/** Lab operator choices (first name + Initial Name) for the operator fields. Read only. */
export async function GET(request:NextRequest){try{const user=await protect(request);return NextResponse.json({operators:await withTransaction(db=>listLabOperators(db,user))},{headers:noStore});}catch(e){return p4Error(e);}}
