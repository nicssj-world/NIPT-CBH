import Decimal from 'decimal.js';
import {readArchive,sha256} from '../workbook/archive';

const D=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
export const POOL_CSV_SHA256='2ea12e86e1429be6ad9720c3b1b45f90588ad5c1316548146b5062b16bd6977a';
export type PhysicalQc={slot:number;sampleId:string;kind:'PATIENT'|'PC'|'NC'|'BLANK'|'EMPTY';concentration:string|null};
function number(value:string){if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,12})?$/.test(value))throw Error('QC_NUMBER_INVALID');return new D(value);}
/** Read the actual approved formula and constants; never substitute a scenario or clinical policy. */
export function ownerPoolFormula(master:Buffer){
 const parts=readArchive(master),sheet=parts.get('xl/worksheets/sheet5.xml')?.toString();
 if(!sheet)throw Error('POOL_MASTER_REQUIRED');
 const cell=(ref:string)=>new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(sheet)?.[1]??'';
 const value=(ref:string)=>{const raw=/<v>([^<]+)<\/v>/.exec(cell(ref))?.[1];if(!raw)throw Error('POOL_MASTER_CONSTANT_REQUIRED:'+ref);return number(raw);};
 for(let slot=1;slot<=48;slot++){
  const formula=/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cell('B'+(slot+7)))?.[1];
  const expected=`IF('QC measurements'!C${slot+6}="","",(160/COUNTA('QC measurements'!$C$7:$C$54)*$B$6/'QC measurements'!C${slot+6}))`;
  if(formula!==expected)throw Error('POOL_MASTER_FORMULA_MISMATCH:'+slot);
 }
 if(!cell('F52').includes('<f>(D54*F54)/D52</f>')||!cell('D55').includes('<f>F54-F52</f>'))throw Error('POOL_DILUTION_FORMULA_MISMATCH');
 return {masterSha256:sha256(master),amount:value('B6').toString(),dilutionTarget:value('D54').toString(),dilutionTotal:value('F54').toString()};
}
export function calculateOwnerPooling(master:Buffer,rows:PhysicalQc[]){
 const formula=ownerPoolFormula(master);
 if(rows.length!==48||rows.some((r,i)=>r.slot!==i+1)||rows[0].kind!=='PC'||rows[24].kind!=='NC'||!['BLANK','PATIENT'].includes(rows[39].kind))throw Error('POOL_PHYSICAL_MAPPING_INVALID');
 const measured=rows.filter(r=>r.concentration!==null);
 if(!measured.length)throw Error('QC_MEASUREMENTS_REQUIRED');
 const output=rows.map(r=>{
  if(['PATIENT','PC','NC'].includes(r.kind)&&(!r.sampleId||r.concentration===null))throw Error('QC_MEASUREMENT_REQUIRED:'+r.slot);
  if(r.kind==='EMPTY'&&r.concentration!==null)throw Error('QC_EMPTY_SLOT_MEASUREMENT:'+r.slot);
  if(r.concentration===null)return {...r,volume:null,belowTwo:false,csvVolume:''};
  const c=number(r.concentration);if(c.lte(0))throw Error('QC_CONCENTRATION_MUST_BE_POSITIVE:'+r.slot);
  // COUNTA counts every supplied numeric QC input, including controls and a measured BLANK.
  const volume=new D(160).div(measured.length).times(formula.amount).div(c),belowTwo=volume.lt(2);
  return {...r,volume:volume.toString(),belowTwo,csvVolume:belowTwo?'0':volume.toString()};
 });
 const total=output.reduce((sum,r)=>sum.plus(r.volume??0),new D(0)),desired=new D(48).times(formula.amount);
 return {formula,measuredCount:measured.length,rows:output,total:total.toString(),desired:desired.toString(),buffer:desired.minus(total).toString()};
}
export function poolConcentrationOutOfRange(value:string){const c=number(value);return c.lt(3)||c.gt('3.6');}
export function ownerDilution(master:Buffer,c1:string){const f=ownerPoolFormula(master),c=number(c1);if(c.lte(0))throw Error('DILUTION_C1_MUST_BE_POSITIVE');const v1=new D(f.dilutionTarget).times(f.dilutionTotal).div(c),eb=new D(f.dilutionTotal).minus(v1);if(eb.lt(0))throw Error('DILUTION_NEGATIVE_EB');return {v1:v1.toString(),eb:eb.toString(),c1,target:f.dilutionTarget,total:f.dilutionTotal};}
/** Only A/F are replaced. Copy the raw B–E field bytes, header, final newline and 48-row order. */
export function exportOwnerPoolingCsv(template:Buffer,calculation:ReturnType<typeof calculateOwnerPooling>){
 if(sha256(template)!==POOL_CSV_SHA256)throw Error('POOL_CSV_TEMPLATE_SHA256_MISMATCH');
 const text=template.toString('utf8'),lines=text.split('\r\n');
 if(lines.length!==50||lines.at(-1)!=='')throw Error('POOL_CSV_TEMPLATE_STRUCTURE');
 const quote=(s:string)=>/[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
 for(let slot=1;slot<=48;slot++){
  const fields=lines[slot].split(',');if(fields.length!==6)throw Error('POOL_CSV_TEMPLATE_STRUCTURE');
  const r=calculation.rows[slot-1];if(/[\u0000-\u001f\u007f]/.test(r.sampleId)||/^[=+@-]/.test(r.sampleId))throw Error('POOL_CSV_SAMPLE_ID_INVALID');
  lines[slot]=[quote(r.sampleId),...fields.slice(1,5),r.csvVolume].join(',');
 }
 return Buffer.from(lines.join('\r\n'),'utf8');
}
