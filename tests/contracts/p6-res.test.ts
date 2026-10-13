import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import fc from 'fast-check';
import {serializeSyntheticRes, syntheticProfile, pdfFilename, verifySyntheticRes, type SyntheticResInput} from '../../packages/p6/res';
import goldens from '../fixtures/p6/legacy-goldens.json';

type Golden = Omit<typeof goldens.fixtures[number], 'order'|'result'> & {order:SyntheticResInput['order'];result:SyntheticResInput['result']};
const fixtures = goldens.fixtures as Golden[];
const base = fixtures[0];
export function inputFor(f = base): SyntheticResInput {
  return {order: f.order, result: f.result, generatedAt: f.generatedAt, approvedAt: f.approvedAt, certifierHisId: 'SYNTHETIC^SYNTHETIC'};
}
export function profileFor(f = base) {
  return {...syntheticProfile, style: f.settings.nipt_result_style as 'full'|'short'|'fixed', wardName: f.settings.hl7_ward_name, pdfTemplate: f.settings.pdf_template,cfsText:f.settings.nipt_result_text};
}
describe('P6 pinned legacy byte parity (synthetic source oracle only)', () => {
  it('pins oracle provenance and expected exhaustive synthetic corpus size',()=>{
    expect(goldens.syntheticOnly).toBe(true);expect(goldens.entryCounts).toEqual([7073,606]);
    expect(goldens.fixtures).toHaveLength(492);expect(goldens.pdfFixtures).toHaveLength(7);
    expect(goldens.archives).toEqual({'NIPTY.zip':'ec54193058f43540180fe1b006d286a6a8bfa17b9d99580329fa9b164fae99e8','NIPTY_handover.zip':'332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c'});
    expect(Object.fromEntries(Object.entries(goldens.sourceHashes).map(([k,v])=>[k,v.replaceAll(':','')]))).toEqual({
      'services/result_text.py':'629b433e980495d21fda93fec86a4f6c53b3fc4fc8b301d373f27dd2d9f5ad91',
      'services/res_generator.py':'cdef6943:92003270:6e36a55d:0a5cd143:3ec61551:1e3f0cb0:e94a6275:d6e8efe4'.replaceAll(':',''),
      'services/pdf_exporter.py':'f44655e129aec274f0a4cd20943caf8177ac3657f8eac38b22cb2c8629980ebd',
      'routes/export_routes.py':'99b8c60765b6b202e6ddfb02bb64c777224073d4a654f8ab49c5f730c330d131',
    });
  });
  it.each(goldens.pdfFixtures)('legacy configurable PDF template $template -> $expected', f=>{
    expect(pdfFilename(f.order.hn,f.order.ln,f.sequence,f.template)).toBe(f.expected);
  });
  it.each(fixtures)('$id', f => {
    const actual = serializeSyntheticRes(inputFor(f), profileFor(f));
    expect(actual.filename).toBe(f.resName);
    expect(actual.bytes.toString('hex')).toBe(f.wireHex);
    expect(createHash('sha256').update(actual.bytes).digest('hex')).toBe(f.sha256.replaceAll(':',''));
    expect(actual.ok.toString('hex')).toBe(goldens.okHex);
    expect(pdfFilename(f.order.hn, f.order.ln, f.sequence, f.settings.pdf_template)).toBe(f.pdfName);
    expect(serializeSyntheticRes(inputFor(f), profileFor(f))).toEqual(actual);
    expect(verifySyntheticRes(actual.bytes, inputFor(f), profileFor(f))).toBeUndefined();
  });
  it('keeps profile values versioned and configurable without changing P1', () => {
    const profile = {...syntheticProfile, sender:'SYNTHETIC', receiver:'SIMULATOR', testCode:'99999', specimenCode:'3', o18:'8', accessionSuffix:'119', wardId:'302', resultFlag:'N'};
    const r = serializeSyntheticRes(inputFor(), profile).bytes.subarray(2).toString('utf16le').split('\r').map(x=>x.split('|'));
    expect([r[0][4],r[0][9],r[2][4],r[2][15],r[2][18],r[3][6],r[3][10],r[3][11]]).toEqual(['SYNTHETIC','SIMULATOR','^^^99999^B^0','3','8','N','SYNTHETIC^SYNTHETIC',base.order.ln+'119']);
    expect(readFileSync(new URL('../../packages/integrations/res.ts', import.meta.url),'utf8')).not.toContain('packages/p6');
  });
  it('uses CR only and rejects malformed encoding, record structure and profile/content mismatch', () => {
    const {bytes} = serializeSyntheticRes(inputFor(), profileFor());
    const mutate = (f:(s:string)=>string) => Buffer.concat([Buffer.from([255,254]), Buffer.from(f(bytes.subarray(2).toString('utf16le')),'utf16le')]);
    for(const bad of [bytes.subarray(2),Buffer.concat([bytes,Buffer.from([0])]),Buffer.from([255,254,0,216]),mutate(s=>s.replace(/\r/g,'\r\n')),mutate(s=>s.replace('L|1|N','L|1|X')),mutate(s=>s.replace('CIT5K','OTHER')),mutate(s=>s.replace('^^^70096','^^^99999'))]) {
      expect(()=>verifySyntheticRes(bad,inputFor(),profileFor())).toThrow();
    }
  });
  it('never truncates R[3] or invents low risk for unrecognized values', () => {
    const source = inputFor(fixtures[6]);
    const length = serializeSyntheticRes(source,profileFor()).bytes.subarray(2).toString('utf16le').split('\r')[3].split('|')[3].length;
    expect(()=>serializeSyntheticRes(source,{...profileFor(),maxResultCodeUnits:length})).not.toThrow();
    expect(()=>serializeSyntheticRes(source,{...profileFor(),maxResultCodeUnits:length-1})).toThrow('R3_TOO_LONG');
    expect(()=>serializeSyntheticRes({...source,result:{t21:'Unreadable',t18:'Low Risk',t13:'Low Risk'}},profileFor())).toThrow('INVALID_RESULT');
    expect(()=>serializeSyntheticRes({...source,result:{result_type:' redraw_notice '}},profileFor())).toThrow('INVALID_RESULT');
  });
  it.each(['\rR|INJECT','\n','\0','\ud800','\udfff'])('rejects structural/encoding input %j', value => {
    expect(()=>serializeSyntheticRes({...inputFor(),order:{...base.order,dspname:'SYNTHETIC'+value}},profileFor())).toThrow();
  });
  it.each([
    {order:{...base.order,ln:'12345'}}, {order:{...base.order,hn:'REAL-HN'}},
    {order:{...base.order,dob:'20000230'}}, {generatedAt:'20260230000000'},
    {generatedAt:'20261011240000'}, {approvedAt:'invalid'},
    {order:{...base.order,specimen_date:'invalid'}}, {certifierHisId:'real^real'},
    {order:{...base.order,sex:'invalid'}},
  ])('rejects invalid or non-synthetic inputs %#', patch => {
    expect(()=>serializeSyntheticRes({...inputFor(),...patch} as SyntheticResInput,profileFor())).toThrow();
  });
  it('rejects unsafe or unresolved profile and PDF names', () => {
    for(const patch of [{sender:'x|P'}, {accessionSuffix:'../'}, {maxResultCodeUnits:0}, {syntheticOnly:false}, {version:''}, {style:'other'}, {wardName:'\ud800'}])expect(()=>serializeSyntheticRes(inputFor(),{...profileFor(),...patch} as typeof syntheticProfile)).toThrow();
    for(const n of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>pdfFilename(base.order.hn,base.order.ln,n)).toThrow();
    for(const template of ['../N_HN__LN','N_HN__LN\0','N_HN__LN.pdf','N_HN__LN/other'])expect(()=>pdfFilename(base.order.hn,base.order.ln,1,template)).toThrow();
  });
  it('delimiter escaping is byte exact for arbitrary synthetic strings', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('|','^','~','&','\\','ก','A','😀'),{maxLength:40}),chars=>{
      const value='SYNTHETIC'+chars.join('');
      const x={...inputFor(),order:{...base.order,dspname:`นาง ${value}  SYNTHETIC`}};
      const bytes=serializeSyntheticRes(x,profileFor()).bytes;
      expect(()=>verifySyntheticRes(bytes,x,profileFor())).not.toThrow();
      expect(bytes.subarray(2).toString('utf16le').split('\r').slice(0,-1).map(r=>r.split('|').length)).toEqual([14,35,26,12,3]);
    }),{numRuns:100});
  });
});
