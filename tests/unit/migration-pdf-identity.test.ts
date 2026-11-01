import {it,expect} from 'vitest';
import {parseReport} from '../../packages/results/parser';
import {parsePdfFileName,namesAgree,nameTokens,verifyPdfIdentity} from '../../packages/migration/pdf-identity';
import {matchMigrationPdf} from '../../packages/migration/bulk-pdf';
// Synthetic names only. The Owner-confirmed external file name is "<LN HIS> <name>.pdf".
const target=(patientName:string|null)=>({recordId:'r',caseId:'c',roundId:'ro',attemptId:'a2',ln:'9900000001',lnHalos:'26B261014027',sampleRaw:'26B261014027-2',attemptNumber:2,hn:'000123',current:true,qualified:true,patientName});
const pdf=(name?:string)=>parseReport(`Lab No. (LN): 26B261014027-2 HN: 123\nPatient Name: ${name??'สมหญิง ทดสอบ'} Gestational Age: 15 Weeks 3 Day(s)`);
it('reads LN HIS and name from separators, extension, titles and extra digit runs',()=>{
 expect(parsePdfFileName('9900000001_สมหญิง ทดสอบ.pdf')).toEqual({lnHis:'9900000001',lnAmbiguous:false,name:'สมหญิง ทดสอบ'});
 expect(parsePdfFileName('C:\\share\\9900000001 - น.ส.สมหญิง_ทดสอบ - 000123.PDF')).toMatchObject({lnHis:'9900000001',name:expect.stringContaining('สมหญิง')});
 expect(parsePdfFileName('9900000001 9900000002 สมหญิง.pdf')).toMatchObject({lnHis:null,lnAmbiguous:true});
 expect(parsePdfFileName('final-report.pdf')).toEqual({lnHis:null,lnAmbiguous:false,name:'final-report'});
 expect(parsePdfFileName('990000001.pdf').lnHis).toBeNull();expect(parsePdfFileName('99000000200123 x.pdf').lnHis).toBeNull();
 expect(parsePdfFileName(null)).toEqual({lnHis:null,lnAmbiguous:false,name:null});
});
it('compares names across titles, spacing, case, order and Thai normalization without merging different people',()=>{
 expect(namesAgree('นางสาว สมหญิง ทดสอบ','สมหญิงทดสอบ')).toBe(true);
 expect(namesAgree('น.ส. สมหญิง  ทดสอบ','นางสาวสมหญิง ทดสอบ')).toBe(true);
 expect(namesAgree('ทดสอบ สมหญิง','สมหญิง ทดสอบ')).toBe(true);
 expect(namesAgree('Mrs. Somying Test','SOMYING TEST')).toBe(true);
 expect(namesAgree('Mrak Test','Test Mrak')).toBe(true);
 expect(nameTokens('Mrak')).toEqual(['mrak']);
 expect(namesAgree('สมหญิง ทดสอบ','สมหญิง ทดลอง')).toBe(false);
 expect(namesAgree('สมหญิง','สมหญิง ทดสอบ')).toBe(false);
 expect(namesAgree(null,'สมหญิง')).toBe(false);
 expect(namesAgree('','')).toBe(false);
});
it('requires HIS LN and name evidence; any contradiction is a conflict, missing evidence is unverified',()=>{
 const t={ln:'9900000001',patientName:'นางสาว สมหญิง ทดสอบ'},ok='9900000001 สมหญิง ทดสอบ.pdf';
 expect(verifyPdfIdentity({fileName:ok,pdfName:'สมหญิง ทดสอบ',target:t})).toMatchObject({status:'MATCH',reasons:[]});
 expect(verifyPdfIdentity({fileName:ok,pdfName:null,target:t}).status).toBe('MATCH');
 expect(verifyPdfIdentity({fileName:'9900000002 สมหญิง ทดสอบ.pdf',pdfName:null,target:t})).toMatchObject({status:'CONFLICT',reasons:['FILE_LN_HIS_MISMATCH']});
 expect(verifyPdfIdentity({fileName:'9900000001 สมศรี ทดสอบ.pdf',pdfName:null,target:t})).toMatchObject({status:'CONFLICT',reasons:['FILE_NAME_MISMATCH']});
 expect(verifyPdfIdentity({fileName:ok,pdfName:'สมศรี ทดสอบ',target:t})).toMatchObject({status:'CONFLICT',reasons:['PDF_NAME_MISMATCH']});
 expect(verifyPdfIdentity({fileName:'9900000001 9900000002 สมหญิง.pdf',pdfName:null,target:t}).reasons).toContain('FILE_LN_HIS_AMBIGUOUS');
 expect(verifyPdfIdentity({fileName:'report.pdf',pdfName:null,target:t})).toMatchObject({status:'UNVERIFIED',reasons:['FILE_LN_HIS_MISSING']});
 expect(verifyPdfIdentity({fileName:ok,pdfName:null,target:{ln:'9900000001',patientName:null}})).toMatchObject({status:'UNVERIFIED',reasons:['PATIENT_NAME_UNAVAILABLE']});
 expect(verifyPdfIdentity({fileName:'9900000001.pdf',pdfName:null,target:t})).toMatchObject({status:'UNVERIFIED',reasons:['FILE_NAME_MISSING']});
});
it('auto-matches only when content, file name and PET name agree; Re-Library binds the -2 final attempt and never -1',()=>{
 const ok='9900000001 สมหญิง ทดสอบ.pdf',t=target('นางสาว สมหญิง ทดสอบ');
 expect(matchMigrationPdf(pdf(),[t],ok).match?.attemptId).toBe('a2');
 expect(matchMigrationPdf(parseReport('Lab No. (LN): 26B261014027-1 HN: 123'),[t],ok)).toMatchObject({match:null,reason:'PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED'});
 expect(matchMigrationPdf(parseReport('Lab No. (LN): 26B261014027-2 HN: 999'),[t],ok).match).toBeNull();
 expect(matchMigrationPdf(pdf(),[t,{...t,recordId:'other'}],ok)).toMatchObject({match:null,reason:'AMBIGUOUS_PDF_IDENTITY'});
 expect(matchMigrationPdf(pdf(),[t],'9900000009 สมหญิง ทดสอบ.pdf')).toMatchObject({match:null,reason:'PDF_IDENTITY_CONFLICT'});
 expect(matchMigrationPdf(pdf(),[t],'9900000001 สมศรี ทดสอบ.pdf')).toMatchObject({match:null,reason:'PDF_IDENTITY_CONFLICT'});
 expect(matchMigrationPdf(pdf('สมศรี ทดสอบ'),[t],ok)).toMatchObject({match:null,reason:'PDF_IDENTITY_CONFLICT'});
 expect(matchMigrationPdf(pdf(),[t],'plain.pdf')).toMatchObject({match:null,reason:'PDF_IDENTITY_UNVERIFIED'});
 expect(matchMigrationPdf(pdf(),[target(null)],ok)).toMatchObject({match:null,reason:'PDF_IDENTITY_UNVERIFIED'});
});
