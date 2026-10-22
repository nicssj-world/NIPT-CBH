import {z} from 'zod';
// Owner decision (Plan Rev 3.4 §7): users see and type Thai Buddhist Era (BE) dates; storage, APIs, HIS wire
// formats and every identifier (LN Halos, control codes, run labels) stay Gregorian ISO `YYYY-MM-DD`.
// This module is the only place that converts between the two. It never accepts its own output as input,
// so a value can never be converted twice.
export const BE_OFFSET=543;
/** ISO years at or above this are almost certainly a BE year typed into a CE field (2026 CE = 2569 BE). */
export const BE_YEAR_AS_CE_THRESHOLD=2400;
const ISO=/^(\d{4})-(\d{2})-(\d{2})$/;
const THAI_MONTH_SHORT=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'] as const;
export const THAI_MONTH_LONG=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'] as const;

const daysInMonth=(year:number,month:number)=>new Date(Date.UTC(year,month,0)).getUTCDate();
/** A calendar date that exists in the proleptic Gregorian calendar (rejects 2026-02-31, 2025-02-29). */
export function isRealIsoDate(value:string){
 const m=ISO.exec(value);if(!m)return false;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
 return y>=1&&mo>=1&&mo<=12&&d>=1&&d<=daysInMonth(y,mo);
}
export const isLikelyBuddhistEraYear=(value:string)=>Number(value.slice(0,4))>=BE_YEAR_AS_CE_THRESHOLD;

/** Hard server guard for user-entered dates: H1 real calendar date, H2 no BE year sent as CE. */
export const isoDate=z.string()
 .refine(isRealIsoDate,{message:'INVALID_DATE'})
 .refine(v=>!isLikelyBuddhistEraYear(v),{message:'DATE_LIKELY_BUDDHIST_ERA'});

export type BeParse={ok:true;iso:string}|{ok:false;code:'EMPTY'|'FORMAT'|'USE_BE_YEAR'|'INVALID_DATE'};
/** Parses BE DDMMBBBB or d/m/yyyy (also - or . separators) into ISO CE exactly once. */
export function parseBeInput(input:string):BeParse{
 const s=input.trim();if(!s)return {ok:false,code:'EMPTY'};
 const m=/^(\d{2})(\d{2})(\d{4})$/.exec(s)??/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);if(!m)return {ok:false,code:'FORMAT'};
 const beYear=Number(m[3]);
 if(beYear<BE_YEAR_AS_CE_THRESHOLD)return {ok:false,code:'USE_BE_YEAR'};
 const iso=`${String(beYear-BE_OFFSET).padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 return isRealIsoDate(iso)?{ok:true,iso}:{ok:false,code:'INVALID_DATE'};
}
const DT=/^(\d{8}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s+(\d{1,2}):(\d{2})$/;
/** Parses `dd/mm/yyyy HH:mm` (BE, 24 h, Asia/Bangkok wall time) into the wall string `YYYY-MM-DDTHH:mm` (CE). */
export function parseBeDateTime(input:string):{ok:true;wall:string}|{ok:false;code:'EMPTY'|'FORMAT_DT'|'FORMAT'|'USE_BE_YEAR'|'INVALID_DATE'|'INVALID_TIME'}{
 const s=input.trim();if(!s)return {ok:false,code:'EMPTY'};
 const m=DT.exec(s);if(!m)return {ok:false,code:'FORMAT_DT'};
 const d=parseBeInput(m[1]);if(!d.ok)return {ok:false,code:d.code==='EMPTY'?'FORMAT_DT':d.code};
 const h=Number(m[2]),mi=Number(m[3]);if(h>23||mi>59)return {ok:false,code:'INVALID_TIME'};
 return {ok:true,wall:`${d.iso}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`};
}
/** Wall string `YYYY-MM-DDTHH:mm` (CE) → `dd/mm/yyyy HH:mm` (BE); empty for missing, raw text for unparseable stored data. */
export function formatBeWall(wall:string){const [d,t]=wall.split('T');if(!d||!t)return '';try{return `${formatBe(d)} ${t.slice(0,5)}`;}catch{return wall;}}
function parts(iso:string){
 if(!isRealIsoDate(iso))throw new Error('ISO_DATE_REQUIRED');
 // A BE-range ISO year would be converted a second time; refuse instead of printing e.g. 3112.
 if(isLikelyBuddhistEraYear(iso))throw new Error('DATE_LIKELY_BUDDHIST_ERA');
 const [y,mo,d]=iso.split('-').map(Number);return {y,mo,d};
}
/** ISO CE → `dd/mm/yyyy` with a 4-digit BE year (documents and numeric display). */
export function formatBe(iso:string){const {y,mo,d}=parts(iso);return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y+BE_OFFSET}`;}
/** ISO CE → `17 ต.ค. 2569`. */
export function formatBeText(iso:string){const {y,mo,d}=parts(iso);return `${d} ${THAI_MONTH_SHORT[mo-1]} ${y+BE_OFFSET}`;}
/** Nullable display helper for UI: never throws on stored data, shows a dash for missing values. */
export const displayBe=(iso:string|null|undefined,empty='—')=>{if(!iso)return empty;try{return formatBe(iso.slice(0,10));}catch{return iso;}};

const BANGKOK=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
/** Instant → Asia/Bangkok `dd/mm/yyyy HH:mm` (BE), independent of the device timezone. */
export function formatBeDateTime(instant:string|Date){
 const date=instant instanceof Date?instant:new Date(instant);if(Number.isNaN(date.getTime()))throw new Error('INSTANT_REQUIRED');
 const p=Object.fromEntries(BANGKOK.formatToParts(date).map(x=>[x.type,x.value]));
 return `${p.day}/${p.month}/${Number(p.year)+BE_OFFSET} ${p.hour}:${p.minute}`;
}
export const displayBeDateTime=(instant:string|Date|null|undefined,empty='—')=>{if(!instant)return empty;try{return formatBeDateTime(instant);}catch{return String(instant);}};
/** Bangkok calendar day of an instant as ISO CE (for defaults and comparisons; never for display). */
export function bangkokIsoDay(instant:Date=new Date()){const p=Object.fromEntries(BANGKOK.formatToParts(instant).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
