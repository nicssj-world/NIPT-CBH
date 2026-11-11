import {NextResponse,type NextRequest} from 'next/server';
import {pool,withTransaction} from '../../../../../packages/db/connection';
import {readSyncState,syncHolidays} from '../../../../../packages/calendar/holiday-sync';
import {protect,apiError} from '../../../../server/http';

const noStore={'Cache-Control':'no-store'};
/** Holidays of last, this and next year, and the outcome of the latest sync. No patient data. */
export async function GET(request:NextRequest){
 try{await protect(request,'settings.read');
  const db=pool();
  const rows=(await db.query<{day:string;name:string}>("SELECT day::text,name FROM business_holiday WHERE day BETWEEN make_date(extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int-1,1,1) AND make_date(extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int+1,12,31) ORDER BY day")).rows;
  return NextResponse.json({holidays:rows,state:await readSyncState(db)},{headers:noStore});
 }catch(e){return apiError(e);}
}
/** "ซิงก์วันหยุดตอนนี้": the administrator downloads the calendar now (one request, 15 s limit). */
export async function POST(request:NextRequest){
 try{const user=await protect(request,'settings.general.change',{},'write');
  const result=await syncHolidays(work=>withTransaction(work),{trigger:'MANUAL',actorId:user.id});
  return NextResponse.json({...result,state:await readSyncState(pool())},{headers:noStore});
 }catch(e){return apiError(e);}
}
