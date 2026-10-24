import {readArchive, sha256, writeArchive, xmlDecode, xmlEscape} from './archive';
import {textFitStyles} from './text-fit';
import {highlightExceptionalIds} from './exceptional-highlights';
import {highlightControls} from './control-highlights';
import {poolingAlerts} from './pooling-alerts';

export const MASTER_SHA256 = '4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1';
export const SHEETS = ['Ext. & Prep. Task List 1','Ext. & Prep. Task List 2','Ext. & Prep. Task List 3','QC measurements','Pooling Table','Seq Task-G50'] as const;
export type Binding = {key: string; sheet: string; cell: string; dataType: 'text'|'number'|'checkbox'; source: string; requiredCondition: string; defaultBehavior: 'master-value'; mapping: string; editable: true; rendering?:'append'|'parentheses'|'filename'};
export type InventoryCell = {sheet: string; cell: string; classification: 'editable'|'calculated'|'static'|'unmapped-blank'; text: string; formula: string|null; binding: Binding|null};
const cells = (xml: string) => [...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(m => ({xml:m[0], attrs:m[1], body:m[2]??'', ref:/\br="([A-Z]+\d+)"/.exec(m[1])?.[1]??''}));
const sharedStrings = (parts: Map<string,Buffer>) => [...(parts.get('xl/sharedStrings.xml')?.toString()??'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>m[1]);
const textOf = (body: string) => [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlDecode(m[1])).join('');
function sourceText(cell: ReturnType<typeof cells>[number], strings: string[]) {
  const v=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell.body)?.[1]??'';
  return /\bt="s"/.test(cell.attrs) ? textOf(strings[Number(v)]??'') : /\bt="inlineStr"/.test(cell.attrs) ? textOf(cell.body) : xmlDecode(v);
}
function lockedParts(master: Buffer) {
  if (sha256(master)!==MASTER_SHA256) throw new Error('TASK_MASTER_SHA256_MISMATCH');
  return readArchive(master);
}
/** Maps only observed input cells. Static/formula/merged subordinate cells are never promoted to writable inputs. */
function bindings(parts: Map<string,Buffer>): Binding[] {
  const result: Binding[]=[];
  const add=(sheet:number,cell:string,key:string,dataType:Binding['dataType'],source:string,mapping:string,requiredCondition='when recorded')=>result.push({key,sheet:SHEETS[sheet-1],cell,dataType,source,mapping,requiredCondition,defaultBehavior:'master-value',editable:true});
  for(let sheet=1;sheet<=3;sheet++) {
    add(sheet,'B4',`task.${sheet}.date`,'text','batch operational date','batch','for active task sheet');
    add(sheet,'B5',`task.${sheet}.run`,'text','batch run number','batch','for active task sheet');
    add(sheet,'K5',`task.${sheet}.operator`,'text','task operator','batch','for active task sheet');
    add(sheet,'B16',`task.${sheet}.extractionLotExp`,'text','extraction reagent lot and expiry','batch');
    add(sheet,'B17',`task.${sheet}.libraryLotExp`,'text','library reagent lot and expiry','batch');
    for(let slot=0;slot<16;slot++) {
      const row=8+slot%8, position=(sheet-1)*16+slot+1;
      add(sheet,`${slot<8?'B':'H'}${row}`,`slot.${position}.printedSampleId`,'text','frozen placement printed sample ID','specimen/analytical attempt','for occupied slot, including PC/NC/BLANK');
      add(sheet,`${slot<8?'D':'J'}${row}`,`slot.${position}.extractionQc`,'number','extraction concentration','QC');
      add(sheet,`${slot<8?'E':'K'}${row}`,`slot.${position}.transferChecked`,'text','operator transfer verification','specimen');
    }
  }
  add(4,'D3','qc.date','text','QC operational date','QC'); add(4,'G3','qc.operator','text','QC operator','QC');
  for(let position=1;position<=48;position++) add(4,`C${position+6}`,`slot.${position}.libraryQc`,'number','library concentration ng/uL','QC','for occupied slot, including PC/NC/BLANK');
  for(const row of [19,20,21]) for(const [col,run] of [['F',1],['G',2],['H',3]] as const) add(4,`${col}${row}`,`qc.${run}.${row===19?'standard1':row===20?'standard2':'standard2Concentration'}`,'number','QC reference standard measurement','QC');
  add(5,'C20','pool.instrumentCsvFileStem','text','operator-confirmed instrument CSV filename without extension','pool');result[result.length-1].rendering='filename';
  add(5,'C3','pool.date','text','pool operational date','pool'); add(5,'E3','pool.operator','text','pool operator','pool');
  for(const [cell,key] of [['D8','pool.standard1'],['D10','pool.standard2'],['D12','pool.standard2Concentration']] as const) {add(5,cell,key,'number','QC2 standard measurement','pool/QC');result[result.length-1].rendering='append';}
  add(5,'E14','pool.concentration','number','QC2 pool concentration','pool/QC');add(5,'D52','pool.dilutionC1','number','measured concentration before dilution','pool/QC');
  add(6,'B4','seq.date','text','sequencing operational date','sequencing'); add(6,'D4','seq.operator','text','sequencing operator','sequencing');
  add(6,'B35','seq.dnbId','text','DNB identifier','DNB','when sequencing is planned');
  add(6,'F4','seq.instrument','number','sequencer number','sequencing');add(6,'H4','seq.barcodeType','number','barcode type','sequencing');
  add(6,'B26','seq.chipPositionedFirmly','checkbox','operator sequencing chip positioning confirmation','sequencing');result[result.length-1].rendering='parentheses';
  for(const [cell,key] of [['C18','seq.standard1'],['D18','seq.standard2'],['E18','seq.standard2Concentration'],['C22','seq.dnbConcentration'],['D22','seq.dilutedConcentration']] as const) {add(6,cell,key,'number','QC3 DNB/reference measurement','DNB/QC');result[result.length-1].rendering='append';}
  for(const [cell,key] of [['E36','seq.driveMemoryTb'],['H37','seq.negativePressureKpa'],['B42','seq.loadedDnb'],['D42','seq.q30'],['E42','seq.bic'],['G42','seq.fit']] as const) add(6,cell,key,'number','sequencing observed value','sequencing/QC');
  for(const row of [28,29,30,31]) add(6,`F${row}`,`seq.reagentConfirmation.${row}`,'text','operator reagent confirmation','sequencing');
  // Checkbox rich runs are retained byte-for-byte apart from the checkbox glyph itself.
  const strings=sharedStrings(parts);
  for(let sheet=1;sheet<=6;sheet++) for(const c of cells(parts.get(`xl/worksheets/sheet${sheet}.xml`)!.toString())) {
    if(sourceText(c,strings).includes('☐')) add(sheet,c.ref,`check.${sheet}.${c.ref}`,'checkbox','operator preparation/checklist record',sheet<=3?'batch':sheet===4?'QC':sheet===5?'pool':'sequencing');
  }
  return result;
}
export function inspectTaskMaster(master: Buffer): {masterSha256:string;bindings:Binding[];cells:InventoryCell[];formulaCount:number} {
  const parts=lockedParts(master), defs=bindings(parts), strings=sharedStrings(parts), inventory:InventoryCell[]=[];
  for(let sheet=1;sheet<=6;sheet++) {
    const xml=parts.get(`xl/worksheets/sheet${sheet}.xml`)!.toString();
    for(const c of cells(xml)) {
      const formula=/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(c.body)?.[1]??null;
      const binding=defs.find(d=>d.sheet===SHEETS[sheet-1]&&d.cell===c.ref)??null, text=sourceText(c,strings);
      inventory.push({sheet:SHEETS[sheet-1],cell:c.ref,text,formula,binding,classification:formula!==null?'calculated':binding?'editable':text?'static':'unmapped-blank'});
    }
  }
  const formulaCount=inventory.filter(c=>c.formula!==null).length;
  if(formulaCount!==149) throw new Error('TASK_MASTER_FORMULA_COUNT_MISMATCH');
  for(const d of defs) if(!inventory.some(c=>c.binding===d&&c.classification==='editable')) throw new Error(`TASK_BINDING_INVALID:${d.key}`);
  return {masterSha256:MASTER_SHA256,bindings:defs,cells:inventory,formulaCount};
}
export function validateTaskValues(master: Buffer, values: Record<string,unknown>): void {
  const matrix=inspectTaskMaster(master);
  for(const [key,value] of Object.entries(values)) {
    const binding=matrix.bindings.find(b=>b.key===key);
    if(!binding) throw new Error(`TASK_FIELD_UNKNOWN:${key}`);
    if(value===null)continue;
    if(binding.dataType==='number' ? typeof value!=='number'||!Number.isFinite(value) : binding.dataType==='checkbox' ? typeof value!=='boolean' : typeof value!=='string'||value.length>1000||/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new Error(`TASK_FIELD_TYPE:${key}`);
  }
}
/** Always starts from the immutable master. Missing/null values reset to the master, never a previous batch's derivative. */
export function generateTaskWorkbook(master: Buffer, values: Record<string,unknown>,options:{urgent40?:boolean;exceptionalSlots?:number[]}={}) {
  validateTaskValues(master,values);
  const parts=lockedParts(master), defs=bindings(parts), strings=sharedStrings(parts), changedParts:string[]=[];
  const fitting=textFitStyles(parts);
  for(let sheet=1;sheet<=6;sheet++) {
    const path=`xl/worksheets/sheet${sheet}.xml`, original=parts.get(path)!.toString();
    let xml=original;
    for(const d of defs.filter(d=>d.sheet===SHEETS[sheet-1])) {
      const value=values[d.key]; if(value===undefined||value===null)continue;
      const c=cells(xml).find(c=>c.ref===d.cell); if(!c||/<f\b/.test(c.body))throw new Error(`TASK_FIELD_PROTECTED:${d.key}`);
      let attrs=c.attrs.replace(/\s+t="[^"]*"/g,'');
      if(d.dataType==='text'&&!d.rendering&&String(value).length){const fitted=fitting.style(Number(/\bs="(\d+)"/.exec(attrs)?.[1]??0),/^task\.\d+\.(?:extractionLotExp|libraryLotExp)$/.test(d.key));attrs=/\bs="\d+"/.test(attrs)?attrs.replace(/\bs="\d+"/,`s="${fitted}"`):attrs+` s="${fitted}"`;}
      let body:string;
      if(d.dataType==='checkbox') {
        const index=Number(/<v>(\d+)<\/v>/.exec(c.body)?.[1]);
        const rich=/\bt="s"/.test(c.attrs)?strings[index]:/<is>([\s\S]*?)<\/is>/.exec(c.body)?.[1];
        const placeholder=d.rendering==='parentheses'?'(  )':'☐';
        if(!rich||!rich.includes(placeholder))throw new Error('TASK_CHECKBOX_SOURCE_INVALID');
        body=`<is>${rich.replace(placeholder,value?(d.rendering==='parentheses'?'( ✓ )':'☑'):placeholder)}</is>`;
      } else if(d.rendering==='filename'){
        const index=Number(/<v>(\d+)<\/v>/.exec(c.body)?.[1]);const rich=/\bt="s"/.test(c.attrs)?strings[index]:undefined;
        if(!rich?.includes('..เติมชื่อไฟล์........'))throw new Error('TASK_FILENAME_SOURCE_INVALID');
        body=`<is>${rich.replace('..เติมชื่อไฟล์........',xmlEscape(String(value)))}</is>`;
      } else if(d.rendering==='append') {
        const index=Number(/<v>(\d+)<\/v>/.exec(c.body)?.[1]);
        const rich=/\bt="s"/.test(c.attrs)?strings[index]:undefined;
        if(!rich)throw new Error('TASK_EMBEDDED_SOURCE_INVALID');
        // Append within the existing final text run, retaining font overrides and every static character.
        const last=rich.lastIndexOf('</t>');if(last<0)throw new Error('TASK_EMBEDDED_SOURCE_INVALID');
        const slot=/…\.{2,}/;
        body=`<is>${slot.test(rich)?rich.replace(slot,xmlEscape(String(value))):rich.slice(0,last)+xmlEscape(String(value))+rich.slice(last)}</is>`;
      } else body=d.dataType==='number'?`<v>${value}</v>`:`<is><t xml:space="preserve">${xmlEscape(value as string)}</t></is>`;
      xml=xml.replace(c.xml,`<c${attrs}${d.dataType==='number'&&!d.rendering?'':' t="inlineStr"'}>${body}</c>`);
    }
    if(Object.keys(values).length) {
      // Cached master values are not measurements for this batch. Excel must calculate the preserved formulas.
      xml=xml.replace(/(<c\b[^>]*>)([\s\S]*?)(<\/c>)/g,(all,start,body,end)=>/<f\b/.test(body)?start+body.replace(/<v\b[^>]*>[\s\S]*?<\/v>/g,'')+end:all);
    }
    if(xml!==original) {parts.set(path,Buffer.from(xml));changedParts.push(path);}
  }
  if(fitting.finish())changedParts.push('xl/styles.xml');
  for(const name of highlightControls(parts,options.urgent40))if(!changedParts.includes(name))changedParts.push(name);
  const exceptionalTargets=defs.filter(d=>options.exceptionalSlots?.some(slot=>d.key===`slot.${slot}.printedSampleId`)).map(d=>({sheet:SHEETS.indexOf(d.sheet as typeof SHEETS[number])+1,cell:d.cell}));
  for(const name of highlightExceptionalIds(parts,exceptionalTargets))if(!changedParts.includes(name))changedParts.push(name);
  for(const name of poolingAlerts(parts,values))if(!changedParts.includes(name))changedParts.push(name);
  if(Object.keys(values).length) {
    const path='xl/workbook.xml', original=parts.get(path)!.toString();
    const calc=/<calcPr\b([^>]*?)\/>/.exec(original);
    if(!calc)throw new Error('TASK_MASTER_CALCULATION_SETTINGS_MISSING');
    const attrs=calc[1].replace(/\s+(?:fullCalcOnLoad|forceFullCalc|calcMode)="[^"]*"/g,'');
    parts.set(path,Buffer.from(original.replace(calc[0],`<calcPr${attrs} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`)));changedParts.push(path);
  }
  const bytes=writeArchive(parts);
  return {bytes,sha256:sha256(bytes),masterSha256:MASTER_SHA256,bindingKeys:Object.keys(values),changedParts};
}
