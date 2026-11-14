import {isoDate} from './parser';

/**
 * The "Approved Date" a previous-system ReadyGen PDF prints beside the approver's signature, e.g. "Approved Date: 04 - Nov - 2026" (Owner 2026-11-15).
 * Those PDFs carry no "Reported Date:", so this is the day the result was reported. The label is printed more than once; every copy must
 * give the same valid calendar day, otherwise nothing is returned and the reason says why (the result then stays dated by its import).
 */
export type ApprovedDate={value:string;raw:string}|{value:null;reason:'NOT_FOUND'|'UNREADABLE'|'CONFLICT';raw:string|null};
const APPROVED=/Approved Date:\s*(\d{1,2})\s*-\s*([A-Za-z]{3})\s*-\s*(\d{4})/g;
export function approvedDateOf(text:string):ApprovedDate{
 const found=[...text.matchAll(APPROVED)];
 if(!found.length)return {value:null,reason:'NOT_FOUND',raw:null};
 const raw=found[0][0].replace(/\s+/g,' ').trim();
 const days=found.map(m=>isoDate(`${m[1]}-${m[2]}-${m[3]}`));
 if(days.some(d=>d===null))return {value:null,reason:'UNREADABLE',raw};
 if(new Set(days).size>1)return {value:null,reason:'CONFLICT',raw};
 return {value:days[0]!,raw};
}
