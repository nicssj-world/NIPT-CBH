import {readArchive,writeArchive,sha256,xmlEscape} from '../workbook/archive';
export const NIFTY_TEMPLATE_SHA256='07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc';
export type VendorPatient={slot:number;kind:'PATIENT';sampleId:string;ln:string;hn:string;name:string;identity:string;dob:string;collectionAt:string;receivedAt:string;edd:string;pregnancy:'Singleton'|'Twins';doctor:string};
export type VendorControl={slot:1|25;kind:'PC'|'NC';sampleId:string};
export type VendorRow=VendorPatient|VendorControl;
function dateOnly(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('VENDOR_DATE_INVALID');return value.slice(5,7)+'/'+value.slice(8,10)+'/'+value.slice(0,4);}
function bangkok(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('VENDOR_PET_TIMESTAMP_REQUIRED');const local=new Date(Date.parse(value)+7*3600000).toISOString();return {day:local.slice(0,10),text:dateOnly(local.slice(0,10))+' '+local.slice(11,16)};}
/** CP874 is decoded by the PET parser. Reorder LIS surname^^prefix firstname into display name. */
export function petDisplayName(value:string){const [surname,prefix='',given='']=value.split('^');return value.includes('^^')?[given.trim(),surname.trim()].filter(Boolean).join(' '):value.includes('^')?[prefix.trim(),given.trim(),surname.trim()].filter(Boolean).join(' '):value.trim();}
export function patientVendorValues(p:VendorPatient,index:number){
 if(!p.name.trim()||!p.ln||!p.hn||!/^[A-Za-z0-9-]+$/.test(p.sampleId))throw Error('VENDOR_MATCHED_IDENTITY_REQUIRED');
 const collection=bangkok(p.collectionAt),received=bangkok(p.receivedAt);dateOnly(p.edd);dateOnly(p.dob);
 const gaDays=280-Math.round((Date.parse(p.edd+'T00:00:00Z')-Date.parse(collection.day+'T00:00:00Z'))/86400000);
 if(gaDays<0||gaDays>315||p.dob>collection.day||Date.parse(p.receivedAt)<Date.parse(p.collectionAt))throw Error('VENDOR_SOURCE_DATES_INCONSISTENT');
 const age=Number(collection.day.slice(0,4))-Number(p.dob.slice(0,4))-(collection.day.slice(5)<p.dob.slice(5)?1:0);
 return {A:p.sampleId.replace(/-1$/,''),B:'HNZ0011',C:'Peripheral Blood',D:'6~35°C',E:collection.text,F:received.text,G:`${Math.floor(gaDays/7)},${gaDays%7}`,H:p.pregnancy,I:'K Tube',J:p.ln,K:petDisplayName(p.name),L:p.identity,M:dateOnly(p.dob),N:age,O:p.hn,P:'Chonburi hospital',R:p.doctor,Z:index,AA:dateOnly(p.edd)};
}
/** Retain the immutable Owner vendor package, row styles, every header and all unspecified columns. */
export function exportOwnerNifty(template:Buffer,rows:VendorRow[]){
 if(sha256(template)!==NIFTY_TEMPLATE_SHA256)throw Error('NIFTY_TEMPLATE_SHA256_MISMATCH');
 if(new Set(rows.map(r=>r.slot)).size!==rows.length||rows.some(r=>r.slot<1||r.slot>48)||rows.filter(r=>r.kind==='PC'&&r.slot===1).length!==1||rows.filter(r=>r.kind==='NC'&&r.slot===25).length!==1||rows.filter(r=>r.kind==='PATIENT').length>46)throw Error('VENDOR_PHYSICAL_MAPPING_INVALID');
 const patients=rows.filter((r):r is VendorPatient=>r.kind==='PATIENT').sort((a,b)=>a.slot-b.slot);
 const ordered:VendorRow[]=[...patients,rows.find(r=>r.kind==='PC')!,rows.find(r=>r.kind==='NC')!];
 if(new Set(ordered.map(r=>r.sampleId.replace(/-1$/,''))).size!==ordered.length)throw Error('VENDOR_DUPLICATE_SAMPLE_ID');
 const parts=readArchive(template),name='xl/worksheets/sheet1.xml',sheet=parts.get(name)!.toString();
 const rowXml=[...sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)];
 const sourceRow=(n:number)=>rowXml.find(r=>Number(r[1])===n)?.[0];
 if(!sourceRow(2)||!sourceRow(48)||!sourceRow(49))throw Error('NIFTY_TEMPLATE_ROWS_REQUIRED');
 const columns=['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','R','Z','AA'];
 const filled=ordered.map((row,index)=>{
  const n=index+2,source=row.kind==='PATIENT'?2:row.kind==='PC'?48:49;
  let xml=sourceRow(source)!.replace(/\br="([A-Z]*)(\d+)"/g,(_,col)=>`r="${col}${n}"`);
  const values:Record<string,string|number>=row.kind==='PATIENT'?patientVendorValues(row,index+1):{A:row.sampleId.replace(/-1$/,''),B:'HNZ0011',C:'Peripheral Blood',D:'6~35°C',E:'',F:'',G:'',H:'',I:'K Tube',J:'',K:row.kind==='PC'?'Positive control':'Negative Control',L:'',M:'',N:'',O:'',P:'Chonburi hospital',R:'',Z:'',AA:''};
  for(const col of columns){const re=new RegExp(`<c\\b([^>]*\\br="${col}${n}"[^>]*)(?:/>|>[\\s\\S]*?</c>)`),match=re.exec(xml);if(!match)throw Error('NIFTY_COLUMN_MISSING:'+col);const v=values[col],attrs=match[1].replace(/\s+t="[^"]*"/g,'');const replacement=typeof v==='number'?`<c${attrs}><v>${v}</v></c>`:`<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;xml=xml.replace(match[0],replacement);}
  return xml;
 });
 // Remove the example's populated data rows. Keep its blank styled rows and all non-data package parts.
 let xml=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${sourceRow(1)}${filled.join('')}${rowXml.filter(r=>Number(r[1])>49).map(r=>r[0]).join('')}</sheetData>`);
 // The row49 style is used for both normal and urgent exports; no example PHI can remain in unused row slots.
 xml=xml.replace(/<dimension\b[^>]*\/>/,'<dimension ref="A1:AP1000"/>');parts.set(name,Buffer.from(xml));
 const bytes=writeArchive(parts);
 return {bytes,sha256:sha256(bytes),mapping:ordered.map((r,i)=>({exportRow:i+2,physicalSlot:r.slot,kind:r.kind})),patientCount:patients.length};
}
