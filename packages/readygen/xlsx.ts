import {readArchive,xmlDecode} from '../workbook/archive';
import {ZipError} from '../results/zip';

// Bounded, read-only XLSX reader for vendor workbooks (HALOS "Sample analysis data", NIFTY request form).
// Nothing is extracted to disk, no formula is evaluated and macro-enabled or externally linked packages are refused.
// Every value is returned as the exact text stored in the cell (number text is not reformatted).
export const XLSX_LIMITS={bytes:8*1024*1024,sheets:16,rows:2000,columns:200,cellChars:32767} as const;
export class XlsxError extends Error{}
const fail=(code:string):never=>{throw new XlsxError(code);};
export type XlsxCell={ref:string;column:number;text:string};
export type XlsxRow={number:number;cells:Map<number,XlsxCell>};
export type XlsxSheet={name:string;rows:XlsxRow[]};

export function columnNumber(ref:string){
 const letters=/^([A-Z]{1,3})\d+$/.exec(ref)?.[1];if(!letters)return fail('XLSX_CELL_REFERENCE_INVALID');
 let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;
 if(n>XLSX_LIMITS.columns)fail('XLSX_TOO_MANY_COLUMNS');return n;
}
const attr=(tag:string,name:string)=>new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]??null;
// Text of <t> runs only: phonetic guides (<rPh>) are not part of the cell value.
const runText=(xml:string)=>[...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m=>xmlDecode(m[1]??'')).join('');

export function readXlsx(bytes:Buffer):XlsxSheet[]{
 if(bytes.length===0)fail('EMPTY_FILE');if(bytes.length>XLSX_LIMITS.bytes)fail('FILE_TOO_LARGE');
 let parts:Map<string,Buffer>;
 try{parts=readArchive(bytes);}catch(e){return fail(e instanceof ZipError?e.message:'XLSX_NOT_A_PACKAGE');}
 const names=[...parts.keys()];
 // Printer settings (.bin) are inert; macros, ActiveX, OLE objects and external workbook links are not.
 if(names.some(n=>/vbaProject\.bin$|^xl\/externalLinks\/|activeX|^xl\/embeddings\//i.test(n)))fail('XLSX_ACTIVE_CONTENT_REFUSED');
 const types=parts.get('[Content_Types].xml')?.toString('utf8')??fail('XLSX_CONTENT_TYPES_MISSING');
 if(/macroEnabled/i.test(types))fail('XLSX_ACTIVE_CONTENT_REFUSED');
 const workbook=parts.get('xl/workbook.xml')?.toString('utf8')??fail('XLSX_WORKBOOK_MISSING');
 const rels=parts.get('xl/_rels/workbook.xml.rels')?.toString('utf8')??fail('XLSX_RELATIONSHIPS_MISSING');
 const target=new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m=>[attr(m[0],'Id')!,attr(m[0],'Target')!]));
 const shared:string[]=[];const sst=parts.get('xl/sharedStrings.xml')?.toString('utf8');
 if(sst)for(const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g))shared.push(runText(m[1]??''));
 const sheets=[...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map(m=>({name:xmlDecode(attr(m[0],'name')??''),rid:attr(m[0],'r:id')}));
 if(!sheets.length)fail('XLSX_NO_SHEETS');if(sheets.length>XLSX_LIMITS.sheets)fail('XLSX_TOO_MANY_SHEETS');
 return sheets.map(s=>{
  const t=s.rid?target.get(s.rid):undefined;if(!t)return fail('XLSX_SHEET_PART_MISSING');
  const path=t.startsWith('/')?t.slice(1):t.startsWith('xl/')?t:'xl/'+t.replace(/^\.\//,'');
  const xml=parts.get(path)?.toString('utf8')??fail('XLSX_SHEET_PART_MISSING');
  const rows:XlsxRow[]=[];
  for(const r of xml.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)){
   const number=Number(attr(r[1],'r'));if(!Number.isInteger(number)||number<1)fail('XLSX_ROW_NUMBER_INVALID');
   if(rows.length>=XLSX_LIMITS.rows)fail('XLSX_TOO_MANY_ROWS');
   const cells=new Map<number,XlsxCell>();
   for(const c of (r[2]??'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const ref=attr(c[1],'r')??fail('XLSX_CELL_REFERENCE_INVALID'),type=attr(c[1],'t'),body=c[2]??'';
    const v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let text:string;
    if(type==='s'){const i=Number(v);if(!Number.isInteger(i)||i<0||i>=shared.length)fail('XLSX_SHARED_STRING_INVALID');text=shared[i];}
    else if(type==='inlineStr')text=runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1]??'');
    else text=v===undefined?'':xmlDecode(v);
    if(text.length>XLSX_LIMITS.cellChars)fail('XLSX_CELL_TOO_LONG');
    if(text!=='')cells.set(columnNumber(ref),{ref,column:columnNumber(ref),text});
   }
   if(cells.size)rows.push({number,cells});
  }
  return {name:s.name,rows};
 });
}
/** Headers compare by meaning, not by position: case, line breaks and repeated spaces do not matter. */
export const normalizeHeader=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase();
