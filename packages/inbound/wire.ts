import iconv from 'iconv-lite';
import {identityLookup} from '../security/envelope';
import type {Pet} from '../integrations/pet';
import {PARSER_VERSION} from '../integrations/pet';

export const PET_FILENAME=/^(\d+)-(\d+)\.pet$/i;
export const NIPT_SECTION='7';
export const NIPT_TEST_CODE='70096';
export const MAX_PET_BYTES=65_536;

/** Filename stage (no read): non-NIPT sections are counted only, never opened or stored (Plan §10.2 ข้อ 2, 7d). */
export function sectionOf(filename:string){const m=PET_FILENAME.exec(filename);return m?{ln:m[1],section:m[2]}:null;}

/**
 * Test-code stage after `.ok`: only a well-formed section-7 file whose O records carry no 70096 is "not NIPT".
 * A file without P/O records is malformed and must surface as a parse error, never be dropped as non-NIPT.
 */
export function classifyPet(bytes:Buffer):'NIPT'|'NOT_NIPT'|'INVALID_ENCODING'|'MALFORMED'{
 const text=iconv.decode(bytes,'windows-874');if(text.includes('�')||!iconv.encode(text,'windows-874').equals(bytes))return 'INVALID_ENCODING';
 const records=text.replace(/\r\n/g,'\n').split('\n').map(x=>x.split('|')),orders=records.filter(x=>x[0]==='O');
 if(!orders.length||!records.some(x=>x[0]==='P'))return 'MALFORMED';
 return orders.some(o=>o[4]?.split('^').find(c=>/^\d+$/.test(c))===NIPT_TEST_CODE)?'NIPT':'NOT_NIPT';
}

export interface StoredPet{ln:string;hn:string;name:string;dob:string;sex:string;receivedAt:string;specimenAt:string;orderAt:string;ward:string;identityKey:string;identityLastFour:string;filename:string;hash:string;parserVersion:string;}
/** Persisted parse: P[33] identity kept only as keyed HMAC + last four (Plan §10.2 ข้อ 5 "เข้ารหัส"). */
export function redactPet(p:Pet,lookupKey:Buffer):StoredPet{
 const {identity,...rest}=p;return {...rest,identityKey:identityLookup(identity,lookupKey),identityLastFour:identity.slice(-4),parserVersion:PARSER_VERSION};
}

export const IDENTITY_FIELDS=['hn','name','dob','sex','identity'] as const;
export const ORDER_FIELDS=['receivedAt','specimenAt','orderAt','ward'] as const;
/** Field names that differ between the applied S1 PET and a later PET of the same LN. Values are never returned. */
export function petDifferences(applied:Pet,next:Pet){
 return {identity:IDENTITY_FIELDS.filter(f=>applied[f]!==next[f]),order:ORDER_FIELDS.filter(f=>applied[f]!==next[f])};
}

export interface SyntheticPetSpec{ln:string;hn:string;name?:string;dob?:string;sex?:string;receivedAt:string;specimenAt?:string;orderAt?:string;ward?:string;identity?:string;testCode?:string;section?:string;headerAt?:string;}
/** Legacy-shaped synthetic `.pet` (H=13/P=35/O=29/L=3, CP874, CRLF) for P3 scenarios. Synthetic values only. */
export function buildSyntheticPet(s:SyntheticPetSpec){
 const section=s.section??NIPT_SECTION,specimen=s.specimenAt??s.receivedAt;
 const h=['H','\\^&','','','CBH','','','','','CIT5K','P','',s.headerAt??s.receivedAt];
 const p=Array<string>(35).fill('');Object.assign(p,{0:'P',1:'1',2:s.ln,3:s.hn,4:'^',5:s.name??'SYNTHETIC^^นาง จำลอง',7:s.dob??'20000101',8:s.sex??'F',9:'^^^',21:s.receivedAt,23:specimen+'^'+s.receivedAt,33:`${s.ward??'SYNTHETIC-WARD'}^${s.identity??'SYNTHETIC-ID-P3'}`});
 const o=Array<string>(29).fill('');Object.assign(o,{0:'O',1:'1',2:s.ln,4:`^^^${s.testCode??NIPT_TEST_CODE}^B^^`,11:'A',14:s.orderAt??specimen,15:'118',18:section,28:'O'});
 return {filename:`${s.ln}-${section}.pet`,bytes:iconv.encode([h.join('|'),p.join('|'),o.join('|'),'L|1|N',''].join('\r\n'),'windows-874')};
}
