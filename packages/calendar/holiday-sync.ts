import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {SETTINGS} from '../settings/catalog';
import {readActiveSettings} from '../settings/service';
import {parseHolidayIcs} from './ics';
import {bangkokDay,type HolidaySet,type TatPolicy} from './business-days';

/**
 * Holiday calendar sync (Owner 2026-11-11). One download returns the whole year (Google publishes the previous, current and next year), so
 * there is no polling: an administrator presses "ซิงก์วันหยุดตอนนี้" (yearly, or when a special holiday is announced), and the Worker syncs once
 * only when a year it needs is missing (current year; from October also the next year). A failed sync keeps the holidays already stored.
 */
export type TatSettings=TatPolicy&{holidayIcalUrl:string};
export type SyncState={lastAttemptAt:string|null;lastSuccessAt:string|null;lastErrorCode:string|null;holidayCount:number;years:number[];trigger:'MANUAL'|'WORKER'|null};
export type Fetcher=(url:string,init:{signal:AbortSignal;redirect:'follow';headers:Record<string,string>})=>Promise<{ok:boolean;status:number;url?:string;headers:{get(name:string):string|null};text():Promise<string>}>;

const MAX_BYTES=2_000_000,TIMEOUT_MS=15000;
/** The Worker retries a missing year at most this often (a failed download is never hammered). */
export const WORKER_RETRY_MS=20*3600000;

export async function tatSettings(db:Queryable):Promise<TatSettings>{
 const active=(await readActiveSettings(db)).tat;
 const parsed=SETTINGS.tat.schema.safeParse(active??SETTINGS.tat.default);
 return parsed.success?parsed.data:SETTINGS.tat.default;
}

/** Download and parse the calendar. Throws a stable code only (never the body or the URL, which may be a private iCal address). */
export async function downloadHolidays(url:string,fetcher:Fetcher=fetch as unknown as Fetcher){
 if(!/^https:\/\/[^\s]+$/.test(url))throw Error('ICAL_URL_HTTPS_REQUIRED');
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),TIMEOUT_MS);
 try{
  let response;
  try{response=await fetcher(url,{signal:control.signal,redirect:'follow',headers:{accept:'text/calendar'}});}
  catch(e){throw Error(e instanceof Error&&e.name==='AbortError'?'ICAL_TIMEOUT':'ICAL_UNREACHABLE');}
  if(response.url&&!response.url.startsWith('https://'))throw Error('ICAL_URL_HTTPS_REQUIRED');
  if(!response.ok)throw Error(`ICAL_HTTP_${response.status}`);
  if(Number(response.headers.get('content-length')??0)>MAX_BYTES)throw Error('ICAL_TOO_LARGE');
  const text=await response.text();
  if(text.length>MAX_BYTES)throw Error('ICAL_TOO_LARGE');
  const holidays=parseHolidayIcs(text);
  if(!holidays.length)throw Error('ICAL_NO_HOLIDAYS');
  return holidays;
 }finally{clearTimeout(timer);}
}

const codeOf=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]{1,64}$/.test(e.message)?e.message:'ICAL_SYNC_FAILED';

/** Replace the stored holidays of every year the calendar covers with what it says now; years it does not cover are kept. */
export async function storeHolidays(db:Queryable,holidays:{day:string;name:string}[],trigger:'MANUAL'|'WORKER',actorId:string|null){
 const years=[...new Set(holidays.map(h=>Number(h.day.slice(0,4))))].sort();
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['business-calendar']);
 await db.query('DELETE FROM business_holiday WHERE extract(year FROM day)::int=ANY($1::int[])',[years]);
 await db.query(`INSERT INTO business_holiday(day,name,source) SELECT d::date,n,'ICAL' FROM unnest($1::text[],$2::text[]) AS x(d,n)`,[holidays.map(h=>h.day),holidays.map(h=>h.name)]);
 await db.query(`UPDATE holiday_sync_state SET last_attempt_at=now(),last_success_at=now(),last_error_code=NULL,holiday_count=$1,years=$2,trigger=$3,actor_id=$4 WHERE id=1`,[holidays.length,years,trigger,actorId]);
 return {count:holidays.length,years};
}
export async function recordSyncFailure(db:Queryable,code:string,trigger:'MANUAL'|'WORKER',actorId:string|null){
 await db.query('UPDATE holiday_sync_state SET last_attempt_at=now(),last_error_code=$1,trigger=$2,actor_id=$3 WHERE id=1',[code,trigger,actorId]);
}

/**
 * The whole sync: download outside any transaction, then store in one. `run` opens the transaction (withTransaction in the web and the Worker).
 * The outcome is audited by code and count only.
 */
export async function syncHolidays(run:<T>(work:(db:Queryable)=>Promise<T>)=>Promise<T>,opts:{trigger:'MANUAL'|'WORKER';actorId:string|null;fetcher?:Fetcher}){
 const url=(await run(db=>tatSettings(db))).holidayIcalUrl;
 let holidays;
 try{holidays=await downloadHolidays(url,opts.fetcher);}
 catch(e){const code=codeOf(e);await run(async db=>{await recordSyncFailure(db,code,opts.trigger,opts.actorId);if(opts.actorId)await appendAudit(db,{actorId:opts.actorId,action:'HOLIDAY_CALENDAR_SYNC',resourceType:'BUSINESS_CALENDAR',details:{outcome:'FAILED',reasonCode:code}});});return {ok:false as const,code};}
 const stored=await run(async db=>{const r=await storeHolidays(db,holidays,opts.trigger,opts.actorId);if(opts.actorId)await appendAudit(db,{actorId:opts.actorId,action:'HOLIDAY_CALENDAR_SYNC',resourceType:'BUSINESS_CALENDAR',details:{outcome:'SYNCED',count:r.count}});return r;});
 return {ok:true as const,...stored};
}

export async function readSyncState(db:Queryable):Promise<SyncState>{
 const r=(await db.query<{last_attempt_at:Date|null;last_success_at:Date|null;last_error_code:string|null;holiday_count:number;years:number[];trigger:'MANUAL'|'WORKER'|null}>('SELECT last_attempt_at,last_success_at,last_error_code,holiday_count,years,trigger FROM holiday_sync_state WHERE id=1')).rows[0];
 const iso=(d:Date|null)=>d?new Date(d).toISOString():null;
 return r?{lastAttemptAt:iso(r.last_attempt_at),lastSuccessAt:iso(r.last_success_at),lastErrorCode:r.last_error_code,holidayCount:r.holiday_count,years:r.years??[],trigger:r.trigger}:{lastAttemptAt:null,lastSuccessAt:null,lastErrorCode:null,holidayCount:0,years:[],trigger:null};
}

/** Years (Gregorian) that have at least one stored holiday. */
export async function coveredYears(db:Queryable):Promise<number[]>{
 return (await db.query<{y:number}>('SELECT DISTINCT extract(year FROM day)::int y FROM business_holiday ORDER BY 1')).rows.map(r=>r.y);
}
/** Years the TAT needs now: this year, and from October the next year as well (Bangkok calendar). */
export function neededYears(now:Date){const d=bangkokDay(now),y=Number(d.slice(0,4)),m=Number(d.slice(5,7));return m>=10?[y,y+1]:[y];}

/** Holidays between two years inclusive, as a set of YYYY-MM-DD. */
export async function readHolidays(db:Queryable,fromYear:number,toYear:number):Promise<HolidaySet>{
 return new Set((await db.query<{d:string}>('SELECT day::text d FROM business_holiday WHERE day BETWEEN make_date($1::int,1,1) AND make_date($2::int,12,31)',[fromYear,toYear])).rows.map(r=>r.d));
}

/** What the dashboards need to count working days: holidays, the policy and the years with no calendar yet (counted as Sat/Sun only). */
export async function workingCalendar(db:Queryable,now:Date,fromYear?:number){
 const policy=await tatSettings(db),years=await coveredYears(db);
 const y=Number(bangkokDay(now).slice(0,4)),from=Math.min(fromYear??y-1,y-1);
 const holidays=await readHolidays(db,from,y+1);
 return {holidays,policy:{businessDays:policy.businessDays,warnDaysLeft:policy.warnDaysLeft},missingYears:[y].filter(x=>!years.includes(x)),sync:await readSyncState(db)};
}

/** Worker: sync once when a needed year is missing and no attempt was made recently. Returns what it did (for tests and logs). */
export async function ensureHolidays(run:<T>(work:(db:Queryable)=>Promise<T>)=>Promise<T>,now=new Date(),fetcher?:Fetcher){
 const {years,state}=await run(async db=>({years:await coveredYears(db),state:await readSyncState(db)}));
 const missing=neededYears(now).filter(y=>!years.includes(y));
 if(!missing.length)return {action:'NONE' as const};
 if(state.lastAttemptAt&&now.getTime()-Date.parse(state.lastAttemptAt)<WORKER_RETRY_MS)return {action:'WAIT' as const,missing};
 return {action:'SYNC' as const,missing,result:await syncHolidays(run,{trigger:'WORKER',actorId:null,fetcher})};
}
