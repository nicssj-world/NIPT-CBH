import type {Queryable} from '../db/connection';
import {currentPetPatientJoin} from '../anc/current-patient';
/**
 * Owner-confirmed external Final PDF file name: it carries the HIS LN and the patient's name. Both are identity evidence, checked together with
 * the content of the PDF (Lab Number, HN, printed name) and the patient name received from PET. A mismatch can never auto-link, and missing
 * evidence is "unverified" (manual review), never a silent pass. Pure: no clock, database or file access.
 */
export type Cmp='MATCH'|'MISMATCH'|'NOT_AVAILABLE';
export type PdfIdentityEvidence={status:'MATCH'|'CONFLICT'|'UNVERIFIED';reasons:string[];checks:{fileLnHis:Cmp;fileName:Cmp;pdfName:Cmp}};
export type FileIdentity={lnHis:string|null;lnAmbiguous:boolean;name:string|null};
// Thai titles are written attached to the given name ("นางสาวสมหญิง"), so they are removed as prefixes, longest first ("นางสาว" before "นาง").
// English titles only count as a whole token: "Mr" is a title, "Mrak" is a name.
const THAI_TITLES=['เด็กหญิง','เด็กชาย','นางสาว','นาง','นาย'],ENGLISH_TITLES=['miss','mrs','mr','ms'];
const strip=(s:string)=>s.normalize('NFC').replace(/[​-‍﻿]/g,'');
function dropTitle(token:string){
 if(ENGLISH_TITLES.includes(token.toLowerCase().replace(/\.$/,'')))return '';
 for(const t of THAI_TITLES)if(token.startsWith(t))return token.slice(t.length);
 return token;
}
/** Tokens of a person's name without titles, punctuation and case; digits are never part of a name. */
export function nameTokens(raw:string|null|undefined){
 if(!raw)return [];
 // Dotted abbreviations (น.ส. / ด.ช. / ด.ญ.) lose their dots to the punctuation rule below, so they are removed first.
 const tokens=strip(raw).replace(/^\s*(?:น\.\s?ส\.?|นส\.|ด\.\s?ช\.?|ด\.\s?ญ\.?)\s*/,' ').replace(/[_,.;:()[\]{}"'`-]+/g,' ').split(/\s+/).filter(Boolean);
 const out:string[]=[];
 for(const token of tokens){const bare=dropTitle(token).replace(/[^\p{L}\p{M}]+/gu,'').toLowerCase();if(bare)out.push(bare);}
 return out;
}
/** Same person: identical tokens in any order, or identical letters once spacing (given name / surname split) is ignored. */
export function namesAgree(a:string|null|undefined,b:string|null|undefined){
 const x=nameTokens(a),y=nameTokens(b);if(!x.length||!y.length)return false;
 return [...x].sort().join(' ')===[...y].sort().join(' ')||x.join('')===y.join('');
}
const digitsOf=(v:string|null|undefined)=>(v??'').replace(/\D/g,'');
/** `<LN HIS> <name>.pdf` in any separator style. A 10-13 digit run is the HIS LN (10 digits in production); other digit runs (HN, dates) are ignored in the name. */
export function parsePdfFileName(fileName:string|null|undefined):FileIdentity{
 if(!fileName)return {lnHis:null,lnAmbiguous:false,name:null};
 const base=strip(fileName).split(/[\\/]/).pop()!.replace(/\.pdf$/i,'');
 const lns=[...new Set([...base.matchAll(/(?<!\d)(\d{10,13})(?!\d)/g)].map(m=>m[1]))];
 const rest=base.replace(/\d+/g,' ').replace(/_+/g,' ').replace(/\s+/g,' ').trim(),name=nameTokens(rest).length?rest:null;
 return {lnHis:lns.length===1?lns[0]:null,lnAmbiguous:lns.length>1,name};
}
export function verifyPdfIdentity(input:{fileName:string|null;pdfName:string|null;target:{ln:string;patientName:string|null}}):PdfIdentityEvidence{
 const file=parsePdfFileName(input.fileName),reasons:string[]=[];
 const fileLnHis:Cmp=file.lnAmbiguous?'MISMATCH':!file.lnHis?'NOT_AVAILABLE':file.lnHis===digitsOf(input.target.ln)?'MATCH':'MISMATCH';
 const known=!!input.target.patientName&&nameTokens(input.target.patientName).length>0;
 // Without the HIS LN the file name is not in the Owner's "<LN HIS> <name>" format, so its text is not read as a person's name.
 const fileName:Cmp=!file.lnHis||!file.name||!known?'NOT_AVAILABLE':namesAgree(file.name,input.target.patientName)?'MATCH':'MISMATCH';
 const pdfName:Cmp=!input.pdfName||!known?'NOT_AVAILABLE':namesAgree(input.pdfName,input.target.patientName)?'MATCH':'MISMATCH';
 if(file.lnAmbiguous)reasons.push('FILE_LN_HIS_AMBIGUOUS');else if(fileLnHis==='MISMATCH')reasons.push('FILE_LN_HIS_MISMATCH');else if(fileLnHis==='NOT_AVAILABLE')reasons.push('FILE_LN_HIS_MISSING');
 if(fileName==='MISMATCH')reasons.push('FILE_NAME_MISMATCH');else if(fileName==='NOT_AVAILABLE'&&file.lnHis)reasons.push(file.name?'PATIENT_NAME_UNAVAILABLE':'FILE_NAME_MISSING');
 if(pdfName==='MISMATCH')reasons.push('PDF_NAME_MISMATCH');
 const checks={fileLnHis,fileName,pdfName};
 if([fileLnHis,fileName,pdfName].includes('MISMATCH'))return {status:'CONFLICT',reasons,checks};
 return {status:fileLnHis==='MATCH'&&fileName==='MATCH'?'MATCH':'UNVERIFIED',reasons,checks};
}
/** Current patient name per case: the applied PET when present, otherwise the ANC projection, exactly like the ANC screens. */
export async function currentPatientNames(db:Queryable,caseIds:readonly string[]){
 const out=new Map<string,string|null>();if(!caseIds.length)return out;
 const rows=(await db.query<{caseId:string;name:string|null}>(`SELECT c.id "caseId",CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.name ELSE anc_patient.name END name
  FROM nipt_case c LEFT JOIN p2_case_identity i ON i.case_id=c.id ${currentPetPatientJoin}
  LEFT JOIN LATERAL anc_workspace_patient(c.id) anc_patient ON true WHERE c.id=ANY($1::uuid[])`,[[...new Set(caseIds)]])).rows;
 for(const r of rows)out.set(r.caseId,r.name);return out;
}
