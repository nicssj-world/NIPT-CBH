import {zipEntries,zipRead,isZip} from '../results/zip';

/**
 * Bulk Import table reader (Excel .xlsx / CSV). Pure and bounded; reads bytes in memory only, never writes or executes anything.
 * XLSX is read as the zip + XML it is (sheet1 + sharedStrings); formulas are not evaluated, only their cached text is read.
 */
export const TABLE_LIMITS={bytes:5*1024*1024,rows:1000,columns:40,cellChars:500} as const;
export class TableError extends Error{constructor(public code:string){super(code);}}

/** Canonical columns of the import template. `required` ones must be present in the header; blanks are judged per row. */
export const TABLE_COLUMNS=[
 {key:'ln',required:true,label:'LN ตามเอกสาร'},{key:'hn',required:true,label:'HN'},{key:'name',required:true,label:'ชื่อ-สกุล (ข้อมูลจำลอง)'},{key:'dob',required:false,label:'วันเกิด'},
 {key:'collection_date',required:false,label:'วันที่เจาะเลือด'},{key:'receipt_date',required:false,label:'วันที่รับตัวอย่าง'},{key:'report_date',required:false,label:'วันที่รายงานผล'},
 {key:'control_record_date',required:false,label:'วันที่บันทึกควบคุมของ Lab'},{key:'request_date',required:false,label:'วันที่ใบขอส่งตรวจ'},{key:'consent_date',required:false,label:'วันที่ใบยินยอม'},
 {key:'pdf_file',required:false,label:'ชื่อไฟล์ PDF ผลเดิม'},{key:'original_location',required:true,label:'ที่เก็บเอกสารต้นฉบับ'},
 {key:'request_paper',required:false,label:'มีใบขอส่งตรวจกระดาษ (Y/N)'},{key:'consent_paper',required:false,label:'มีใบยินยอมกระดาษ (Y/N)'},{key:'consent_decision',required:false,label:'การตัดสินใจใน Consent ตามที่เขียน'},
 {key:'pregnancy_type',required:false,label:'ประเภทครรภ์'},{key:'past_certification',required:false,label:'การรับรองในอดีตตามที่ปรากฏ (ข้อความ)'},
] as const;
export type ColumnKey=typeof TABLE_COLUMNS[number]['key'];
export type TableRow={rowNo:number;cells:Partial<Record<ColumnKey,string>>};
export type ParsedTable={rows:TableRow[]};
export const templateCsv=()=>'﻿'+TABLE_COLUMNS.map(c=>c.key).join(',')+'\r\n';

const KEYS=new Set<string>(TABLE_COLUMNS.map(c=>c.key));
function shape(grid:string[][]):ParsedTable{
 const nonEmpty=grid.filter(r=>r.some(c=>c.trim()!==''));
 if(!nonEmpty.length)throw new TableError('TABLE_EMPTY');
 const header=nonEmpty[0].map(h=>h.replace(/^﻿/,'').trim().toLowerCase());
 if(header.length>TABLE_LIMITS.columns)throw new TableError('TABLE_TOO_WIDE');
 const unknown=header.filter(h=>h&&!KEYS.has(h));
 if(unknown.length)throw new TableError('TABLE_UNKNOWN_COLUMN');
 if(new Set(header.filter(Boolean)).size!==header.filter(Boolean).length)throw new TableError('TABLE_DUPLICATE_COLUMN');
 for(const c of TABLE_COLUMNS)if(c.required&&!header.includes(c.key))throw new TableError('TABLE_MISSING_COLUMN');
 const rows=nonEmpty.slice(1);
 if(!rows.length)throw new TableError('TABLE_NO_ROWS');
 if(rows.length>TABLE_LIMITS.rows)throw new TableError('TABLE_TOO_MANY_ROWS');
 // Row numbers follow the spreadsheet (header = row 1); blank lines are skipped but keep their number.
 const all=grid.map((r,i)=>({r,i}));
 const headerIdx=all.findIndex(x=>x.r.some(c=>c.trim()!==''));
 const data=all.slice(headerIdx+1).filter(x=>x.r.some(c=>c.trim()!==''));
 return {rows:data.map(({r,i})=>{
  const cells:Partial<Record<ColumnKey,string>>={};
  header.forEach((h,ci)=>{if(h)cells[h as ColumnKey]=(r[ci]??'').trim();});
  for(const v of Object.values(cells))if((v??'').length>TABLE_LIMITS.cellChars)throw new TableError('TABLE_CELL_TOO_LONG');
  return {rowNo:i+1,cells};
 })};
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF/LF, UTF-8 with or without BOM. */
export function parseCsv(bytes:Buffer):ParsedTable{
 if(bytes.length>TABLE_LIMITS.bytes)throw new TableError('TABLE_TOO_LARGE');
 const text=bytes.toString('utf8');
 if(text.includes('\u0000'))throw new TableError('TABLE_NOT_TEXT');
 const grid:string[][]=[];let row:string[]=[],cell='',q=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}
  else if(ch==='"'&&cell==='')q=true;
  else if(ch===','){row.push(cell);cell='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';grid.push(row);row=[];}
  else cell+=ch;
 }
 if(q)throw new TableError('TABLE_BAD_QUOTING');
 if(cell!==''||row.length){row.push(cell);grid.push(row);}
 return shape(grid);
}

const entity=(s:string)=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&');
const textOf=(xml:string)=>[...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>entity(m[1])).join('');
const colIndex=(ref:string)=>{const letters=/^[A-Z]+/.exec(ref)?.[0]??'';let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return n-1;};
/** Excel stores dates as serial numbers; a cell that is a bare integer in the plausible date range is converted to YYYY-MM-DD. */
export function excelSerialToIso(serial:number):string|null{
 if(!Number.isInteger(serial)||serial<20000||serial>80000)return null;
 const ms=Date.UTC(1899,11,30)+serial*86400000;return new Date(ms).toISOString().slice(0,10);
}

export function parseXlsx(bytes:Buffer):ParsedTable{
 if(bytes.length>TABLE_LIMITS.bytes)throw new TableError('TABLE_TOO_LARGE');
 if(!isZip(bytes))throw new TableError('TABLE_NOT_XLSX');
 let entries;try{entries=zipEntries(bytes);}catch{throw new TableError('TABLE_NOT_XLSX');}
 const read=(name:string)=>{const e=entries.find(x=>x.name===name);return e?zipRead(bytes,e).toString('utf8'):null;};
 const sheets=entries.map(e=>e.name).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(/(\d+)/.exec(a)![1])-Number(/(\d+)/.exec(b)![1]));
 if(!sheets.length)throw new TableError('TABLE_NOT_XLSX');
 const sst=read('xl/sharedStrings.xml');
 const strings=sst?[...sst.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>textOf(m[1])):[];
 const xml=read(sheets[0])!;
 const grid:string[][]=[];
 for(const rm of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
  const rowIdx=Number(rm[1])-1;if(rowIdx>TABLE_LIMITS.rows+5)throw new TableError('TABLE_TOO_MANY_ROWS');
  const row:string[]=[];
  for(const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const attrs=cm[1],body=cm[2]??'';const ref=/\br="([A-Z]+\d+)"/.exec(attrs)?.[1];if(!ref)continue;
   const ci=colIndex(ref);if(ci>=TABLE_LIMITS.columns)continue;
   const t=/\bt="(\w+)"/.exec(attrs)?.[1];const v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
   let value='';
   if(t==='s')value=strings[Number(v)]??'';
   else if(t==='inlineStr')value=textOf(body);
   else if(t==='str'||t==='b')value=entity(v??'');
   else if(v!==undefined){const n=Number(v);const iso=Number.isInteger(n)?excelSerialToIso(n):null;value=iso??entity(v);}
   row[ci]=value;
  }
  while(grid.length<rowIdx)grid.push([]);
  grid[rowIdx]=Array.from(row,c=>c??'');
 }
 return shape(grid);
}

export function readTable(name:string,bytes:Buffer):ParsedTable{
 const lower=name.toLowerCase();
 if(lower.endsWith('.csv'))return parseCsv(bytes);
 if(lower.endsWith('.xlsx'))return parseXlsx(bytes);
 throw new TableError('TABLE_TYPE_NOT_SUPPORTED');
}
