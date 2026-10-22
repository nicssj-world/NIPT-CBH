import {readArchive,writeArchive,sha256,xmlEscape} from '../workbook/archive';
export const TASK_IMPORT_TEMPLATE_SHA256='1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec';
export function bangkokDnbId(clickedAt:Date){
 if(!Number.isFinite(clickedAt.getTime()))throw Error('TASK_IMPORT_CLICK_DATE_INVALID');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(clickedAt);
 return 'DNB'+day.replaceAll('-','');
}
export function niftyPatientEligible(lineage:{attemptNumber:number;repeatOrderId:string|null;previousSeqOnSameRound:boolean}){
 return lineage.attemptNumber===1&&lineage.repeatOrderId===null&&!lineage.previousSeqOnSameRound;
}
export type ActualTaskMember={slot:number;sampleId:string};
/** Members must already be verified against frozen actual-transfer evidence by the service. */
export function exportOwnerTaskImport(template:Buffer,members:ActualTaskMember[],clickedAt:Date){
 if(sha256(template)!==TASK_IMPORT_TEMPLATE_SHA256)throw Error('TASK_IMPORT_TEMPLATE_SHA256_MISMATCH');
 if(new Set(members.map(m=>m.slot)).size!==members.length)throw Error('TASK_IMPORT_DUPLICATE_POSITION');
 if(members.some(m=>!Number.isInteger(m.slot)||m.slot<1||m.slot>48||!m.sampleId.trim()||/[\x00-\x1f\x7f]/.test(m.sampleId)))throw Error('TASK_IMPORT_MEMBER_INVALID');
 const parts=readArchive(template),name='xl/worksheets/sheet1.xml',sheet=parts.get(name)!.toString(),source=[...sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)];
 if(source.length!==48||!parts.get('xl/workbook.xml')!.toString().includes('name="Sheet1"'))throw Error('TASK_IMPORT_SCHEMA_MISMATCH');
 const header=source[0][0],byPosition=new Map(source.slice(1).map(r=>[Number(/<c\b[^>]*r="D\d+"[^>]*><v>(\d+)<\/v><\/c>/.exec(r[0])?.[1]),r[0]]));
 const ordered=[...members].sort((a,b)=>a.slot-b.slot),dnbId=bangkokDnbId(clickedAt);
 const rows=ordered.map((m,i)=>{
  const n=i+2;
  // The source omitted physical 13 accidentally; its adjacent interior-row style is identical.
  let row=(byPosition.get(m.slot)??byPosition.get(14)!).replace(/\br="([A-Z]*)(\d+)"/g,(_,col)=>`r="${col}${n}"`);
  for(const [col,value]of [['A',m.sampleId],['B','L01'],['C',dnbId],['D',m.slot]] as const){
   const re=new RegExp(`<c\\b([^>]*\\br="${col}${n}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`),match=re.exec(row);if(!match)throw Error('TASK_IMPORT_CELL_MISSING');
   const attrs=match[1].replace(/\s+t="[^"]*"/g,'');row=row.replace(re,typeof value==='number'?`<c${attrs}><v>${value}</v></c>`:`<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`);
  }
  row=row.replace(new RegExp(`<c\\b[^>]*r="E${n}"[^>]*(?:/>|>[\\s\\S]*?</c>)`),'');
  return row.replace('</row>',`<c r="E${n}"/></row>`);
 });
 const xml=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${header}${rows.join('')}</sheetData>`).replace(/<dimension\b[^>]*\/>/,`<dimension ref="A1:E${ordered.length+1}"/>`);
 parts.set(name,Buffer.from(xml));const bytes=writeArchive(parts);
 return {bytes,sha256:sha256(bytes),dnbId,mapping:ordered.map((m,i)=>({exportRow:i+2,physicalSlot:m.slot,sampleId:m.sampleId})),count:ordered.length};
}
