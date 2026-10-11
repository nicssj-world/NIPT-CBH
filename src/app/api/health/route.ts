import {NextResponse} from "next/server";
export async function GET(){return NextResponse.json({status:process.env.NIPT_MODE==="synthetic"?"ok":"blocked",mode:"synthetic-foundation",clinicalRelease:false},{status:process.env.NIPT_MODE==="synthetic"?200:503});}
