import {monthDate,yearDate,UNKNOWN_DATE,parseLegacyDate,type HistoricalDate} from './dates';
import {notInEvidence,present,presentOrAbsent,type EvidenceValue,type HistoricalFacts,type PastCertification} from './evidence';
import type {EvidenceItem,HistoricalEvent} from './types';
import type {ColumnKey,TableRow} from './table';
import {excelSerialToIso} from './table';
import {syntheticText} from '../p2/schema';
import {SYNTHETIC_NUMERIC_HN} from '../integrations/pet';

/** Pure conversion of one spreadsheet row (+ its matched PDF) into the draft data the background mechanisms work on (Plan §4.8 H2). */
export type RowIssue={code:string;severity:'ERROR'|'WARN';field?:string;ref?:string};
export type PdfInfo={fileId:string;name:string;sha256:string;parsed:{ln:string|null;hn:string|null;name:string|null;dob:string|null;reportedDate:string|null}|null};
export type DraftData={
 rowNo:number;ln:string;
 identifiers:{hn:string|null;name:string|null;dob:string|null};
 originalLocation:string|null;
 evidence:EvidenceItem[];events:HistoricalEvent[];
 facts:HistoricalFacts;pastCertification:PastCertification;
 pdf:{fileId:string;name:string;sha256:string}|null;
 completeness:{profile:string;status:'COMPLETE'|'PARTIAL';missing:string[]}|null;
};

const BLANK=new Set(['','-']);
const UNKNOWN_WORDS=new Set(['unknown','ไม่ทราบ','n/a']);
export type SheetDate={date:HistoricalDate|null;issue?:'DATE_FORMAT_INVALID'|'DATE_ERA_AMBIGUOUS'|'DATE_IMPOSSIBLE'|'DATE_OUT_OF_RANGE'};
/**
 * Spreadsheet date: blank = not provided (null); the word unknown = UNKNOWN (kept, fails closed later); YYYY-MM-DD, YYYY-MM, YYYY, DD-Mon-YYYY or an Excel serial.
 * Day-first numeric spellings (25/12/2025) and Buddhist-era years are refused with an error rather than guessed.
 */
export function parseSheetDate(raw:string|undefined):SheetDate{
 const s=(raw??'').trim();
 if(BLANK.has(s))return {date:null};
 if(UNKNOWN_WORDS.has(s.toLowerCase()))return {date:UNKNOWN_DATE};
 if(/^\d{5}$/.test(s)){const iso=excelSerialToIso(Number(s));if(iso)return parseSheetDate(iso);}
 let m=/^(\d{4})-(\d{2})$/.exec(s);
 if(m){if(Number(m[1])>=2400)return {date:null,issue:'DATE_ERA_AMBIGUOUS'};try{return {date:monthDate(Number(m[1]),Number(m[2]))};}catch{return {date:null,issue:'DATE_OUT_OF_RANGE'};}}
 m=/^(\d{4})$/.exec(s);
 if(m){if(Number(m[1])>=2400)return {date:null,issue:'DATE_ERA_AMBIGUOUS'};try{return {date:yearDate(Number(m[1]))};}catch{return {date:null,issue:'DATE_OUT_OF_RANGE'};}}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)&&!/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(s))return {date:null,issue:'DATE_FORMAT_INVALID'};
 const p=parseLegacyDate(s);
 if(p.issue==='AMBIGUOUS_YEAR_ERA')return {date:null,issue:'DATE_ERA_AMBIGUOUS'};
 if(p.issue==='IMPOSSIBLE_DATE')return {date:null,issue:'DATE_IMPOSSIBLE'};
 if(p.issue)return {date:null,issue:'DATE_OUT_OF_RANGE'};
 return {date:p.date};
}
export const dateText=(d:HistoricalDate)=>d.precision==='UNKNOWN'?'unknown':d.value;

const YES=new Set(['y','yes','ใช่','1','true','มี']),NO=new Set(['n','no','ไม่','0','false','ไม่มี']);
function yn(raw:string|undefined,field:string,issues:RowIssue[],src:string):EvidenceValue<boolean>{
 const s=(raw??'').trim().toLowerCase();
 if(BLANK.has(s))return notInEvidence();
 if(YES.has(s))return present(true,src);if(NO.has(s))return present(false,src);
 issues.push({code:'YES_NO_INVALID',severity:'ERROR',field});return notInEvidence();
}
const normHn=(v:string|null|undefined)=>(v??'').trim().replace(/^0+/,'');
const normName=(v:string|null|undefined)=>(v??'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();

/** PDF matching: the sheet's file name first, else exactly one PDF whose own LN equals the row LN. Pure; returns what it found and why not. */
export function matchPdf(pdfName:string,ln:string,files:readonly PdfInfo[]):{pdf:PdfInfo|null;issue?:RowIssue}{
 const want=pdfName.trim().toLowerCase();
 if(want){
  const hits=files.filter(f=>f.name.toLowerCase()===want);
  if(hits.length===1)return {pdf:hits[0]};
  return {pdf:null,issue:{code:hits.length?'PDF_NAME_AMBIGUOUS':'PDF_FILE_NOT_FOUND',severity:'ERROR',field:'pdf_file'}};
 }
 const byLn=files.filter(f=>f.parsed?.ln&&f.parsed.ln===ln);
 if(byLn.length===1)return {pdf:byLn[0]};
 if(byLn.length>1)return {pdf:null,issue:{code:'PDF_MATCH_AMBIGUOUS',severity:'ERROR',field:'pdf_file'}};
 return {pdf:null};
}

export function buildDraftData(row:TableRow,pdf:PdfInfo|null):{data:DraftData;issues:RowIssue[]}{
 const c=(k:ColumnKey)=>(row.cells[k]??'').trim();
 const issues:RowIssue[]=[];
 const src=`row-${row.rowNo}-sheet`;
 const ln=c('ln');
 if(!/^[0-9]{1,40}$/.test(ln))issues.push({code:'LN_INVALID',severity:'ERROR',field:'ln'});
 const hn=c('hn');
 if(!SYNTHETIC_NUMERIC_HN.test(hn))issues.push({code:'HN_INVALID',severity:'ERROR',field:'hn'});
 const name=c('name');
 if(!name||!syntheticText.safeParse(name).success)issues.push({code:'NAME_INVALID',severity:'ERROR',field:'name'});
 const location=c('original_location');
 if(!location)issues.push({code:'ORIGINAL_LOCATION_REQUIRED',severity:'ERROR',field:'original_location'});

 const date=(k:ColumnKey)=>{const d=parseSheetDate(c(k));if(d.issue)issues.push({code:d.issue,severity:'ERROR',field:k});return d.date;};
 const dob=date('dob');
 if(dob&&dob.precision!=='DAY')issues.push({code:'DOB_NEEDS_FULL_DATE',severity:'ERROR',field:'dob'});
 const collection=date('collection_date'),receipt=date('receipt_date'),report=date('report_date'),control=date('control_record_date'),requestDate=date('request_date'),consentDate=date('consent_date');

 const evidence:EvidenceItem[]=[];const events:HistoricalEvent[]=[];
 const item=(over:Partial<EvidenceItem>&Pick<EvidenceItem,'id'|'kind'|'documentDate'|'provenance'>):EvidenceItem=>({originalLocation:location||null,appears:null,fileSha256:null,sourceRef:null,...over});
 const reportItem=report!==null||pdf!==null;
 if(reportItem)evidence.push(item({id:`r${row.rowNo}-report`,kind:'FINAL_RESULT_REPORT',documentDate:report??UNKNOWN_DATE,provenance:pdf?'ELECTRONIC_ORIGINAL_PDF':'PAPER_ORIGINAL',fileSha256:pdf?.sha256??null,sourceRef:pdf?.name??null}));
 if(control!==null)evidence.push(item({id:`r${row.rowNo}-control`,kind:'LAB_CONTROL_RECORD',documentDate:control,provenance:'PAPER_ORIGINAL'}));
 const requestPaper=yn(c('request_paper'),'request_paper',issues,src),consentPaper=yn(c('consent_paper'),'consent_paper',issues,src);
 if(requestPaper.state==='PRESENT'&&requestPaper.value)evidence.push(item({id:`r${row.rowNo}-request`,kind:'REQUEST_PAPER',documentDate:requestDate??UNKNOWN_DATE,provenance:'PAPER_ORIGINAL'}));
 const decision=presentOrAbsent(c('consent_decision'),src);
 if(consentPaper.state==='PRESENT'&&consentPaper.value)evidence.push(item({id:`r${row.rowNo}-consent`,kind:'CONSENT_PAPER',documentDate:consentDate??UNKNOWN_DATE,provenance:'PAPER_ORIGINAL',appears:decision.state==='PRESENT'?decision.value:null}));
 const ev=(id:string,type:HistoricalEvent['type'],d:HistoricalDate|null,evidenceItemId:string|null)=>{if(d)events.push({id:`r${row.rowNo}-${id}`,type,date:d,evidenceItemId});};
 ev('collection','COLLECTION',collection,null);ev('receipt','RECEIPT',receipt,null);ev('report','REPORT',report,reportItem?`r${row.rowNo}-report`:null);

 const certText=c('past_certification');
 const pastCertification:PastCertification=certText?{state:'AS_WRITTEN',text:certText.slice(0,200),evidenceItemId:`r${row.rowNo}-report`}:{state:'NOT_IN_EVIDENCE'};
 const facts:HistoricalFacts={
  hn:presentOrAbsent(hn,src),name:presentOrAbsent(name,src),dob:dob&&dob.precision==='DAY'?present(dob.value,src):notInEvidence(),originalLocation:presentOrAbsent(location,src),
  collectionDate:collection?present(dateText(collection),src):notInEvidence(),reportDate:report?present(dateText(report),src):notInEvidence(),
  requestPaperPresent:requestPaper,consentPaperPresent:consentPaper,consentDecisionAsWritten:decision,
  pregnancyType:presentOrAbsent(c('pregnancy_type'),src),resultPdf:pdf?present(pdf.name,`r${row.rowNo}-report`):notInEvidence(),
 };

 // Identity-in-file check (Plan §11.11: file identity against the case; HN alone never decides). HN/DOB/report-date differences block; name/LN differences warn.
 if(pdf?.parsed){
  const p=pdf.parsed;
  if(p.hn&&normHn(p.hn)!==normHn(hn))issues.push({code:'PDF_HN_MISMATCH',severity:'ERROR',field:'pdf_file'});
  if(p.dob&&dob&&dob.precision==='DAY'){const pd=parseLegacyDate(p.dob).date;if(pd.precision==='DAY'&&pd.value!==dob.value)issues.push({code:'PDF_DOB_MISMATCH',severity:'ERROR',field:'pdf_file'});}
  if(p.reportedDate&&report&&report.precision==='DAY'){const pr=parseLegacyDate(p.reportedDate).date;if(pr.precision==='DAY'&&pr.value!==report.value)issues.push({code:'PDF_REPORT_DATE_MISMATCH',severity:'ERROR',field:'report_date'});}
  if(p.name&&normName(p.name)!==normName(name))issues.push({code:'PDF_NAME_DIFFERS',severity:'WARN',field:'pdf_file'});
  if(p.ln&&p.ln!==ln)issues.push({code:'PDF_LN_DIFFERS',severity:'WARN',field:'pdf_file'});
 }else if(pdf)issues.push({code:'PDF_CONTENT_NOT_READ',severity:'WARN',field:'pdf_file'});

 return {data:{rowNo:row.rowNo,ln,identifiers:{hn:hn||null,name:name||null,dob:dob&&dob.precision==='DAY'?dob.value:null},originalLocation:location||null,evidence,events,facts,pastCertification,pdf:pdf?{fileId:pdf.fileId,name:pdf.name,sha256:pdf.sha256}:null,completeness:null},issues};
}
