import {it,expect} from 'vitest';
import {extract} from '../../packages/results/extract';
import {parseReport,isNoCallReport,missingRequired} from '../../packages/results/parser';
import {syntheticReportPdf,syntheticPdf,reportText} from '../../tools/his-simulator/result-pdf';

const identity={labNumber:'26B261023001R-1',hn:'00007701/69',name:'SYNTHETIC NOCALL PATIENT',collection:'23-Oct-2026',received:'23-Oct-2026',dob:'31-Mar-1996',reported:'24-Oct-2026'};
const parsePdf=async(bytes:Buffer)=>{const x=await extract(bytes);if(x.container!=='PDF')throw Error('PDF_REQUIRED');return parseReport(x.text);};

it.each(['SINGLETON','TWIN'] as const)('actual PDF extraction recognizes Result = No Call using the existing %s structure and raw identity',async kind=>{
 const p=await parsePdf(syntheticReportPdf({kind,...identity,result:'No Call',qc:'FAIL'}));
 expect(p.templateKind).toBe(kind);expect(isNoCallReport(p)).toBe(true);expect(p.results.result).toEqual({value:'No Call',raw:'Result = No Call',method:'ANCHORED'});
 expect(p.identifiers.labNumber.value).toBe(identity.labNumber);expect(p.identifiers.hn).toMatchObject({value:identity.hn,method:'ANCHORED'});expect(p.identifiers.dob.value).toBe('1996-03-31');expect(p.identifiers.collectionDate.value).toBe('2026-10-23');expect(p.identifiers.reportedDate.value).toBe('2026-10-24');
 expect(p.results.qc).toEqual({value:'FAIL',raw:'RESULTS QC: FAIL',method:'ANCHORED'});expect(p.needsManualReview).toBe(true);expect(missingRequired(p)).toEqual([]);
 for(const key of ['t21','t18','t13','fetalFraction'] as const)expect(p.results[key]).toMatchObject({value:null,method:'UNREADABLE'});
});
it('preserves actual PASS only when present in the PDF; absent or nonstandard QC remains missing',async()=>{
 const pass=await parsePdf(syntheticReportPdf({kind:'SINGLETON',...identity,result:'No Call',qc:'PASS'}));expect(pass.results.qc.value).toBe('PASS');
 const missing=await parsePdf(syntheticReportPdf({kind:'SINGLETON',...identity,result:'No Call'}));expect(missing.results.qc).toMatchObject({value:null,method:'UNREADABLE'});expect(missingRequired(missing)).toEqual(['qc']);
 const other=await parsePdf(syntheticReportPdf({kind:'SINGLETON',...identity,result:'No Call',qc:'UNKNOWN'}));expect(other.results.qc.value).toBe('UNKNOWN');expect(missingRequired(other)).toEqual(['qc']);
});
it('does not infer No Call from filename, prose, malformed field, absent normal structure or duplicate outcome anchors',async()=>{
 const lines=reportText({kind:'SINGLETON',...identity,result:'No Call',qc:'FAIL'});
 for(const change of ['No Call was discussed','Result = No Call pending','Result = No-Call','Previous Result = No Call']){
  const p=await parsePdf(syntheticPdf(lines.map(l=>l==='Result = No Call'?change:l)));expect(isNoCallReport(p)).toBe(false);
 }
 const noStructure=parseReport('Result = No Call\nRESULTS QC: FAIL','normal.pdf');expect(noStructure.templateKind).toBe('UNKNOWN');expect(isNoCallReport(noStructure)).toBe(false);
 const duplicate=await parsePdf(syntheticPdf([...lines,'Result = Low Risk']));expect(duplicate.results.result).toMatchObject({value:null,method:'UNREADABLE'});expect(isNoCallReport(duplicate)).toBe(false);
 const normal=parseReport(reportText({kind:'SINGLETON',...identity}).join('\n'),'No Call.pdf');expect(isNoCallReport(normal)).toBe(false);expect(normal.results.t21.value).toBe('Low Risk');
 const conflictingNormal=parseReport([...reportText({kind:'SINGLETON',...identity,qc:'PASS'}),'Result: No Call','Result: Low Risk'].join('\n'));
 expect(missingRequired(conflictingNormal)).toContain('result');expect(conflictingNormal.needsManualReview).toBe(true);
});
