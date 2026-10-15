import {describe,it,expect} from 'vitest';
import {syntheticReportPdf,syntheticPdf,syntheticZip,zipAsPdf,reportText} from '../../tools/his-simulator/result-pdf';
import {extract,screen,QuarantineError} from '../../packages/results/extract';
import {zipEntries,ZipError,ZIP_LIMITS} from '../../packages/results/zip';
import {parseReport,missingRequired,isoDate,PARSER_VERSION} from '../../packages/results/parser';

const base={labNumber:'26B261010001-1',hn:'990000000123',collection:'10-Oct-2026'};
const text=async(b:Buffer)=>{const x=await extract(b);if(x.container==='ZIP_BATCH')throw Error('batch');return x.text;};
describe('P5 parser (Plan §11.2, §11.4; AT-RES-02/03)',()=>{
 it('preserves the slash year and leading zeroes of an operational HN in anchored and fallback reports',async()=>{
  const p=parseReport(await text(syntheticReportPdf({kind:'SINGLETON',...base,hn:'00007701/69'})));
  expect(p.identifiers.hn).toMatchObject({value:'00007701/69',method:'ANCHORED'});
  expect(parseReport('HN: 00007701/69\n').identifiers.hn).toMatchObject({value:'00007701/69',method:'FALLBACK'});
 });
 it('singleton: anchored values, raw text, ISO dates, GA days, parser version',async()=>{
  const p=parseReport(await text(syntheticReportPdf({kind:'SINGLETON',...base})),'x.pdf');
  expect(p.templateKind).toBe('SINGLETON');expect(p.parserVersion).toBe(PARSER_VERSION);expect(p.templateVersion).toMatch(/UNAPPROVED-OD07/);
  expect(p.identifiers.hn).toMatchObject({value:'990000000123',method:'ANCHORED'});expect(p.identifiers.collectionDate.value).toBe('2026-10-10');expect(p.identifiers.dob.value).toBe('1996-03-31');
  expect(p.identifiers.gestationalAgeDays.value).toBe(86);expect(p.results.t21).toMatchObject({value:'Low Risk',method:'ANCHORED'});expect(p.results.t21.raw).toContain('TRISOMY 21');
  expect(p.results.fetalFraction.value).toBe(12.4);expect(p.results.qc.value).toBe('PASS');expect(p.needsManualReview).toBe(false);expect(missingRequired(p)).toEqual([]);
 });
 it('twin: T21/T18/T13 + Y chromosome; SCA is NOT_APPLICABLE, never unreadable (F-19)',async()=>{
  const p=parseReport(await text(syntheticReportPdf({kind:'TWIN',...base})));
  expect(p.templateKind).toBe('TWIN');expect(p.results.yChromosome.value).toBe('Detected');
  for(const k of ['xo','xxx','xxy','xyy','fetalSex'] as const)expect(p.results[k].method).toBe('NOT_APPLICABLE');
  expect(missingRequired(p)).toEqual([]);expect(p.abnormal).toBe(false);
 });
 it('redraw notice is classified separately and carries no result values',async()=>{
  const p=parseReport(await text(syntheticReportPdf({kind:'NOTICE',...base})));
  expect(p.templateKind).toBe('REDRAW_NOTICE');expect(p.noticeCategory).toBe('GREY_AREA');expect(p.results.t21.value).toBeNull();expect(p.identifiers.labNumber.value).toBe(base.labNumber);
 });
 it('unknown template is blocked as UNKNOWN',async()=>{expect(parseReport(await text(syntheticReportPdf({kind:'UNKNOWN',...base}))).templateKind).toBe('UNKNOWN');});
 it('unreadable SCA/QC stay UNREADABLE — never Normal, Not Detected or 0 (LOCKED §14)',async()=>{
  const p=parseReport(await text(syntheticReportPdf({kind:'SINGLETON',...base,omit:['sca','qc']})));
  for(const k of ['xo','xxx','xxy','xyy','fetalFraction','qc'] as const){expect(p.results[k].value).toBeNull();expect(p.results[k].method).toBe('UNREADABLE');}
  expect(missingRequired(p)).toEqual(['xo','xxx','xxy','xyy','fetalFraction','qc']);expect(p.needsManualReview).toBe(true);
 });
 it('positional fallback is FALLBACK and needs manual review (NIPTY Module 2 rule)',()=>{
  const lines=reportText({kind:'SINGLETON',...base,omit:['trisomy']});lines.push('Low Risk High Risk Low Risk');
  const p=parseReport(lines.join('\n'));expect(p.results.t18).toMatchObject({value:'High Risk',method:'FALLBACK'});expect(p.needsManualReview).toBe(true);expect(p.abnormal).toBe(true);
 });
 it('High risk / SCA Detected are flagged abnormal',async()=>{
  expect(parseReport(await text(syntheticReportPdf({kind:'SINGLETON',...base,sca:['Not Detected','Not Detected','Detected','Not Detected']}))).abnormal).toBe(true);
 });
 it('impossible dates keep raw text and become UNREADABLE (F-12)',()=>{
  expect(isoDate('31-Feb-2026')).toBeNull();expect(isoDate('05-May-2026')).toBe('2026-05-05');
  const p=parseReport(reportText({kind:'SINGLETON',...base,collection:'31-Feb-2026'}).join('\n'));expect(p.identifiers.collectionDate).toMatchObject({value:null,method:'UNREADABLE'});
 });
});
describe('P5 quarantine and containers (§11.1, F-08)',()=>{
 it('ZIP-as-PDF and batch ZIP are recognised by magic bytes, not extension',async()=>{
  expect((await extract(zipAsPdf({kind:'SINGLETON',...base}))).container).toBe('ZIP_AS_PDF');
  const batch=await extract(syntheticZip([{name:'a/one.pdf',data:syntheticReportPdf({kind:'SINGLETON',...base}),deflate:true},{name:'one (1).pdf',data:syntheticReportPdf({kind:'SINGLETON',...base})},{name:'readme.txt',data:Buffer.from('x')}]));
  expect(batch.container).toBe('ZIP_BATCH');if(batch.container==='ZIP_BATCH')expect(batch.members.map(m=>m.name)).toEqual(['one.pdf']);
 });
 it('rejects empty, oversized, non-PDF/ZIP and unreadable PDFs with explicit codes',async()=>{
  const code=(fn:()=>unknown)=>{try{fn();return 'OK';}catch(e){return (e as Error).message;}};
  expect(code(()=>screen(Buffer.alloc(0),10))).toBe('EMPTY_FILE');expect(code(()=>screen(Buffer.alloc(20,1),10))).toBe('FILE_TOO_LARGE');
  expect(code(()=>screen(Buffer.from('<html>not a pdf</html>'),1000))).toBe('NOT_PDF_OR_ZIP');
  await expect(extract(Buffer.from('%PDF-1.4\ngarbage'))).rejects.toBeInstanceOf(QuarantineError);
  await expect(extract(syntheticPdf([]))).rejects.toThrow('TEXT_NOT_EXTRACTABLE');
  await expect(extract(syntheticZip([{name:'x.bin',data:Buffer.from('x')}]))).rejects.toThrow('ZIP_HAS_NO_REPORT_TEXT');
 });
 it('ZIP reader refuses encryption, CRC mismatch and zip-bomb ratios',()=>{
  const good=syntheticZip([{name:'1.txt',data:Buffer.from('HN: 1')}]);
  const enc=Buffer.from(good);enc.writeUInt16LE(1,good.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))+8);expect(()=>zipEntries(enc)).toThrow('ZIP_ENCRYPTED');
  const bomb=syntheticZip([{name:'1.txt',data:Buffer.alloc(ZIP_LIMITS.ratio*1000,0x41),deflate:true}]);expect(()=>zipEntries(bomb)).toThrow(ZipError);
 });
 it('a corrupted member fails its CRC instead of being parsed',async()=>{
  const z=zipAsPdf({kind:'SINGLETON',...base});const at=z.indexOf(Buffer.from('Lab No.'));z[at]=0x4d;
  await expect(extract(z)).rejects.toThrow('ZIP_CRC_MISMATCH');
 });
});
