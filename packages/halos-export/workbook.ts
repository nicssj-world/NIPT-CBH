import {z} from 'zod';
import {BARCODE_ORDER,HEADERS} from './contract';
import {readArchive,sha256,writeArchive,xmlEscape} from '../workbook/archive';

const opaque=z.string().min(1).max(200).refine(v=>v.trim().length>0&&!/[\x00-\x1f\x7f]/.test(v));
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const reference=z.strictObject({id:opaque,revision:z.number().int().positive(),sha256:hash});
const inputSchema=z.strictObject({
  batch:reference,placement:reference,pool:reference,
  dnb:z.strictObject({id:opaque,workDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),dateBasis:z.enum(['intended','actual'])}),
  // Mapping provenance is mandatory. It is never manufactured from physical ordering.
  mapping:z.strictObject({id:opaque,revision:z.number().int().positive(),sha256:hash}),
  excludedBlank:z.strictObject({physicalPosition:z.literal(40),role:z.literal('BLANK')}),
  members:z.array(z.strictObject({memberKey:opaque,physicalPosition:z.number().int().min(1).max(48),role:z.enum(['PATIENT','PC','NC']),exportSampleId:opaque,printedSampleId:opaque,lnHalos:opaque,barcodeIndex:z.number().int().min(1).max(48),barcodeType:opaque})).length(47),
}).superRefine((value,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  const date=new Date(`${value.dnb.workDate}T00:00:00Z`);
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value.dnb.workDate||value.dnb.id!==`DNB${value.dnb.workDate.replaceAll('-','')}`)fail('HALOS_DNB_DATE_MISMATCH');
  for(const key of ['memberKey','physicalPosition','exportSampleId','printedSampleId','lnHalos','barcodeIndex'] as const)if(new Set(value.members.map(m=>m[key])).size!==47)fail(`HALOS_DUPLICATE_${key}`);
  if(value.members.some((m,i)=>m.barcodeIndex!==BARCODE_ORDER[i]))fail('HALOS_BARCODE_ORDER_MISMATCH');
  if(value.members.some(m=>m.physicalPosition===40))fail('HALOS_BLANK_INCLUDED');
  if(value.members.filter(m=>m.role==='PC').length!==1||value.members.find(m=>m.role==='PC')?.physicalPosition!==1)fail('HALOS_PC_MISMATCH');
  if(value.members.filter(m=>m.role==='NC').length!==1||value.members.find(m=>m.role==='NC')?.physicalPosition!==25)fail('HALOS_NC_MISMATCH');
  if(new Set(value.members.map(m=>m.barcodeType)).size!==1)fail('HALOS_MIXED_BARCODE_TYPE');
});
export type OperationalHalosInput=z.input<typeof inputSchema>;
const textCell=(ref:string,value:string)=>`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
/** Produces a real XLSX. This proves the owner cell contract, not acceptance by a live HALOS installation. */
export function generateHalosWorkbook(input:unknown) {
  const source=inputSchema.parse(input);
  const rows=[`<row r="1">${HEADERS.map((h,i)=>textCell(`${String.fromCharCode(65+i)}1`,h)).join('')}</row>`];
  for(const [i,m] of source.members.entries()) {
    const row=i+2;
    rows.push(`<row r="${row}">${textCell(`A${row}`,m.exportSampleId)}${textCell(`B${row}`,'L01')}${textCell(`C${row}`,source.dnb.id)}<c r="D${row}"><v>${m.barcodeIndex}</v></c><c r="E${row}"/></row>`);
  }
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const parts=new Map<string,Buffer>([
    ['[Content_Types].xml',Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')],
    ['_rels/.rels',Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')],
    ['xl/workbook.xml',Buffer.from(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ['xl/_rels/workbook.xml.rels',Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')],
    ['xl/worksheets/sheet1.xml',Buffer.from(`<worksheet xmlns="${ns}"><dimension ref="A1:E48"/><sheetData>${rows.join('')}</sheetData></worksheet>`)],
  ]);
  const bytes=writeArchive(parts);
  const manifest={version:'halos-xlsx-v1' as const,sheet:'Sheet1' as const,range:'A1:E48' as const,dataRows:47 as const,fileSha256:sha256(bytes),sourceSha256:sha256(JSON.stringify(source)),source,liveHalosImportVerified:false as const};
  return {bytes,manifest};
}
/** Exact readback checks every native part and byte against its frozen source, including cell types and real blanks. */
export function verifyHalosWorkbook(input:unknown,bytes:Buffer) {
  const expected=generateHalosWorkbook(input), actual=readArchive(bytes), parts=readArchive(expected.bytes);
  if(actual.size!==parts.size||[...parts].some(([name,part])=>!actual.get(name)?.equals(part)))throw new Error('HALOS_WORKBOOK_READBACK_MISMATCH');
  return {...expected.manifest,fileSha256:sha256(bytes)};
}
