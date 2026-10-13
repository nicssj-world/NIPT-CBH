/** Pure, synthetic-only P6 wire contract. No filesystem, DB, worker or transport. */
import {z} from 'zod';
import {escapeWire, timestamp, resFilename, verifyRes} from '../integrations/res';
import {wireDate} from '../integrations/pet';

const malformedUtf16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const text = z.string().max(4096).refine(s => !/[\r\n\0]/.test(s) && !malformedUtf16.test(s), 'INVALID_TEXT');
const component = text.refine(s => /^[A-Za-z0-9_-]+$/.test(s), 'INVALID_COMPONENT');
const profileSchema = z.strictObject({
  syntheticOnly:z.literal(true), version:component, sender:component, receiver:component,
  testCode:component, specimenCode:component, o18:component, accessionSuffix:component,
  wardId:component, wardName:text, resultFlag:component,
  style:z.enum(['full','short','fixed']), cfsText:text, maxResultCodeUnits:z.number().int().positive().max(16384),
  pdfTemplate:text,
});
export type ResProfile = z.infer<typeof profileSchema>;
/** Reference values for fixture testing only; not an approved hospital RES profile. */
export const syntheticProfile: Readonly<ResProfile> = Object.freeze({
  syntheticOnly:true, version:'SYNTHETIC-LEGACY-1', sender:'CIT5K', receiver:'HOST', testCode:'70096',
  specimenCode:'2', o18:'7', accessionSuffix:'118', wardId:'301', wardName:'SYNTHETIC', resultFlag:'A',
  style:'fixed', cfsText:'ดูรายงานผลในโปรแกรม CFS', maxResultCodeUnits:4096, pdfTemplate:'N_HN__LN',
});
const orderSchema = z.strictObject({
  ln:text.refine(s=>/^0*99000\d+$/.test(s),'SYNTHETIC_ONLY'),
  hn:text.refine(s=>/^SYNTHETIC-[A-Za-z0-9_-]+$/.test(s),'SYNTHETIC_ONLY'),
  dspname:text.refine(s=>s.includes('SYNTHETIC'),'SYNTHETIC_ONLY'), dob:text, sex:z.enum(['F','M','U']), specimen_date:text,
});
const inputSchema = z.strictObject({
  order:orderSchema, generatedAt:text, approvedAt:text, certifierHisId:z.literal('SYNTHETIC^SYNTHETIC'),
  result:z.record(z.string(),text).nullable(),
});
export type SyntheticResInput = z.infer<typeof inputSchema>;

const triKeys=['t21','t18','t13'], triNames=['Trisomy 21','Trisomy 18','Trisomy 13'];
const scaKeys=['sex_xo','sex_xxx','sex_xxy','sex_xyy'], scaNames=['45,X','47,XXX','47,XXY','47,XYY'];
const join=(items:string[],word='and')=>items.length<2?(items[0]??''):items.length===2?items.join(` ${word} `):items.slice(0,-1).join(', ')+`, ${word} `+items.at(-1);

function resultText(result:SyntheticResInput['result'], profile:ResProfile) {
  // Preserve legacy wording/ordering/whitespace handling for recognized values. Arbitrary parser
  // strings are rejected: the legacy "all nonempty => Low risk" fallback is not clinical validation.
  if(result) {
    for(const [key,value] of Object.entries(result)) {
      const v=value.trim();
      if(triKeys.includes(key)&&v&&!['High','High Risk','Low','Low Risk'].includes(v))throw Error('INVALID_RESULT');
      if(scaKeys.includes(key)&&v&&!['Detected','Not Detected'].includes(v))throw Error('INVALID_RESULT');
      if(![...triKeys,...scaKeys,'result_type'].includes(key))throw Error('INVALID_RESULT');
      if(key==='result_type'&&!['','final','redraw_notice'].includes(value))throw Error('INVALID_RESULT');
    }
  }
  const cfs=(profile.cfsText||'ดูรายงานผลในโปรแกรม CFS').trim();
  if(profile.style==='fixed'||!result||Object.keys(result).length===0)return cfs;
  const suffix=`(${cfs})`;
  if(result.result_type==='redraw_notice')return `redraw requested ${suffix}`;
  const val=(key:string)=>(result[key]||'').trim();
  const tk=triKeys.every(k=>val(k)), sk=scaKeys.every(k=>val(k));
  if(!tk&&!sk)return `Result not available in system, see report ${suffix}`;
  const high=triNames.filter((_,i)=>val(triKeys[i]).includes('High'));
  const low=triNames.filter((_,i)=>val(triKeys[i]).includes('Low'));
  const detected=scaNames.filter((_,i)=>val(scaKeys[i])==='Detected');
  const parts:string[]=[];
  if(high.length){parts.push(`High risk for fetal ${join(high)}`);if(profile.style==='full'&&low.length)parts.push(`Low risk for ${join(low)}`);}
  else parts.push(tk?(profile.style==='full'?`Low risk for ${join(triNames)}`:'Low risk for common fetal trisomies'):'Trisomy result not available in system');
  if(detected.length)parts.push(`${join(detected)} ${profile.style==='full'?'was detected':'detected'}`);
  else if(!sk)parts.push('Sex chromosome result not available in system');
  else if(profile.style==='full')parts.push(`No evidence of ${join(scaNames,'or')} was detected`);
  return parts.join('. ')+`. ${suffix}`;
}

function strictTimestamp(value:string) {
  // Legacy's pure converter supports these forms; P6 rejects lossy/invalid fallbacks.
  if(!/^(?:\d{14}|\d{8}|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\d{2}\/\d{2}\/\d{4} - \d{2}:\d{2}:\d{2})$/.test(value))throw Error('INVALID_DATE');
  const ts=timestamp(value);
  wireDate(ts);
  return ts;
}

export function pdfFilename(hn:string, ln:string, sequence:number, template='N_HN__LN') {
  text.parse(hn);
  if(!hn.startsWith('SYNTHETIC-')||!/^0*99000\d+$/.test(ln))throw Error('SYNTHETIC_ONLY');
  if(!Number.isSafeInteger(sequence)||sequence<1)throw Error('INVALID_SEQUENCE');
  if(!/^[A-Za-z0-9_-]+$/.test(template))throw Error('INVALID_PDF_TEMPLATE');
  let t=template;
  if(t.startsWith('N_')||t==='N')t=sequence+t.slice(1);
  else if(/^\d+/.test(t))t=t.replace(/^\d+/,String(sequence));
  const name=t.replaceAll('HN',hn.replace(/[\\/:*?"<>|]/g,'_')).replaceAll('LN',ln)+'.pdf';
  if(name.length>255)throw Error('INVALID_FILENAME');
  return name;
}

export function serializeSyntheticRes(input:SyntheticResInput, profile:ResProfile=syntheticProfile) {
  const x=inputSchema.parse(input), p=profileSchema.parse(profile), o=x.order;
  pdfFilename(o.hn,o.ln,1,p.pdfTemplate); // Validate configured naming without touching any path.
  if(!/^\d{8}$/.test(o.dob))throw Error('INVALID_DATE');
  wireDate(o.dob);
  const ts=strictTimestamp(x.generatedAt), approval=strictTimestamp(x.approvedAt);
  const specimen=o.specimen_date?strictTimestamp(o.specimen_date):'';
  const prefixes=['พระภิกษุ','น.ส.','นาง','นาย','ด.ช.','ด.ญ.','พ.ท.','พ.อ.','พ.ต.','พ.จ.ต.','พ.อ.อ.','ร.ต.','ร.อ.','ร.ท.','Miss.','Mr.','Mrs.','Capt.','Lt.','Gen.'].sort((a,b)=>b.length-a.length);
  let remainder=o.dspname.trim();
  const prefix=prefixes.find(s=>remainder.startsWith(s))??'';
  remainder=remainder.slice(prefix.length).trim();
  let names=remainder.split(/\s{2,}/);
  if(names.length<2){const i=remainder.indexOf(' ');names=i<0?[remainder,'']:[remainder.slice(0,i),remainder.slice(i+1)];}
  const patient=Array<string>(35).fill(''), order=Array<string>(26).fill(''), result=Array<string>(12).fill('');
  const r3=escapeWire(resultText(x.result,p));
  // This bound counts escaped UTF-16 code units, not bytes or graphemes. Receiver units/limit remain Q-I5.
  if(r3.length>p.maxResultCodeUnits)throw Error('R3_TOO_LONG');
  Object.assign(patient,{0:'P',1:'1',2:o.ln,3:o.hn,4:'^',5:`${escapeWire(names[1].trim())}^^${escapeWire(prefix)} ${escapeWire(names[0].trim())}`,7:o.dob,8:o.sex,21:o.ln,23:`${specimen}^${specimen}`,24:'R',25:`${p.wardId}^${escapeWire(p.wardName)}`,27:'^O',33:`0^${p.wardId}`,34:'^99'});
  Object.assign(order,{0:'O',1:'1',2:o.ln,4:`^^^${p.testCode}^B^0`,15:p.specimenCode,18:p.o18,25:'F'});
  Object.assign(result,{0:'R',1:'1',2:`^^^${p.testCode}^B^0`,3:r3,6:p.resultFlag,8:'F',9:`${approval}^${approval}`,10:x.certifierHisId,11:o.ln+p.accessionSuffix});
  const wire=[`H|\\^&|||${p.sender}|||||${p.receiver}||P||${ts}`,patient.join('|'),order.join('|'),result.join('|'),'L|1|N'].join('\r')+'\r';
  return {filename:resFilename(o.ln,ts),bytes:Buffer.concat([Buffer.from([255,254]),Buffer.from(wire,'utf16le')]),ok:Buffer.from([255,254])};
}

/** Strict fixture verification against the complete frozen input/profile, not field widths alone. */
export function verifySyntheticRes(bytes:Buffer,input:SyntheticResInput,profile:ResProfile=syntheticProfile):void {
  verifyRes(bytes);
  if(!bytes.equals(serializeSyntheticRes(input,profile).bytes))throw Error('RES_CONTRACT_MISMATCH');
}
