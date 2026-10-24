import {createHash} from 'node:crypto';
import type {HalosRow} from './halos-adapter';

// Versioned interpretation of one HALOS analysis row for the Owner's DOCX report masters.
// The mappings are a REFERENCE transcription of ReadyGen Config/enrichment (enrich.txt, enrich_decimal.txt, enrich_format.txt);
// they are NOT clinically approved by being written here. Approval is the separately governed `report_interpretation` setting.
// Unknown, malformed, missing or contradictory input never becomes Low Risk / Not Detected: it becomes a HOLD with a reason.
export const READYGEN_REFERENCE_SHA256='66a519a6f75dd3edc6994661704bb1c2709ff9e9464406e0b9e72df723e8d5e3';
export const RULESET={
 id:'CBH-READYGEN-REF',version:'1.0.0',reference:{source:'ReadyGen Config/enrichment/enrich.txt',sha256:READYGEN_REFERENCE_SHA256},
 trisomy:{
  t21:{field:'testChr21',map:{Negative:'Low Risk',TH21:'High Risk',TL21:'High Risk'}},
  t18:{field:'testChr18',map:{Negative:'Low Risk',TH18:'High Risk',TL18:'High Risk'}},
  t13:{field:'testChr13',map:{Negative:'Low Risk',TH13:'High Risk',TL13:'High Risk'}}
 },
 // XO_NEW/XXX_NEW/XXY_NEW/XYY_NEW: "Negative" -> all Not Detected; "<k>(+++)" or "<k>(+)" -> that condition Detected.
 sca:{negative:'Negative',tokens:['XO','XXX','XXY','XYY'],strengths:['(+++)','(+)']},
 // gender (Singleton "Fetal Gender") and gender_cbh (Twin "Y Chromosome").
 fetalGender:{Male:'Male',Female:'Female'},twinY:{Male:'Detected',Female:'Not Detected'},
 qc:{sampleQc:'Pass',operationAdvice:'Qualified',physicianAdvice:'Qualified',printed:'PASS'},
 fetalFraction:{decimals:2,templateReference:3.5},
 riskIndex:/^1\/[0-9]+(?:\.[0-9]+)?$/,
 // These HALOS findings have no section in the approved masters: any value requires clinical review.
 noSectionInTemplate:['testOther','disease','testCnv'] as const,
 // ReadyGen reference defects that are deliberately NOT reproduced (each case is gated, see tests).
 knownReferenceDefects:[
  'testChrOther_bkgi maps T22 to the sentence "chromosome 21 trisomy"',
  'T10_risk/T10risk match the token "101" instead of "T10"',
  'XO_NEW contains the malformed clause "?*XXYNot Detected" (missing comma)',
  'trisomy21/18/13_ra have no ELSE branch, so an unlisted token (e.g. ML21) has no defined output',
  'enrich_alias maps "Original Sample No." to hosID which ReadyGen prints as HN; NIPT-CBH prints only the authoritative case HN'
 ]
} as const;
const canonical=(v:unknown):string=>v instanceof RegExp?JSON.stringify(v.source):Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);
export const RULESET_SHA256=createHash('sha256').update(canonical(RULESET)).digest('hex');

export type Hold={code:string;field?:string;raw?:string};
export type Interpretation={status:'FINAL_ELIGIBLE'|'HOLD';holds:Hold[];template:'SINGLETON'|'TWIN';
 values:{qc:string|null;t21:string|null;t18:string|null;t13:string|null;probability:{t21:string|null;t18:string|null;t13:string|null};
  xo:string|null;xxx:string|null;xxy:string|null;xyy:string|null;fetalGender:string|null;yChromosome:string|null;fetalFraction:string|null};
 abnormal:boolean;trace:{rule:string;input:string;output:string}[];ruleset:{id:string;version:string;sha256:string}};

const trim=(v:string|undefined)=>(v??'').trim();
/** Interpret one HALOS `result` row for the chosen template. Pure; the same input and ruleset always give the same output. */
export function interpretRow(row:Pick<HalosRow,'values'>,template:'SINGLETON'|'TWIN'):Interpretation{
 const holds:Hold[]=[],trace:Interpretation['trace']=[],v=row.values;
 const out:Interpretation['values']={qc:null,t21:null,t18:null,t13:null,probability:{t21:null,t18:null,t13:null},xo:null,xxx:null,xxy:null,xyy:null,fetalGender:null,yChromosome:null,fetalFraction:null};
 // QC: only Pass + Qualified + Qualified prints PASS. "Rerun" advice is never a final result, whatever the risk calls say.
 const qc={sampleQc:trim(v.sampleQc),operationAdvice:trim(v.operationAdvice),physicianAdvice:trim(v.physicianAdvice)};
 if(qc.sampleQc===RULESET.qc.sampleQc&&qc.operationAdvice===RULESET.qc.operationAdvice&&qc.physicianAdvice===RULESET.qc.physicianAdvice)out.qc=RULESET.qc.printed;
 else if([qc.operationAdvice,qc.physicianAdvice].some(a=>/rerun/i.test(a)))holds.push({code:'QC_RERUN_ADVISED',raw:`${qc.sampleQc}/${qc.operationAdvice}/${qc.physicianAdvice}`});
 else if(qc.sampleQc&&qc.sampleQc!==RULESET.qc.sampleQc)holds.push({code:'QC_NOT_PASS',raw:qc.sampleQc});
 else holds.push({code:'QC_STATUS_UNRECOGNIZED',raw:`${qc.sampleQc}/${qc.operationAdvice}/${qc.physicianAdvice}`});
 trace.push({rule:'qc',input:`${qc.sampleQc}/${qc.operationAdvice}/${qc.physicianAdvice}`,output:out.qc??'HOLD'});
 for(const [key,rule] of Object.entries(RULESET.trisomy) as [keyof typeof RULESET.trisomy,(typeof RULESET.trisomy)[keyof typeof RULESET.trisomy]][]){
  const raw=trim(v[rule.field]),mapped=(rule.map as Record<string,string>)[raw];
  if(!raw)holds.push({code:`${key.toUpperCase()}_MISSING`,field:rule.field});
  else if(!mapped)holds.push({code:`${key.toUpperCase()}_TOKEN_UNRECOGNIZED`,field:rule.field,raw});
  else out[key]=mapped;
  trace.push({rule:`trisomy.${key}`,input:raw,output:mapped??'HOLD'});
  const riskField=key==='t21'?'risk21':key==='t18'?'risk18':'risk13',risk=trim(v[riskField]);
  if(!RULESET.riskIndex.test(risk))holds.push({code:`${key.toUpperCase()}_RISK_INDEX_INVALID`,field:riskField,raw:risk});else out.probability[key]=risk;
 }
 const sexRaw=trim(v.testSex);
 if(template==='SINGLETON'){
  // Tokens are matched whole; a combined or unknown call is not split into guesses.
  const tokens=sexRaw.split(/[;,\s]+/).filter(Boolean),allowed=new Map(RULESET.sca.tokens.flatMap(t=>RULESET.sca.strengths.map(s=>[t+s,t] as const)));
  if(!sexRaw)holds.push({code:'SCA_MISSING',field:'testSex'});
  else if(sexRaw===RULESET.sca.negative){out.xo=out.xxx=out.xxy=out.xyy='Not Detected';}
  else if(tokens.length===1&&allowed.has(tokens[0])){const hit=allowed.get(tokens[0])!;for(const t of RULESET.sca.tokens)out[t.toLowerCase() as 'xo']=t===hit?'Detected':'Not Detected';}
  else holds.push({code:'SCA_TOKEN_UNRECOGNIZED',field:'testSex',raw:sexRaw});
  trace.push({rule:'sca',input:sexRaw,output:[out.xo,out.xxx,out.xxy,out.xyy].join('/')});
  const g=trim(v.gender),mapped=(RULESET.fetalGender as Record<string,string>)[g];
  if(!mapped)holds.push({code:g?'GENDER_TOKEN_UNRECOGNIZED':'GENDER_MISSING',field:'gender',raw:g});else out.fetalGender=mapped;
  trace.push({rule:'fetalGender',input:g,output:mapped??'HOLD'});
 }else{
  // The Twin master has no SCA section: any SCA call other than Negative needs clinical review, never silent omission.
  if(sexRaw&&sexRaw!==RULESET.sca.negative)holds.push({code:'TWIN_SCA_FINDING_HAS_NO_TEMPLATE_SECTION',field:'testSex',raw:sexRaw});
  const g=trim(v.gender),mapped=(RULESET.twinY as Record<string,string>)[g];
  if(!mapped)holds.push({code:g?'GENDER_TOKEN_UNRECOGNIZED':'GENDER_MISSING',field:'gender',raw:g});else out.yChromosome=mapped;
  trace.push({rule:'twinY',input:g,output:mapped??'HOLD'});
 }
 const ffRaw=trim(v.fetalFraction),ff=Number(ffRaw);
 if(!/^\d{1,2}(?:\.\d+)?$/.test(ffRaw)||!(ff>0&&ff<100))holds.push({code:'FETAL_FRACTION_INVALID',field:'fetalFraction',raw:ffRaw});
 else{out.fetalFraction=ff.toFixed(RULESET.fetalFraction.decimals);if(ff<RULESET.fetalFraction.templateReference)holds.push({code:'FETAL_FRACTION_BELOW_TEMPLATE_REFERENCE',field:'fetalFraction',raw:ffRaw});}
 trace.push({rule:'fetalFraction',input:ffRaw,output:out.fetalFraction??'HOLD'});
 for(const f of RULESET.noSectionInTemplate){const raw=trim(v[f]);if(raw)holds.push({code:`${f.toUpperCase()}_FINDING_REQUIRES_REVIEW`,field:f,raw});}
 const abnormal=[out.t21,out.t18,out.t13].includes('High Risk')||[out.xo,out.xxx,out.xxy,out.xyy].includes('Detected');
 return {status:holds.length?'HOLD':'FINAL_ELIGIBLE',holds,template,values:out,abnormal,trace,ruleset:{id:RULESET.id,version:RULESET.version,sha256:RULESET_SHA256}};
}

// Product codes as written in the NIFTY request header (ReadyGen alias "*Product No.").
export const PRODUCTS:Record<string,string>={'NIFTY':'HNZ0010','NIFTY(Y%)':'HNZ0011','NIFTY(SCA)':'HNZ0020','NIFTY(SCA, Y%)':'HNZ0021','NIFTY(SCA, MS3)':'HNZ0040',
 'NIFTY(SCA, MS3, Y%)':'HNZ0041','NIFTY(SCA, MS3, IF)':'HNZ0050','NIFTY(SCA, MS3, IF, Y%)':'HNZ0051'};
export const productCodeOf=(name:string|undefined)=>PRODUCTS[(name??'').replace(/\s+/g,' ').replace(/\s*\(\s*/g,'(').replace(/\s*\)/g,')').replace(/\s*,\s*/g,', ').trim()]??null;
/** Owner masters: FM-WI-T-BM-17-07 (Singleton) and FM-WI-T-BM-17-08 (Twin), both titled for product HNZ0051. */
export const TEMPLATES={SINGLETON:{code:'FM-WI-T-BM-17-07',product:'HNZ0051',sha256:'a56be6e4282b9b2fa06b4a73a527342c0949a70e83bef85a6574d379b4509117'},
 TWIN:{code:'FM-WI-T-BM-17-08',product:'HNZ0051',sha256:'0f7313213fbd99153ee015018df4cab013567ce12281a5a2102baad84ddd1bf3'}} as const;
/** HALOS "Gestational Weeks" is "W,D". */
export function halosGaDays(raw:string|undefined){const m=/^\s*(\d{1,2})\s*,\s*(\d)\s*$/.exec(raw??'');return m?Number(m[1])*7+Number(m[2]):null;}
