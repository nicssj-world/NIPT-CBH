// Template-aware result parser (Plan §11.2, §11.4; D-04). Anchors are REFERENCE from NIPTY pdf_parser.py ("Lab No. (LN):", "HN:",
// TRISOMY table, SEX CHROMOSOME block + Fetal Fraction, "RESULTS QC:", "Reported Date:", "Gestational Age:", "DOB:") and remain
// unapproved until OD-07 verifies them against the hospital's synthetic PDFs. The twin layout has no NIPTY evidence (SPEC: no twin
// case seen); its anchors are a proposed synthetic contract. Every value keeps its raw text and method; unreadable is UNREADABLE —
// never Normal, Low Risk, Not Detected or 0.
export const PARSER_VERSION='P5-PARSER-1.0.3';
export const TEMPLATE_VERSIONS={SINGLETON:'SYNTHETIC-BGI-SINGLETON-v1-UNAPPROVED-OD07',TWIN:'SYNTHETIC-TWIN-PROPOSED-v1-UNAPPROVED-OD07',REDRAW_NOTICE:'SYNTHETIC-REDRAW-NOTICE-v1-UNAPPROVED-OD07',UNKNOWN:'UNKNOWN'} as const;
export type TemplateKind=keyof typeof TEMPLATE_VERSIONS;
export type Method='ANCHORED'|'FALLBACK'|'UNREADABLE'|'NOT_APPLICABLE';
export type Field<T=string>={value:T|null;raw:string|null;method:Method};
export type Parsed={templateKind:TemplateKind;templateVersion:string;parserVersion:string;needsManualReview:boolean;abnormal:boolean;
 noticeCategory:'GREY_AREA'|'LOW_FETAL_FRACTION'|'RESAMPLING'|'MULTIPLE_ANEUPLOIDIES'|'OTHER'|null;
 identifiers:{labNumber:Field;hn:Field;patientName:Field;dob:Field;collectionDate:Field;receivedDate:Field;reportedDate:Field;gestationalAgeDays:Field<number>};
 results:{result?:Field;t21:Field;t18:Field;t13:Field;fetalSex:Field;xo:Field;xxx:Field;xxy:Field;xyy:Field;yChromosome:Field;fetalFraction:Field<number>;qc:Field}};

const RISK='(Low Risk|High Risk)',DETECT='(Not Detected|Detected)';
const RE={
 labLn:/Lab No\.\s*\(LN\):\s*([A-Za-z0-9-]+)/,labLnNotice:/\(LN:\s*([A-Za-z0-9-]+)/,
 hnAnchored:/Lab No\.\s*\(LN\):\s*\S+[\s\S]{0,60}?HN:\s*(\d+(?:\/\d+)?)(?=\s|$)/,hn:/HN:\s*(\d+(?:\/\d+)?)(?=\s|$)/,
 name:/Patient Name:\s*(.+?)\s*(?:Gestational Age:|\n|$)/,ga:/Gestational Age:\s*(\d{1,2})\s*Weeks?\s*(\d)\s*Day\(s\)/i,
 // Task 3: the Owner DOCX masters (and ReadyGen enrich_format "{0}W {1}D") print GA as "15W 3D"; both layouts give the same two numbers.
 gaShort:/Gestational Age:\s*(\d{1,2})\s*W\s+(\d)\s*D(?=\s|$)/,
 dob:/DOB:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/,collection:/Sample Collection Date:\s*([\w-]+)/,received:/Sample Received Date:\s*([\w-]+)/,reported:/Reported Date:\s*([\w-]+)/,
 trisomy:new RegExp(`TRISOMY\\s*21\\s*TRISOMY\\s*18\\s*TRISOMY\\s*13\\s*Fetal\\s*Gender[\\s\\S]{0,80}?${RISK}\\s+${RISK}\\s+${RISK}(?:\\s+(Male|Female))?`),
 twin:new RegExp(`TRISOMY\\s*21\\s*TRISOMY\\s*18\\s*TRISOMY\\s*13\\s*Y\\s*CHROMOSOME[\\s\\S]{0,80}?${RISK}\\s+${RISK}\\s+${RISK}\\s+${DETECT}`,'i'),
 singletonHeader:/TRISOMY\s*21\s*TRISOMY\s*18\s*TRISOMY\s*13\s*Fetal\s*Gender/i,
 twinHeader:/TRISOMY\s*21\s*TRISOMY\s*18\s*TRISOMY\s*13\s*Y\s*CHROMOSOME/i,
 twinLabel:/\bTWIN(?:S| PREGNANCY)?\b/i,
 sca:new RegExp(`SEX CHROMOSOME ANEUPLOIDIES[\\s\\S]{0,80}?${DETECT}\\s+${DETECT}\\s+${DETECT}\\s+${DETECT}\\s+([\\d.]+)`),
 scaFallback:/Not Detected\s+Not Detected\s+Not Detected\s+Not Detected\s+([\d.]+)/,
 ff:/Fetal Fraction[^\n\d]{0,20}?(\d{1,2}(?:\.\d+)?)\s*%?/,
 riskAll:/(Low Risk|High Risk)/g,sex:/\b(Male|Female)\b/,qc:/RESULTS QC:\s*(\w+)/
};
const NOTICE_TEXT=['grey area','gray area','resampling','re-sampling','bkgi-nipt (ln','multiple chromosome aneuploidies','(mca)'];
const NOTICE_NAME=['resampling','grey area','greyarea','gray area','re-draw','redraw','re-sampling'];
const MONTHS:Record<string,string>={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};

const none=<T>(method:Method='UNREADABLE'):Field<T>=>({value:null,raw:null,method});
const field=(m:RegExpMatchArray|null,group=1,method:Method='ANCHORED'):Field=>m?.[group]?{value:m[group].trim(),raw:m[0],method}:none();
/** DD-Mon-YYYY → YYYY-MM-DD at parse time (F-12). An impossible date keeps its raw text and becomes UNREADABLE. */
export function isoDate(raw:string|null):string|null{
 const m=raw?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);if(!m)return null;const mm=MONTHS[m[2].toLowerCase()];if(!mm)return null;
 const iso=`${m[3]}-${mm}-${m[1].padStart(2,'0')}`;const d=new Date(iso+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:null;
}
const dateField=(m:RegExpMatchArray|null):Field=>{const f=field(m);if(f.value===null)return f;const iso=isoDate(f.value);return iso?{...f,value:iso}:{value:null,raw:f.raw,method:'UNREADABLE'};};

export function classifyNotice(text:string,filename:string){
 const t=text.toLowerCase(),n=filename.toLowerCase();
 if(!NOTICE_TEXT.some(h=>t.includes(h))&&!NOTICE_NAME.some(h=>n.includes(h)))return null;
 return t.includes('grey area')||t.includes('gray area')?'GREY_AREA' as const:/fetal fraction[^\n]{0,40}(low|insufficient)|low fetal fraction/.test(t)?'LOW_FETAL_FRACTION' as const
  :t.includes('multiple chromosome aneuploidies')||t.includes('(mca)')?'MULTIPLE_ANEUPLOIDIES' as const:t.includes('resampling')||t.includes('re-sampling')||n.includes('redraw')?'RESAMPLING' as const:'OTHER' as const;
}

export function parseReport(text:string,filename=''):Parsed{
 const ln=field(RE.labLn.exec(text)??RE.labLnNotice.exec(text));
 const hnA=RE.hnAnchored.exec(text),hn=hnA?field(hnA):field(RE.hn.exec(text),1,'FALLBACK');
 const gaM=RE.ga.exec(text)??RE.gaShort.exec(text);const ga:Field<number>=gaM?{value:Number(gaM[1])*7+Number(gaM[2]),raw:gaM[0],method:'ANCHORED'}:none();
 const identifiers={labNumber:ln,hn,patientName:field(RE.name.exec(text)),dob:dateField(RE.dob.exec(text)),collectionDate:dateField(RE.collection.exec(text)),
  receivedDate:dateField(RE.received.exec(text)),reportedDate:dateField(RE.reported.exec(text)),gestationalAgeDays:ga};
 // Owner Task1: the same normal external PDF may explicitly report Result = No Call.
 // Retain the complete anchored result text; duplicate lines are unresolved, never picked silently.
 const resultLines=[...text.matchAll(/^[ \t]*Result[ \t]*[:=][ \t]*([^\r\n]+?)[ \t]*$/gmi)];
 const reportResult:Field=resultLines.length===1?field(resultLines[0]):resultLines.length>1?{value:null,raw:resultLines.map(m=>m[0]).join('\n'),method:'UNREADABLE'}:none();
 const noCall=reportResult.method==='ANCHORED'&&reportResult.value==='No Call';
 const results:Parsed['results']={result:reportResult,t21:none(),t18:none(),t13:none(),fetalSex:none(),xo:none(),xxx:none(),xxy:none(),xyy:none(),yChromosome:none('NOT_APPLICABLE'),fetalFraction:none(),qc:field(RE.qc.exec(text))};
 let review=false,kind:TemplateKind;
 const twin=RE.twin.exec(text),single=RE.trisomy.exec(text);
 if(twin&&RE.twinLabel.test(text)){
  kind='TWIN';
  [results.t21,results.t18,results.t13,results.yChromosome]=[1,2,3,4].map(i=>({value:twin[i],raw:twin[0],method:'ANCHORED' as Method}));
  // F-19: SCA is not part of a twin report — NOT_APPLICABLE, which is different from unreadable.
  for(const k of ['xo','xxx','xxy','xyy','fetalSex'] as const)results[k]=none('NOT_APPLICABLE');
 }else{
  if(single){[results.t21,results.t18,results.t13]=[1,2,3].map(i=>({value:single[i],raw:single[0],method:'ANCHORED' as Method}));if(single[4])results.fetalSex={value:single[4],raw:single[0],method:'ANCHORED'};}
  else{const risks=[...text.matchAll(RE.riskAll)].map(m=>m[1]);if(risks.length>=3){review=true;[results.t21,results.t18,results.t13]=risks.slice(0,3).map(v=>({value:v,raw:v,method:'FALLBACK' as Method}));}}
  if(!results.fetalSex.value){const s=RE.sex.exec(text);if(s&&results.t21.value)results.fetalSex={value:s[1],raw:s[0],method:'FALLBACK'};}
  const sca=RE.sca.exec(text);
  if(sca){[results.xo,results.xxx,results.xxy,results.xyy]=[1,2,3,4].map(i=>({value:sca[i],raw:sca[0],method:'ANCHORED' as Method}));results.fetalFraction={value:Number(sca[5]),raw:sca[0],method:'ANCHORED'};}
  else{const fb=RE.scaFallback.exec(text);if(fb){review=true;for(const k of ['xo','xxx','xxy','xyy'] as const)results[k]={value:'Not Detected',raw:fb[0],method:'FALLBACK'};results.fetalFraction={value:Number(fb[1]),raw:fb[0],method:'FALLBACK'};}}
  kind=results.t21.value&&results.t18.value&&results.t13.value?'SINGLETON':'UNKNOWN';
 }
 // No new template: only existing normal report table headers can establish pregnancy layout.
 // The explicit No Call value never supplies risk, fetal fraction or QC measurements.
 if(noCall&&kind==='UNKNOWN'){
  if(RE.twinHeader.test(text)&&RE.twinLabel.test(text))kind='TWIN';
  else if(RE.singletonHeader.test(text))kind='SINGLETON';
 }
 if(kind==='TWIN'){const ff=RE.ff.exec(text);if(ff)results.fetalFraction={value:Number(ff[1]),raw:ff[0],method:'ANCHORED'};}
 const notice=kind==='UNKNOWN'?classifyNotice(text,filename):null;
 if(notice)kind='REDRAW_NOTICE';
 if(kind!=='SINGLETON')for(const k of ['xo','xxx','xxy','xyy'] as const)if(results[k].method==='UNREADABLE')results[k]=none('NOT_APPLICABLE');
 if(kind==='REDRAW_NOTICE'||kind==='UNKNOWN'){for(const k of ['t21','t18','t13','fetalSex','fetalFraction'] as const)if(results[k].method==='UNREADABLE')(results[k] as Field<unknown>)=none('NOT_APPLICABLE');}
 if(results.fetalFraction.value!==null&&!(results.fetalFraction.value>0&&results.fetalFraction.value<100))results.fetalFraction={value:null,raw:results.fetalFraction.raw,method:'UNREADABLE'};
 const missing=missingRequired({templateKind:kind,results} as Parsed);
 const abnormal=[results.t21,results.t18,results.t13].some(f=>f.value==='High Risk')||(kind==='SINGLETON'&&[results.xo,results.xxx,results.xxy,results.xyy].some(f=>f.value==='Detected'));
 return {templateKind:kind,templateVersion:TEMPLATE_VERSIONS[kind],parserVersion:PARSER_VERSION,needsManualReview:noCall||review||missing.length>0||identifiers.hn.method!=='ANCHORED',abnormal,noticeCategory:notice,identifiers,results};
}

/** §11.4 required values per report type; NOT_APPLICABLE is never "missing" and UNREADABLE always is. */
export const REQUIRED:Record<TemplateKind,readonly (keyof Parsed['results'])[]>={SINGLETON:['t21','t18','t13','xo','xxx','xxy','xyy','fetalFraction','qc'],TWIN:['t21','t18','t13','yChromosome'],REDRAW_NOTICE:[],UNKNOWN:[]};
export const VOCABULARY:Partial<Record<keyof Parsed['results'],readonly string[]>>={t21:['Low Risk','High Risk'],t18:['Low Risk','High Risk'],t13:['Low Risk','High Risk'],xo:['Not Detected','Detected'],xxx:['Not Detected','Detected'],xxy:['Not Detected','Detected'],xyy:['Not Detected','Detected'],yChromosome:['Not Detected','Detected'],fetalSex:['Male','Female'],qc:['PASS','FAIL']};
export function isNoCallReport(p:Pick<Parsed,'templateKind'|'results'>){
 return (p.templateKind==='SINGLETON'||p.templateKind==='TWIN')&&p.results.result?.method==='ANCHORED'&&p.results.result.value==='No Call';
}
export function missingRequired(p:Pick<Parsed,'templateKind'|'results'>){
 // No Call means the analytical findings are unreportable; require actual external outcome and QC, never fake findings.
 const ambiguous=p.results.result?.method==='UNREADABLE'&&p.results.result.raw!==null;
 const required:readonly (keyof Parsed['results'])[]=isNoCallReport(p)?['result','qc']:ambiguous?['result',...REQUIRED[p.templateKind]]:REQUIRED[p.templateKind];
 return required.filter(k=>{const f=p.results[k];if(!f)return true;if(f.value===null)return true;const v=VOCABULARY[k];return v!==undefined&&!v.includes(String(f.value));});
}
