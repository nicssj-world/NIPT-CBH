/**
 * P5H resolution-aware dates (Plan v6.2.1 §4.8, §5.11, D-46, AT-HIST-10/15). Pure; no I/O.
 * Dates are calendar days (Asia/Bangkok). A date of unknown or low resolution is never filled in: eligibility
 * uses the "latest possible date" of the recorded resolution (month → last day of month, year → 31 December).
 */
export type HistoricalDate =
 |{precision:'DAY';value:string}
 |{precision:'MONTH';value:string}
 |{precision:'YEAR';value:string}
 |{precision:'UNKNOWN'};
export const UNKNOWN_DATE:HistoricalDate={precision:'UNKNOWN'};

const leap=(y:number)=>y%4===0&&(y%100!==0||y%400===0);
export const daysInMonth=(y:number,m:number)=>[31,leap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
const MIN_YEAR=1900,MAX_YEAR=2100;
const p2=(n:number)=>String(n).padStart(2,'0');

/** Strict constructors. They throw on impossible calendar values instead of normalising (no silent 31 Feb → 3 Mar). */
export function dayDate(y:number,m:number,d:number):HistoricalDate{
 if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(d)||y<MIN_YEAR||y>MAX_YEAR||m<1||m>12||d<1||d>daysInMonth(y,m))throw new Error('INVALID_HISTORICAL_DATE');
 return {precision:'DAY',value:`${y}-${p2(m)}-${p2(d)}`};
}
export function monthDate(y:number,m:number):HistoricalDate{
 if(!Number.isInteger(y)||!Number.isInteger(m)||y<MIN_YEAR||y>MAX_YEAR||m<1||m>12)throw new Error('INVALID_HISTORICAL_DATE');
 return {precision:'MONTH',value:`${y}-${p2(m)}`};
}
export function yearDate(y:number):HistoricalDate{
 if(!Number.isInteger(y)||y<MIN_YEAR||y>MAX_YEAR)throw new Error('INVALID_HISTORICAL_DATE');
 return {precision:'YEAR',value:String(y)};
}

/** Validate a stored/untrusted HistoricalDate (e.g. from JSON). Returns the date or throws. */
export function assertHistoricalDate(d:HistoricalDate):HistoricalDate{
 if(d.precision==='UNKNOWN'){if(Object.keys(d).length!==1)throw new Error('INVALID_HISTORICAL_DATE');return d;}
 const m=d.precision==='DAY'?/^(\d{4})-(\d{2})-(\d{2})$/.exec(d.value):d.precision==='MONTH'?/^(\d{4})-(\d{2})$/.exec(d.value):d.precision==='YEAR'?/^(\d{4})$/.exec(d.value):null;
 if(!m)throw new Error('INVALID_HISTORICAL_DATE');
 const [y,mo,da]=[Number(m[1]),m[2]?Number(m[2]):1,m[3]?Number(m[3]):1];
 return d.precision==='DAY'?dayDate(y,mo,da):d.precision==='MONTH'?monthDate(y,mo):yearDate(y);
}

export const isIsoDay=(v:string)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!m)return false;try{dayDate(Number(m[1]),Number(m[2]),Number(m[3]));return true;}catch{return false;}};

/** Latest calendar day the recorded date could still denote; null when unknown (nothing may be inferred). */
export function latestPossibleDate(d:HistoricalDate):string|null{
 if(d.precision==='UNKNOWN')return null;
 const ok=assertHistoricalDate(d);
 if(ok.precision==='UNKNOWN')return null;
 if(ok.precision==='DAY')return ok.value;
 if(ok.precision==='MONTH'){const [y,m]=ok.value.split('-').map(Number);return `${y}-${p2(m)}-${p2(daysInMonth(y,m))}`;}
 return `${ok.value}-12-31`;
}

/** Strict "before cutoff": the cutoff day itself is NOT before (Plan §5.11: "ตั้งแต่ go_live_cutoff" is not eligible). ISO days compare lexically. */
export function latestPossibleIsBefore(d:HistoricalDate,cutoff:string):boolean{
 if(!isIsoDay(cutoff))throw new Error('INVALID_CUTOFF');
 const latest=latestPossibleDate(d);
 return latest!==null&&latest<cutoff;
}

/** UTC instant → Asia/Bangkok calendar day (UTC+7, no DST). Boundary: 2026-12-31T17:00:00Z is already 2027-01-01 in Bangkok. */
export function bangkokDay(instant:string|Date):string{
 const t=typeof instant==='string'?new Date(instant):instant;
 if(Number.isNaN(t.getTime()))throw new Error('INVALID_INSTANT');
 return new Date(t.getTime()+7*3600_000).toISOString().slice(0,10);
}

export type LegacyDateIssue='EMPTY'|'UNPARSEABLE'|'IMPOSSIBLE_DATE'|'AMBIGUOUS_YEAR_ERA'|'YEAR_OUT_OF_RANGE';
const EN_MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
/**
 * Parse the date spellings found in the legacy NIPTY database (ISO, "DD-Mon-YYYY" from PDFs, "YYYYMMDD[HHMMSS]" from STAT/.pet;
 * source: legacy services/thai_date.py and matcher.py). A value that cannot be read becomes UNKNOWN with an issue — it never "passes"
 * (the legacy 45-day matcher failed open on unreadable dates; that behaviour is deliberately not ported).
 * A year ≥ 2400 is not converted from the Buddhist era: the legacy only converted it for user filter input, so the era is ambiguous here.
 */
export function parseLegacyDate(raw:string|null|undefined):{date:HistoricalDate;issue:LegacyDateIssue|null}{
 const s=(raw??'').trim();
 if(!s)return {date:UNKNOWN_DATE,issue:'EMPTY'};
 let y:number,mo:number,d:number;
 const m=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s)??/^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/.exec(s);
 if(m){[y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])];}
 else{
  const e=/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  const idx=e?EN_MONTHS.indexOf(e[2].toLowerCase()):-1;
  if(!e||idx<0)return {date:UNKNOWN_DATE,issue:'UNPARSEABLE'};
  [y,mo,d]=[Number(e[3]),idx+1,Number(e[1])];
 }
 if(y>=2400)return {date:UNKNOWN_DATE,issue:'AMBIGUOUS_YEAR_ERA'};
 if(y<MIN_YEAR||y>MAX_YEAR)return {date:UNKNOWN_DATE,issue:'YEAR_OUT_OF_RANGE'};
 try{return {date:dayDate(y,mo,d),issue:null};}catch{return {date:UNKNOWN_DATE,issue:'IMPOSSIBLE_DATE'};}
}
