import {PDFDocument,StandardFonts,degrees,rgb} from 'pdf-lib';
import {readArchive,writeArchive} from './archive';
import {generateTaskWorkbook,inspectTaskMaster,MASTER_SHA256,SHEETS} from './master';
import {loadRuntimeMaster} from './runtime';
import {exportTaskPdfs} from './native-pdf';

export type DraftTaskInput={sheetNumber:number;runLabel:string;plan:{workDate:string;operator:string;extractionLot:string;extractionExpiry:string;libraryLot:string;libraryExpiry:string};rows:readonly {slot:number;printedId:string}[];previewedAt:string;previewedBy:string};
const known=(value:string)=>value==='—'?'':value;
const lotExp=(lot:string,expiry:string)=>[known(lot),known(expiry)].filter(Boolean).join(' / ');
/** Ephemeral derivative only: no workbook draft, document number, issuance or storage. */
export function buildDraftTaskWorkbook(master:Buffer,input:DraftTaskInput){
 const sheet=SHEETS[input.sheetNumber-1];if(input.sheetNumber<1||input.sheetNumber>3||!sheet)throw Error('TASK_SHEET_REQUIRED');
 const matrix=inspectTaskMaster(master),values:Record<string,unknown>={};
 // Blank every selected Task input before applying the live plan. Null/missing values
 // in generateTaskWorkbook deliberately retain Master examples, so they cannot be
 // used to represent unrecorded actuals in this uncontrolled preview.
 for(const binding of matrix.bindings.filter(b=>b.sheet===sheet)){if(binding.dataType==='text')values[binding.key]='';else if(binding.dataType==='checkbox')values[binding.key]=false;}
 const prefix=`task.${input.sheetNumber}`;
 values[`${prefix}.date`]=known(input.plan.workDate);values[`${prefix}.run`]=input.runLabel;values[`${prefix}.operator`]=known(input.plan.operator);
 values[`${prefix}.extractionLotExp`]=lotExp(input.plan.extractionLot,input.plan.extractionExpiry);values[`${prefix}.libraryLotExp`]=lotExp(input.plan.libraryLot,input.plan.libraryExpiry);
 const first=(input.sheetNumber-1)*16+1;
 for(const row of input.rows){if(row.slot<first||row.slot>=first+16)throw Error('TASK_DRAFT_SLOT_OUTSIDE_SHEET');values[`slot.${row.slot}.printedSampleId`]=known(row.printedId);}
 const parts=readArchive(generateTaskWorkbook(master,values).bytes);
 // Unknown inputs are truly empty cells: never fabricated numeric zeroes or
 // empty string values that Excel would flag as duplicate patient identifiers.
 for(const [index,name] of SHEETS.entries()){
  if(name!==sheet)continue;
  const part=`xl/worksheets/sheet${index+1}.xml`;let xml=parts.get(part)!.toString();
  const emptyCells=new Set(matrix.bindings.filter(b=>b.sheet===name&&(b.dataType==='number'||b.dataType==='text'&&!b.rendering&&values[b.key]==='')).map(b=>b.cell));
  xml=xml.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(all,attrs:string)=>emptyCells.has(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1]??'')?`<c${attrs.replace(/\s+t="[^"]*"/g,'')}/>`:all);
  parts.set(part,Buffer.from(xml));
 }
 return writeArchive(parts);
}
type DraftRenderDeps={loadMaster:()=>Promise<Buffer>;render:(bytes:Buffer,sheets:readonly string[])=>Promise<readonly {sheet:string;bytes:Buffer}[]>};
/** The native Master supplies layout; pdf-lib adds only an unmistakable draft label. */
export async function renderDraftTaskPdf(input:DraftTaskInput,deps:DraftRenderDeps={loadMaster:loadRuntimeMaster,render:exportTaskPdfs}){
 const workbook=buildDraftTaskWorkbook(await deps.loadMaster(),input),sheet=SHEETS[input.sheetNumber-1];
 const output=await deps.render(workbook,[sheet]),native=output.find(p=>p.sheet===sheet);if(output.length!==1||!native)throw Error('TASK_DRAFT_NATIVE_SHEET_REQUIRED');
 const pdf=await PDFDocument.load(native.bytes),pages=pdf.getPages();
 if(pages.length!==2||pages.some(p=>Math.abs(p.getWidth()-595.28)>2||Math.abs(p.getHeight()-841.89)>2))throw Error('TASK_DRAFT_TWO_A4_PAGES_REQUIRED');
 const font=await pdf.embedFont(StandardFonts.Helvetica);
 for(const page of pages){page.drawText('DRAFT',{x:105,y:330,size:92,font,rotate:degrees(35),color:rgb(.7,0,0),opacity:.25});page.drawText('DRAFT - UNCONTROLLED PREVIEW - NOT A WORKING COPY',{x:14,y:page.getHeight()-11,size:8,font,color:rgb(.65,0,0)});}
 pdf.setTitle(`DRAFT ${input.runLabel} Task ${input.sheetNumber}`);
 pdf.setSubject(`Uncontrolled draft; Master SHA256 ${MASTER_SHA256}; previewed ${input.previewedAt}; actor ${input.previewedBy}; no issued document`);
 return Buffer.from(await pdf.save());
}
