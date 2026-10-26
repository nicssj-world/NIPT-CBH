import {readArchive,writeArchive,sha256,xmlEscape,xmlDecode} from '../workbook/archive';
import {TEMPLATES} from './interpretation';

// Fills the Owner's Word masters (FM-WI-T-BM-17-07 Singleton / FM-WI-T-BM-17-08 Twin) at OOXML level. Layout, fonts, tables,
// sections, disclaimer and footer are the master's own bytes; only text inside the existing runs and the two signature pictures
// change. The master's static signer names, licence numbers, signature images and the literal "QC: PASS" never reach a report.
export type TemplateKind=keyof typeof TEMPLATES;
export type SignerSlot={name:string;license:string;date:string;signature:{bytes:Buffer;media:'image/png'|'image/jpeg'}|null};
export type ReportValues={patientName:string;ga:string;sampleID:string;hn:string;collectDate_cbh:string;patientIDCard:string;dob_cbh:string;receivedDate_cbh:string;
 referringPhysician:string;hospitalName:string;remarks:string;sampleType:string;qc:string;
 trisomy21_ra:string;trisomy18_ra:string;trisomy13_ra:string;risk21:string;risk18:string;risk13:string;
 gender:string;gender_cbh:string;XO_NEW:string;XXX_NEW:string;XXY_NEW:string;XYY_NEW:string;fetalFaction_2:string};
export const TOKENS={SINGLETON:['patientName','ga','sampleID','hn','collectDate_cbh','patientIDCard','dob_cbh','receivedDate_cbh','referringPhysician','hospitalName','remarks',
  'trisomy21_ra','trisomy18_ra','trisomy13_ra','gender','risk21','risk18','risk13','XO_NEW','XXX_NEW','XXY_NEW','XYY_NEW','fetalFaction_2','createdDate_cbh'],
 TWIN:['patientName','ga','sampleID','hn','collectDate_cbh','patientIDCard','dob_cbh','receivedDate_cbh','referringPhysician','sampleType','hospitalName','remarks',
  'trisomy21_ra','trisomy18_ra','trisomy13_ra','gender_cbh','risk21','risk18','risk13','createdDate_cbh']} as const;
// ReadyGen colorOverride/show_red: a High Risk / Detected call and its probability print in red.
const RED_VALUES=new Set(['High Risk','Detected']);
const COLOR_FOLLOWS:Record<string,string>={risk21:'trisomy21_ra',risk18:'trisomy18_ra',risk13:'trisomy13_ra'};
export class DocxError extends Error{constructor(code:string,public details?:unknown){super(code);}}

type TextNode={start:number;end:number;text:string;runOpenEnd:number|null};
type Paragraph={nodes:TextNode[]};
type Edit={start:number;end:number;text:string};
/** Innermost-paragraph text nodes in document order (text-box paragraphs nest inside runs of outer paragraphs) and every picture. */
function paragraphs(xml:string){
 const out:Paragraph[]=[],stack:Paragraph[]=[],runs:number[]=[],blips:{start:number;end:number}[]=[];
 const tag=/<(\/?)(w:p|w:r|w:t|a:blip)(?=[\s>/])([^>]*?)(\/?)>/g;let m:RegExpExecArray|null;
 while((m=tag.exec(xml))){
  const [whole,close,name,,self]=m;
  if(name==='w:p'){if(self)continue;if(!close){const p={nodes:[]};stack.push(p);out.push(p);}else stack.pop();}
  else if(name==='w:r'){if(!close&&!self)runs.push(m.index+whole.length);else if(close)runs.pop();}
  else if(name==='a:blip'&&!close){
   // The whole picture fill (blip + crop rectangle) is one unit: the master crops its own photo, which must not crop the signer's image.
   const start=xml.lastIndexOf('<pic:blipFill',m.index),close=xml.indexOf('</pic:blipFill>',m.index);
   if(start<0||close<0||xml.lastIndexOf('</pic:blipFill>',m.index)>start)throw new DocxError('DOCX_PICTURE_UNTERMINATED');
   const end=close+'</pic:blipFill>'.length;blips.push({start,end});tag.lastIndex=end;}
  else if(name==='w:t'&&!close&&!self){const startText=m.index+whole.length,endText=xml.indexOf('</w:t>',startText);if(endText<0)throw new DocxError('DOCX_TEXT_UNTERMINATED');
   stack.at(-1)?.nodes.push({start:startText,end:endText,text:xmlDecode(xml.slice(startText,endText)),runOpenEnd:runs.at(-1)??null});tag.lastIndex=endText;}
 }
 return {paragraphs:out.filter(p=>p.nodes.length),blips};
}
const textOf=(p:Paragraph)=>p.nodes.map(n=>n.text).join('');
// The master's text boxes and cells have fixed geometry. A value longer than the master's own text shrinks that paragraph's
// font proportionally (as ReadyGen's font.txt does for patientName); below 60% it is refused rather than clipped.
export const MIN_FONT_RATIO=0.6;
// Patient-name cell of both masters, measured in spacing characters at the master's 11 pt (calibrated by rendering; ReadyGen's
// Config/font.txt also starts fitting patientName at about 40). Thai vowel and tone marks take no width and are not counted.
export const PATIENT_NAME_CAPACITY=44;
export const visualLength=(v:string)=>[...v.normalize('NFC')].filter(c=>!/\p{M}/u.test(c)).length;
function shrinkEdits(p:Paragraph,xml:string,ratio:number):Edit[]{
 const out:Edit[]=[],seen=new Set<number>();
 for(const n of p.nodes){if(n.runOpenEnd===null||seen.has(n.runOpenEnd))continue;seen.add(n.runOpenEnd);
  const head=xml.slice(n.runOpenEnd,n.start),rPr=/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(head);if(!rPr)continue;
  const scaled=rPr[0].replace(/<w:(sz|szCs) w:val="(\d+)"\/>/g,(_,tag:string,v:string)=>`<w:${tag} w:val="${Math.max(8,Math.floor(Number(v)*ratio))}"/>`);
  if(scaled!==rPr[0]){const at=n.runOpenEnd+rPr.index;out.push({start:at,end:at+rPr[0].length,text:scaled});}}
 return out;
}
/** Replace character spans of a paragraph: the replacement goes to the run where the span starts, covered text is removed. */
function spanEdits(p:Paragraph,spans:{start:number;end:number;text:string;red?:boolean}[],xml:string):Edit[]{
 const nodeText=p.nodes.map(n=>n.text),colors:number[]=[];let base=0;const bounds=p.nodes.map(n=>{const b={from:base,to:base+n.text.length};base+=n.text.length;return b;});
 for(const s of [...spans].sort((a,b)=>b.start-a.start)){
  for(let i=p.nodes.length-1;i>=0;i--){
   const b=bounds[i],from=Math.max(s.start,b.from),to=Math.min(s.end,b.to);
   const startsHere=s.start>=b.from&&(s.start<b.to||(s.start===b.to&&i===p.nodes.length-1)||(s.start===s.end&&s.start===b.from));
   if(from<to||startsHere){const t=nodeText[i];nodeText[i]=t.slice(0,Math.max(0,from-b.from))+(startsHere?s.text:'')+t.slice(Math.max(0,to-b.from));if(startsHere&&s.red)colors.push(i);}
  }
 }
 const edits:Edit[]=p.nodes.map((n,i)=>({start:n.start,end:n.end,text:xmlEscape(nodeText[i])})).filter((e,i)=>nodeText[i]!==p.nodes[i].text);
 for(const i of colors){const n=p.nodes[i];if(n.runOpenEnd===null)continue;const runHead=xml.slice(n.runOpenEnd,n.start),rPr=/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runHead);
  if(rPr){const inner=rPr[1].replace(/<w:color\b[^>]*\/>/g,'');const at=n.runOpenEnd+rPr.index;edits.push({start:at,end:at+rPr[0].length,text:`<w:rPr>${inner}<w:color w:val="FF0000"/></w:rPr>`});}
  else edits.push({start:n.runOpenEnd,end:n.runOpenEnd,text:'<w:rPr><w:color w:val="FF0000"/></w:rPr>'});}
 return edits;
}
function apply(xml:string,edits:Edit[]){
 const sorted=[...edits].sort((a,b)=>b.start-a.start||b.end-a.end);
 for(let i=1;i<sorted.length;i++)if(sorted[i].end>sorted[i-1].start)throw new DocxError('DOCX_EDIT_OVERLAP');
 let out=xml;for(const e of sorted)out=out.slice(0,e.start)+e.text+out.slice(e.end);return out;
}
const TRANSPARENT_PNG=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'+'1f15c4890000000d49444154789c636000020000050001e9fadcd80000000049454e44ae426082','hex');

/** Returns the filled .docx and the list of every substitution made (the "bindings" evidence). */
export type TemplateDescriptor={sha256:string;code:string};
/** `descriptor` defaults to the Owner's SHA-256-locked master; an Admin-approved registry revision passes its own hash and code. */
export function fillReport(template:Buffer,kind:TemplateKind,values:ReportValues,signers:{reported:SignerSlot;approved:SignerSlot},descriptor:TemplateDescriptor=TEMPLATES[kind]){
 if(sha256(template)!==descriptor.sha256)throw new DocxError('REPORT_TEMPLATE_SHA256_MISMATCH');
 const parts=readArchive(template),name='word/document.xml';let xml=parts.get(name)!.toString('utf8');
 const parsed=paragraphs(xml),ps=[...parsed.paragraphs].sort((a,b)=>a.nodes[0].start-b.nodes[0].start);
 const edits:Edit[]=[],used=new Set<string>(),bindings:{token:string;value:string;role?:string}[]=[],labels:{at:number;role:'REPORTED'|'APPROVED'}[]=[];
 let role:'REPORTED'|'APPROVED'|null=null;
 for(const p of ps){
  const text=textOf(p),spans:{start:number;end:number;text:string;red?:boolean}[]=[];
  const label=/^\s*(Reported|Approved) by:/.exec(text);
  if(label){role=label[1]==='Reported'?'REPORTED':'APPROVED';labels.push({at:p.nodes[0].start,role});
   const open=text.indexOf('('),close=text.lastIndexOf(')');if(open<0||close<open)throw new DocxError('DOCX_SIGNER_NAME_SLOT_MISSING');
   const s=role==='REPORTED'?signers.reported:signers.approved;spans.push({start:open+1,end:close,text:s.name});bindings.push({token:'signer.name',value:s.name,role});}
  const lic=/^\s*\(Medical Technologist license no\.\s*([0-9 ]+)\)\s*$/.exec(text);
  if(lic){if(!role)throw new DocxError('DOCX_LICENSE_WITHOUT_SIGNER');const s=role==='REPORTED'?signers.reported:signers.approved,at=text.indexOf(lic[1]);
   spans.push({start:at,end:at+lic[1].length,text:s.license});bindings.push({token:'signer.license',value:s.license,role});}
  const qc=/^\s*QC:\s*(PASS)\s*$/.exec(text);
  if(qc){const at=text.indexOf('PASS');spans.push({start:at,end:at+4,text:values.qc});bindings.push({token:'qc',value:values.qc});}
  for(const t of text.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)){
   const token=t[1];let value:string;let red=false;
   if(token==='createdDate_cbh'){const dateRole=/Reported Date/.test(text)?'REPORTED':/Approved Date/.test(text)?'APPROVED':null;if(!dateRole)throw new DocxError('DOCX_DATE_ROLE_UNKNOWN');value=(dateRole==='REPORTED'?signers.reported:signers.approved).date;bindings.push({token,value,role:dateRole});}
   else{if(!(TOKENS[kind] as readonly string[]).includes(token))throw new DocxError('DOCX_UNEXPECTED_PLACEHOLDER',{token});
    value=(values as Record<string,string>)[token];if(typeof value!=='string')throw new DocxError('DOCX_VALUE_MISSING',{token});
    red=RED_VALUES.has(value)||(COLOR_FOLLOWS[token]!==undefined&&RED_VALUES.has((values as Record<string,string>)[COLOR_FOLLOWS[token]]));bindings.push({token,value});}
   used.add(token);spans.push({start:t.index,end:t.index+t[0].length,text:value,red});
  }
  if(spans.length){
   edits.push(...spanEdits(p,spans,xml));
   // Fitting applies to the signer lines and the patient name only (never to clinical result cells).
   const capacity=label?visualLength(text):/^\$\{patientName\}$/.test(text.trim())?PATIENT_NAME_CAPACITY:0;
   const length=spans.reduce((n,s)=>n-visualLength(text.slice(s.start,s.end))+visualLength(s.text),visualLength(text));
   if(capacity&&length>capacity){const ratio=capacity/length;if(ratio<MIN_FONT_RATIO)throw new DocxError(label?'SIGNER_NAME_TOO_LONG_FOR_TEMPLATE':'PATIENT_NAME_TOO_LONG_FOR_TEMPLATE',{length,capacity});
    edits.push(...shrinkEdits(p,xml,ratio));bindings.push({token:label?'signer.fontRatio':'patientName.fontRatio',value:ratio.toFixed(3),...(label?{role:role!}:{})});}
  }
 }
 const missing=TOKENS[kind].filter(t=>!used.has(t));if(missing.length)throw new DocxError('DOCX_PLACEHOLDER_NOT_FOUND',{missing});
 // Signature pictures: each picture belongs to the signer label that follows it. Point it at the selected signer's image and
 // drop the master's own images with their HD-photo / background-removal layers, so no master signature can be rendered or carried.
 if(!parsed.blips.length||!labels.length)throw new DocxError('DOCX_SIGNATURE_ROLE_UNRESOLVED');
 const rels=parts.get('word/_rels/document.xml.rels')!.toString('utf8'),removed=new Set<string>(),roles=new Set<string>();
 for(const b of parsed.blips){
  const r=labels.find(l=>l.at>b.start)?.role;if(!r)throw new DocxError('DOCX_SIGNATURE_ROLE_UNRESOLVED');roles.add(r);
  const seg=xml.slice(b.start,b.end),rid=r==='REPORTED'?'rIdT3SigReported':'rIdT3SigApproved';
  for(const e of seg.matchAll(/r:embed="(rId\d+)"/g))removed.add(e[1]);
  const next=seg.replace(/<a:ext uri="\{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B\}">[\s\S]*?<\/a:ext>/g,'').replace(/<a:extLst><\/a:extLst>/g,'').replace(/<a:srcRect\b[^>]*\/>/g,'').replace(/(<a:blip\b[^>]*\br:embed=")rId\d+(")/,`$1${rid}$2`);
  if(/r:embed="rId\d+"/.test(next))throw new DocxError('DOCX_SIGNATURE_REFERENCE_REMAINS');
  edits.push({start:b.start,end:b.end,text:next});
 }
 if(roles.size!==2)throw new DocxError('DOCX_SIGNATURE_ROLE_UNRESOLVED');
 xml=apply(xml,edits);
 let nextRels=rels;const media=(s:SignerSlot)=>s.signature?.media==='image/jpeg'?'jpeg':'png';
 for(const rid of removed){const rel=new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/>`).exec(nextRels);if(!rel)throw new DocxError('DOCX_SIGNATURE_RELATIONSHIP_MISSING');
  const target=/Target="([^"]+)"/.exec(rel[0])![1];if(new RegExp(`r:(?:embed|id|link)="${rid}"`).test(xml))throw new DocxError('DOCX_SIGNATURE_STILL_REFERENCED');
  nextRels=nextRels.replace(rel[0],'');parts.delete('word/'+target.replace(/^\.\//,''));}
 nextRels=nextRels.replace('</Relationships>',`<Relationship Id="rIdT3SigReported" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/t3-signature-reported.${media(signers.reported)}"/><Relationship Id="rIdT3SigApproved" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/t3-signature-approved.${media(signers.approved)}"/></Relationships>`);
 parts.set('word/_rels/document.xml.rels',Buffer.from(nextRels));
 parts.set(`word/media/t3-signature-reported.${media(signers.reported)}`,signers.reported.signature?.bytes??TRANSPARENT_PNG);
 parts.set(`word/media/t3-signature-approved.${media(signers.approved)}`,signers.approved.signature?.bytes??TRANSPARENT_PNG);
 parts.set(name,Buffer.from(xml,'utf8'));
 for(const [part,bytes] of parts)if(/^word\/.*\.xml$/.test(part)&&bytes.toString('utf8').includes('${'))throw new DocxError('DOCX_PLACEHOLDER_REMAINS',{part});
 const bytes=writeArchive(parts);
 return {bytes,sha256:sha256(bytes),bindings,templateSha256:descriptor.sha256,templateCode:descriptor.code};
}
/** Plain text of the filled document, used to verify that nothing static from the master survives. */
export function docxText(bytes:Buffer){const xml=readArchive(bytes).get('word/document.xml')!.toString('utf8');return paragraphs(xml).paragraphs.map(textOf).join('\n');}

/** Paragraph texts of every word/*.xml part (document, headers, footers) for template inspection; read-only. */
export function templateParts(bytes:Buffer){
 const parts=readArchive(bytes),out:{part:string;paragraphs:string[]}[]=[];
 for(const [name,data] of parts)if(/^word\/(document|header\d*|footer\d*)\.xml$/.test(name))out.push({part:name,paragraphs:paragraphs(data.toString('utf8')).paragraphs.map(textOf)});
 return {parts:out,names:[...parts.keys()],rels:parts.get('word/_rels/document.xml.rels')?.toString('utf8')??'',contentTypes:parts.get('[Content_Types].xml')?.toString('utf8')??''};
}
