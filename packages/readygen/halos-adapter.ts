import {readXlsx,normalizeHeader,XlsxError,type XlsxSheet} from './xlsx';

// HALOS "Sample analysis data_<chip>_<date>.xlsx" adapter. Columns are found by their header text (semantic), never by position;
// every cell is kept raw with its sheet and row. This adapter only reads; matching and interpretation are separate steps.
export const HALOS_ADAPTER_VERSION='HALOS-NIFTY-SAMPLE-ANALYSIS-XLSX-1.0.0';
export const ANALYSIS_SHEETS=['result','repeat'] as const;
// Required analytic headers of the result/repeat sheets, as written by HALOS-NIFTY. Others are preserved but optional.
export const ANALYSIS_HEADERS={sampleNo:'Sample No.',sampleQc:'Sample QC',operationAdvice:'Operation advice',physicianAdvice:'Physician advice',
 testChr13:'Test(chr13)',testChr18:'Test(chr18)',testChr21:'Test(chr21)',testSex:'Test(Sex chr)',fetalFraction:'Fetal Fract. (%)',
 risk13:'13 risk index',risk18:'18 risk index',risk21:'21 risk index',repeatedSample:'Repeated sample',testOther:'Test(Other autosomes)',
 disease:'Disease',testCnv:'Test(CNV)',chipId:'Chip ID',laneId:'Lane ID',barcodeId:'Barcode ID',gender:'Gender'} as const;
export const SAMPLEINFO_HEADERS={sampleId:'Sample ID',fetusType:'Type of fetus',productName:'Product Name',gestationalWeeks:'Gestational Weeks'} as const;
export type AnalysisField=keyof typeof ANALYSIS_HEADERS;
export type HalosRow={sheet:'result'|'repeat'|'sampleinfo';rowNumber:number;raw:Record<string,string>;sampleRaw:string;sampleKey:string;
 values:Partial<Record<AnalysisField|keyof typeof SAMPLEINFO_HEADERS,string>>;invalid:string|null};
export type HalosIssue={code:string;severity:'ERROR'|'WARNING';sheet?:string;row?:number;detail?:string};
export type HalosWorkbook={adapterVersion:string;rows:HalosRow[];chipIds:string[];issues:HalosIssue[];counts:{result:number;repeat:number;sampleinfo:number}};
export class HalosAdapterError extends Error{constructor(code:string,public details?:unknown){super(code);}}

/** A vendor identifier keeps its characters; only surrounding whitespace (including a pasted TAB) is not part of the key. */
export const sampleKeyOf=(raw:string)=>raw.replace(/^[\s ​]+|[\s ​]+$/g,'');
export const SAMPLE_KEY=/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/;

function headerMap(sheet:XlsxSheet,required:Record<string,string>){
 const header=sheet.rows[0];if(!header)throw new HalosAdapterError('HALOS_SHEET_EMPTY',{sheet:sheet.name});
 const byText=new Map<string,number>(),labels=new Map<number,string>();
 for(const c of header.cells.values()){const key=normalizeHeader(c.text);if(byText.has(key))throw new HalosAdapterError('HALOS_HEADER_DUPLICATE',{sheet:sheet.name,header:c.text});byText.set(key,c.column);labels.set(c.column,c.text.replace(/\s+/g,' ').trim());}
 const missing=Object.values(required).filter(h=>!byText.has(normalizeHeader(h)));
 if(missing.length)throw new HalosAdapterError('HALOS_REQUIRED_HEADER_MISSING',{sheet:sheet.name,missing});
 return {column:(h:string)=>byText.get(normalizeHeader(h))!,labels,headerRow:header.number};
}
function rowsOf(sheet:XlsxSheet,kind:HalosRow['sheet'],required:Record<string,string>,keyHeader:string):HalosRow[]{
 const h=headerMap(sheet,required);
 return sheet.rows.filter(r=>r.number>h.headerRow).map(r=>{
  const raw:Record<string,string>={};for(const c of r.cells.values())raw[h.labels.get(c.column)??c.ref.replace(/\d+$/,'')]=c.text;
  const values=Object.fromEntries(Object.entries(required).map(([k,label])=>[k,r.cells.get(h.column(label))?.text??''])) as HalosRow['values'];
  const sampleRaw=r.cells.get(h.column(keyHeader))?.text??'',sampleKey=sampleKeyOf(sampleRaw);
  const invalid=!sampleKey?'SAMPLE_ID_MISSING':!SAMPLE_KEY.test(sampleKey)?'SAMPLE_ID_FORMAT_INVALID':null;
  return {sheet:kind,rowNumber:r.number,raw,sampleRaw:sampleRaw||'(blank)',sampleKey:sampleKey||'(blank)',values,invalid};
 });
}

/** Parse and validate the workbook. Structural problems are thrown; row-level problems are returned as issues. */
export function readHalosWorkbook(bytes:Buffer):HalosWorkbook{
 let sheets:XlsxSheet[];
 try{sheets=readXlsx(bytes);}catch(e){if(e instanceof XlsxError)throw new HalosAdapterError(e.message);throw e;}
 const find=(name:string)=>sheets.filter(s=>s.name.trim().toLowerCase()===name);
 for(const n of ['result','repeat','sampleinfo'])if(find(n).length>1)throw new HalosAdapterError('HALOS_SHEET_DUPLICATE',{sheet:n});
 const result=find('result')[0],repeat=find('repeat')[0],info=find('sampleinfo')[0];
 if(!result)throw new HalosAdapterError('HALOS_RESULT_SHEET_MISSING');if(!info)throw new HalosAdapterError('HALOS_SAMPLEINFO_SHEET_MISSING');
 const issues:HalosIssue[]=[];
 if(!repeat)issues.push({code:'REPEAT_SHEET_ABSENT',severity:'WARNING'});
 for(const s of sheets)if(!['result','repeat','sampleinfo'].includes(s.name.trim().toLowerCase()))issues.push({code:'UNKNOWN_SHEET_IGNORED',severity:'WARNING',sheet:s.name});
 const rows=[...rowsOf(result,'result',ANALYSIS_HEADERS,ANALYSIS_HEADERS.sampleNo),...(repeat?rowsOf(repeat,'repeat',ANALYSIS_HEADERS,ANALYSIS_HEADERS.sampleNo):[]),...rowsOf(info,'sampleinfo',SAMPLEINFO_HEADERS,SAMPLEINFO_HEADERS.sampleId)];
 for(const r of rows)if(r.invalid)issues.push({code:r.invalid,severity:'ERROR',sheet:r.sheet,row:r.rowNumber});
 const resultRows=rows.filter(r=>r.sheet==='result');
 if(!resultRows.length)throw new HalosAdapterError('HALOS_RESULT_SHEET_HAS_NO_ROWS');
 const chipIds=[...new Set(resultRows.map(r=>r.values.chipId?.trim()).filter((c):c is string=>!!c))].sort();
 if(chipIds.length>1)issues.push({code:'MIXED_CHIP_IN_RESULT_SHEET',severity:'WARNING',detail:chipIds.join(',')});
 if(!chipIds.length)issues.push({code:'CHIP_ID_MISSING',severity:'WARNING'});
 return {adapterVersion:HALOS_ADAPTER_VERSION,rows,chipIds,issues,counts:{result:resultRows.length,repeat:rows.filter(r=>r.sheet==='repeat').length,sampleinfo:rows.filter(r=>r.sheet==='sampleinfo').length}};
}

// NIFTY request form (vendor export) — counts real data rows only; blank pre-styled rows are not samples.
export const NIFTY_SAMPLE_HEADER='*Sample ID (BGI No. example：18B1234567/ 18B1234567R/ 18B1234567RR)';
export function readNiftyRequestRows(bytes:Buffer){
 const sheets=readXlsx(bytes),sheet=sheets[0];if(!sheet)throw new HalosAdapterError('NIFTY_SHEET_MISSING');
 const header=sheet.rows[0];const col=[...(header?.cells.values()??[])].find(c=>normalizeHeader(c.text).startsWith('*sample id'))?.column;
 if(!col)throw new HalosAdapterError('NIFTY_SAMPLE_ID_HEADER_MISSING');
 const label=new Map([...header.cells.values()].map(c=>[c.column,c.text.replace(/\s+/g,' ').trim()]));
 return sheet.rows.filter(r=>r.number>header.number&&sampleKeyOf(r.cells.get(col)?.text??'')!=='').map(r=>({rowNumber:r.number,sampleRaw:r.cells.get(col)!.text,sampleKey:sampleKeyOf(r.cells.get(col)!.text),
  cells:Object.fromEntries([...r.cells.values()].map(c=>[c.ref.replace(/\d+$/,''),c.text])),labels:Object.fromEntries([...r.cells.values()].map(c=>[c.ref.replace(/\d+$/,''),label.get(c.column)??'']))}));
}
