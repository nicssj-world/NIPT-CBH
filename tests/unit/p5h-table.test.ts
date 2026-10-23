import {describe,it,expect} from 'vitest';
import {parseCsv,parseXlsx,readTable,templateCsv,excelSerialToIso,TableError,TABLE_COLUMNS} from '../../packages/historical/table';
import {parseSheetDate,matchPdf,buildDraftData} from '../../packages/historical/bulk';
import {syntheticZip} from '../../tools/his-simulator/result-pdf';
import {dayDate,monthDate,yearDate,UNKNOWN_DATE} from '../../packages/historical/dates';

const HEAD='ln,hn,name,original_location';
const bytes=(s:string)=>Buffer.from(s,'utf8');
const code=(f:()=>unknown)=>{try{f();return null;}catch(e){return e instanceof TableError?e.code:'OTHER';}};

describe('P5H table reader (CSV)',()=>{
 it('reads quoted fields, doubled quotes, CRLF/LF and a BOM; row numbers follow the spreadsheet',()=>{
  const t=parseCsv(bytes(`﻿${HEAD}\r\n2610100001,9901001,"SYNTHETIC ""A"", B",CAB-1\n\n2610100002,9901002,SYNTHETIC C,"CAB-2"\n`));
  expect(t.rows.map(r=>r.rowNo)).toEqual([2,4]);
  expect(t.rows[0].cells).toEqual({ln:'2610100001',hn:'9901001',name:'SYNTHETIC "A", B',original_location:'CAB-1'});
 });
 it('keeps leading zeros (cells are text) and trims whitespace',()=>{expect(parseCsv(bytes(`${HEAD}\n 0012 ,9901001,SYNTHETIC A, CAB \n`)).rows[0].cells.ln).toBe('0012');});
 it('refuses unknown or duplicate columns and missing required columns',()=>{
  expect(code(()=>parseCsv(bytes(`${HEAD},national_id\n1,2,3,4,5\n`)))).toBe('TABLE_UNKNOWN_COLUMN');
  expect(code(()=>parseCsv(bytes(`${HEAD},ln\n1,2,3,4,5\n`)))).toBe('TABLE_DUPLICATE_COLUMN');
  expect(code(()=>parseCsv(bytes('ln,hn\n1,2\n')))).toBe('TABLE_MISSING_COLUMN');
  expect(code(()=>parseCsv(bytes('')))).toBe('TABLE_EMPTY');
  expect(code(()=>parseCsv(bytes(`${HEAD}\n`)))).toBe('TABLE_NO_ROWS');
 });
 it('refuses unbalanced quotes, binary content, oversized cells and too many rows',()=>{
  expect(code(()=>parseCsv(bytes(`${HEAD}\n1,2,"x,y\n`)))).toBe('TABLE_BAD_QUOTING');
  expect(code(()=>parseCsv(Buffer.from([0x6c,0,0x6e])))).toBe('TABLE_NOT_TEXT');
  expect(code(()=>parseCsv(bytes(`${HEAD}\n1,2,${'x'.repeat(501)},4\n`)))).toBe('TABLE_CELL_TOO_LONG');
  expect(code(()=>parseCsv(bytes(`${HEAD}\n`+Array.from({length:1001},(_,i)=>`${i},2,3,4`).join('\n'))))).toBe('TABLE_TOO_MANY_ROWS');
 });
 it('the template contains every column and is itself readable once rows are added',()=>{
  const t=templateCsv();
  for(const c of TABLE_COLUMNS)expect(t).toContain(c.key);
  expect(parseCsv(bytes(t+'1,9901001,SYNTHETIC A,,,,,,,,,CAB\n')).rows).toHaveLength(1);
 });
 it('picks the reader by extension and refuses other types',()=>{
  expect(readTable('a.CSV',bytes(`${HEAD}\n1,2,3,4\n`)).rows).toHaveLength(1);
  expect(code(()=>readTable('a.xls',bytes('')))).toBe('TABLE_TYPE_NOT_SUPPORTED');
  expect(code(()=>readTable('a.xlsx',bytes('not a zip')))).toBe('TABLE_NOT_XLSX');
 });
});

function xlsx(rows:string[][],{shared=true}:{shared?:boolean}={}){
 const strings:string[]=[];
 const cell=(v:string,ci:number,ri:number)=>{
  const ref=`${String.fromCharCode(65+ci)}${ri+1}`;
  if(/^\d+$/.test(v)&&ci>=100)return `<c r="${ref}"><v>${v}</v></c>`;
  if(v==='#serial')return `<c r="${ref}"><v>46022</v></c>`;
  if(shared){strings.push(v);return `<c r="${ref}" t="s"><v>${strings.length-1}</v></c>`;}
  return `<c r="${ref}" t="inlineStr"><is><t>${v.replace(/&/g,'&amp;')}</t></is></c>`;
 };
 const sheet=`<?xml version="1.0"?><worksheet><sheetData>${rows.map((r,ri)=>`<row r="${ri+1}">${r.map((v,ci)=>cell(v,ci,ri)).join('')}</row>`).join('')}</sheetData></worksheet>`;
 const sst=`<?xml version="1.0"?><sst>${strings.map(s=>`<si><t>${s.replace(/&/g,'&amp;')}</t></si>`).join('')}</sst>`;
 return syntheticZip([{name:'[Content_Types].xml',data:bytes('<Types/>')},{name:'xl/worksheets/sheet1.xml',data:bytes(sheet),deflate:true},...(shared?[{name:'xl/sharedStrings.xml',data:bytes(sst),deflate:true}]:[])]);
}
describe('P5H table reader (XLSX)',()=>{
 it('reads shared-string and inline-string cells and entity-decodes text',()=>{
  for(const shared of [true,false]){
   const t=parseXlsx(xlsx([['ln','hn','name','original_location'],['2610100001','9901001','SYNTHETIC A & B','CAB-1']],{shared}));
   expect(t.rows).toHaveLength(1);expect(t.rows[0].cells.name).toBe('SYNTHETIC A & B');expect(t.rows[0].cells.ln).toBe('2610100001');
  }
 });
 it('converts an Excel date serial in a numeric cell to an ISO day and leaves ordinary numbers alone',()=>{
  expect(excelSerialToIso(46022)).toBe('2025-12-31');expect(excelSerialToIso(61)).toBeNull();expect(excelSerialToIso(45000.5)).toBeNull();
  const t=parseXlsx(xlsx([['ln','hn','name','original_location','report_date'],['1','2','3','4','#serial']]));
  expect(t.rows[0].cells.report_date).toBe('2025-12-31');
 });
 it('refuses a zip that is not a workbook and unknown columns',()=>{
  expect(code(()=>parseXlsx(syntheticZip([{name:'readme.txt',data:bytes('x')}])))).toBe('TABLE_NOT_XLSX');
  expect(code(()=>parseXlsx(xlsx([['ln','hn','name','original_location','secret'],['1','2','3','4','5']])))).toBe('TABLE_UNKNOWN_COLUMN');
 });
});

describe('P5H sheet dates and PDF matching',()=>{
 it('accepts only unambiguous spellings and never guesses day-first or Buddhist-era dates',()=>{
  expect(parseSheetDate('2025-12-31')).toEqual({date:dayDate(2025,12,31)});
  expect(parseSheetDate('31-Dec-2025')).toEqual({date:dayDate(2025,12,31)});
  expect(parseSheetDate('2025-12')).toEqual({date:monthDate(2025,12)});
  expect(parseSheetDate('2025')).toEqual({date:yearDate(2025)});
  expect(parseSheetDate('46022')).toEqual({date:dayDate(2025,12,31)});
  expect(parseSheetDate('')).toEqual({date:null});expect(parseSheetDate(undefined)).toEqual({date:null});
  expect(parseSheetDate('unknown')).toEqual({date:UNKNOWN_DATE});expect(parseSheetDate('ไม่ทราบ')).toEqual({date:UNKNOWN_DATE});
  expect(parseSheetDate('31/12/2025').issue).toBe('DATE_FORMAT_INVALID');
  expect(parseSheetDate('2568-12-31').issue).toBe('DATE_ERA_AMBIGUOUS');
  expect(parseSheetDate('2568').issue).toBe('DATE_ERA_AMBIGUOUS');
  expect(parseSheetDate('2025-02-30').issue).toBe('DATE_IMPOSSIBLE');
  expect(parseSheetDate('2025-13').issue).toBe('DATE_OUT_OF_RANGE');
 });
 const pdf=(name:string,ln:string|null)=>({fileId:name,name,sha256:'a'.repeat(64),parsed:ln?{ln,hn:null,name:null,dob:null,reportedDate:null}:null});
 it('matches by the sheet file name first, then by an unambiguous LN inside the PDF',()=>{
  const files=[pdf('A.pdf','111'),pdf('b.pdf','222'),pdf('c.pdf','222')];
  expect(matchPdf('a.PDF','999',files).pdf?.name).toBe('A.pdf');
  expect(matchPdf('zzz.pdf','111',files)).toMatchObject({pdf:null,issue:{code:'PDF_FILE_NOT_FOUND'}});
  expect(matchPdf('','111',files).pdf?.name).toBe('A.pdf');
  expect(matchPdf('','222',files)).toMatchObject({pdf:null,issue:{code:'PDF_MATCH_AMBIGUOUS'}});
  expect(matchPdf('','333',files)).toEqual({pdf:null});
  expect(matchPdf('A.pdf','1',[pdf('A.pdf',null),pdf('a.pdf',null)]).issue?.code).toBe('PDF_NAME_AMBIGUOUS');
 });
 it('builds evidence only from what the row says: no PDF and no date means no Anchor item; unknown stays unknown',()=>{
  const row={rowNo:2,cells:{ln:'2610100001',hn:'9901001',name:'SYNTHETIC A',original_location:'CAB-1',collection_date:'unknown'}};
  const {data,issues}=buildDraftData(row,null);
  expect(issues).toEqual([]);
  expect(data.evidence).toEqual([]);
  expect(data.events).toEqual([{id:'r2-collection',type:'COLLECTION',date:UNKNOWN_DATE,evidenceItemId:null}]);
  expect(data.facts.reportDate).toEqual({state:'NOT_IN_EVIDENCE'});expect(data.facts.consentDecisionAsWritten).toEqual({state:'NOT_IN_EVIDENCE'});
  expect(data.pastCertification).toEqual({state:'NOT_IN_EVIDENCE'});
 });
 it('a report date on paper becomes a paper-original Anchor candidate; Request/Consent are evidence but never Anchors',()=>{
  const {data}=buildDraftData({rowNo:3,cells:{ln:'2610100001',hn:'9901001',name:'SYNTHETIC A',original_location:'CAB-1',report_date:'2025-12-01',request_paper:'Y',consent_paper:'yes',consent_decision:'ปฏิเสธ (ตามที่เขียน)',request_date:'2025-10-01'}},null);
  expect(data.evidence.map(e=>[e.kind,e.provenance,e.fileSha256])).toEqual([['FINAL_RESULT_REPORT','PAPER_ORIGINAL',null],['REQUEST_PAPER','PAPER_ORIGINAL',null],['CONSENT_PAPER','PAPER_ORIGINAL',null]]);
  expect(data.evidence[2].appears).toBe('ปฏิเสธ (ตามที่เขียน)');
  expect(data.evidence.every(e=>e.originalLocation==='CAB-1')).toBe(true);
 });
 it('validates identity fields: non-numeric LN, non-synthetic HN, non-synthetic name, missing original location, bad Y/N',()=>{
  const {issues}=buildDraftData({rowNo:2,cells:{ln:'12A',hn:'12345',name:'Real Person',original_location:'',request_paper:'maybe'}},null);
  expect(issues.map(i=>i.code).sort()).toEqual(['HN_INVALID','LN_INVALID','NAME_INVALID','ORIGINAL_LOCATION_REQUIRED','YES_NO_INVALID']);
 });
 it('cross-checks the PDF identity: HN/DOB/report date differences block, name/LN differences block (LAB-UAT-011)',()=>{
  const cells={ln:'2610100001',hn:'9901001',name:'SYNTHETIC A',dob:'1990-01-02',original_location:'CAB',report_date:'2025-12-01'};
  const p=(parsed:object)=>({fileId:'f',name:'f.pdf',sha256:'a'.repeat(64),parsed:{ln:'2610100001',hn:'9901001',name:'SYNTHETIC A',dob:'1990-01-02',reportedDate:'2025-12-01',...parsed}});
  expect(buildDraftData({rowNo:2,cells},p({})).issues).toEqual([]);
  expect(buildDraftData({rowNo:2,cells},p({hn:'9909999'})).issues).toEqual([{code:'PDF_HN_MISMATCH',severity:'ERROR',field:'pdf_file'}]);
  expect(buildDraftData({rowNo:2,cells},p({hn:'0009901001'})).issues).toEqual([]);   // leading zeros are not identity
  expect(buildDraftData({rowNo:2,cells},p({dob:'1990-01-03'})).issues[0].code).toBe('PDF_DOB_MISMATCH');
  expect(buildDraftData({rowNo:2,cells},p({reportedDate:'2026-02-01'})).issues[0]).toMatchObject({code:'PDF_REPORT_DATE_MISMATCH',severity:'ERROR'});
  expect(buildDraftData({rowNo:2,cells},p({name:'Other'})).issues).toEqual([{code:'PDF_NAME_DIFFERS',severity:'ERROR',field:'pdf_file'}]);
  expect(buildDraftData({rowNo:2,cells},p({ln:'1'})).issues).toEqual([{code:'PDF_LN_DIFFERS',severity:'ERROR',field:'pdf_file'}]);
  expect(buildDraftData({rowNo:2,cells},{...p({}),parsed:null}).issues).toEqual([{code:'PDF_CONTENT_NOT_READ',severity:'ERROR',field:'pdf_file'}]);
 });
});
