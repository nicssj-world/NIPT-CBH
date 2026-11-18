import {readXlsx,normalizeHeader,XlsxError} from '../readygen/xlsx';
import {operationalDataEnabled} from '../security/runtime';

// HIS ANC export (.xlsx, every cell stored as text). Owner 2026-11-18: it only fills blanks on waiting cases.
export const HIS_ANC_COLUMNS=['hospcode','hn','cid','brthdate','pttype','age','seq','date_serv','gravida','ancno','ga','ancresult','ancplace','provider','weight','height','bmi','edc','nipt_date','nipt'] as const;
export class HisAncError extends Error{constructor(public code:string){super(code);}}
export type HisAncIncomplete='BAD_IDENTIFIER'|'BAD_DATE'|'BAD_GA'|'G_ZERO'|'EDC_GA_MISMATCH';
export type HisAncRow={rowNo:number;hn:string;cid:string;visitDate:string;gravida:number|null;ga:{weeks:number;days:number}|null;edc:string|null;provider:string;weightKg:number|null;heightCm:number|null;incomplete:HisAncIncomplete|null};

/** "W+D" → weeks and days; days over 6 carry into weeks. */
export function splitGa(text:string):{weeks:number;days:number}|null{
 const m=/^(\d{1,2})\+(\d{1,2})$/.exec(text.trim());if(!m)return null;
 const total=Number(m[1])*7+Number(m[2]);return {weeks:Math.floor(total/7),days:total%7};
}
/** Only a provider titled พญ. or นพ. is a doctor (Owner 2026-11-18). */
export const isDoctorName=(provider:string)=>/^(พญ|นพ)\.\s*\S/.test(provider.trim());

/** DD/MM/YYYY (ค.ศ.) → YYYY-MM-DD; anything else (an Excel serial, ISO text, an impossible day) is null. */
function hisDate(text:string):string|null{
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());if(!m)return null;
 const iso=`${m[3]}-${m[2]}-${m[1]}`,t=Date.parse(iso+'T00:00:00Z');
 return Number.isNaN(t)||new Date(t).toISOString().slice(0,10)!==iso?null:iso;
}
const DAY=86400000;
const positive=(text:string)=>{const n=Number(text.trim());return text.trim()!==''&&Number.isFinite(n)&&n>0?n:null;};

export function parseHisAncWorkbook(bytes:Buffer):HisAncRow[]{
 let sheets;
 try{sheets=readXlsx(bytes);}catch(e){const m=e instanceof XlsxError?e.message:'';throw new HisAncError(m==='EMPTY_FILE'?'EMPTY_FILE':m==='XLSX_TOO_MANY_ROWS'?'TOO_MANY_ROWS':m==='FILE_TOO_LARGE'?'FILE_TOO_LARGE':'NOT_XLSX');}
 const [head,...rows]=sheets[0]?.rows??[];if(!head)throw new HisAncError('EMPTY_FILE');
 const index=new Map<string,number>();for(const c of head.cells.values())index.set(normalizeHeader(c.text),c.column);
 if(index.size!==HIS_ANC_COLUMNS.length||HIS_ANC_COLUMNS.some(k=>!index.has(k)))throw new HisAncError('HEADER_MISMATCH');
 if(!rows.length)throw new HisAncError('EMPTY_FILE');
 return rows.map(r=>{
  const v=(k:typeof HIS_ANC_COLUMNS[number])=>r.cells.get(index.get(k)!)?.text.trim()??'';
  const hn=v('hn'),cid=v('cid'),visitDate=hisDate(v('date_serv')),edcText=v('edc'),edc=edcText===''?null:hisDate(edcText),ga=splitGa(v('ga'));
  const g=v('gravida'),gravida=/^\d{1,2}$/.test(g)?Number(g):null;
  let incomplete:HisAncIncomplete|null=null;
  // A synthetic PET carries SYNTHETIC-ID-… in place of the CID; it never passes once operational data is on.
  if(!(/^\d{13}$/.test(cid)||!operationalDataEnabled()&&/^SYNTHETIC-ID-[A-Za-z0-9_-]+$/.test(cid))||!/^[A-Za-z0-9]{1,32}$/.test(hn))incomplete='BAD_IDENTIFIER';
  else if(!visitDate||(edcText!==''&&!edc))incomplete='BAD_DATE';
  else if(!ga)incomplete='BAD_GA';
  else if(gravida===0)incomplete='G_ZERO';
  else if(edc&&Math.abs((Date.parse(edc)-Date.parse(visitDate))/DAY-(280-(ga.weeks*7+ga.days)))>3)incomplete='EDC_GA_MISMATCH';
  return {rowNo:r.number,hn,cid,visitDate:visitDate??'',gravida:gravida===0?null:gravida,ga,edc,provider:v('provider'),weightKg:positive(v('weight')),heightCm:positive(v('height')),incomplete};
 });
}
