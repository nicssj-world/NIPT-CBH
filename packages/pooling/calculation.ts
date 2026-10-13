import Decimal from 'decimal.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';

// Plan v6.2.1 Appendix C.3 FS-03..07. These are explicit scenario inputs,
// never an approved counting, desired-volume, pipette or buffer policy.
export const FORMULA_VERSION='FS03-07-SYNTHETIC-v1';
export const HOLDS=['OD-28','OD-29','OD-30','OD-31','FIELD-INVENTORY-F4'] as const;
export const numeric=z.string().regex(/^(0|[1-9]\d{0,5})(\.\d{1,8})?$/);
export const scenarioSchema=z.strictObject({
 controls:z.enum(['PATIENT_ONLY','PATIENT_PC_NC']),targetPmol:numeric,ngPerPmol:numeric,
 desiredVolume:numeric,buffer:z.enum(['TE','EB']),pipetteDecimals:z.number().int().min(2).max(6)
});
export type Scenario=z.infer<typeof scenarioSchema>;
export type CalculationMember={slot:number;kind:'PATIENT'|'PC'|'NC';concentration:string};
const D=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
export const digest=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
export function canonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function calculate(members:CalculationMember[],input:unknown){
 const scenario=scenarioSchema.parse(input),errors:string[]=[];
 if(!members.length)errors.push('N_MUST_BE_POSITIVE');
 if(new Set(members.map(m=>m.slot)).size!==members.length)errors.push('DUPLICATE_POSITION');
 if([scenario.targetPmol,scenario.ngPerPmol,scenario.desiredVolume].some(v=>new D(v).lte(0)))errors.push('POSITIVE_SCENARIO_INPUT_REQUIRED');
 const rows=members.map(m=>{
  if(!numeric.safeParse(m.concentration).success||new D(m.concentration).lte(0)){errors.push('INVALID_CONCENTRATION_'+m.slot);return {...m,exact:null,planned:null};}
  const volume=new D(scenario.targetPmol).times(scenario.ngPerPmol).div(members.length).div(m.concentration);
  return {...m,exact:volume.toString(),planned:volume.toFixed(scenario.pipetteDecimals)};
 });
 const total=rows.reduce((sum,r)=>sum.plus(r.exact??0),new D(0));
 const plannedTotal=rows.reduce((sum,r)=>sum.plus(r.planned??0),new D(0));
 const buffer=new D(scenario.desiredVolume).minus(total),plannedBuffer=new D(scenario.desiredVolume).minus(plannedTotal);
 if(buffer.lt(0)||plannedBuffer.lt(0))errors.push('NEGATIVE_BUFFER');
 if(rows.some(r=>r.planned!==null&&new D(r.planned).lte(0)))errors.push('ROUNDED_VOLUME_ZERO');
 return {formulaVersion:FORMULA_VERSION,precision:40,rounding:'ROUND_HALF_UP',displayDecimals:2,
  scenario,N:members.length,rows,total:total.toFixed(24),plannedTotal:plannedTotal.toFixed(scenario.pipetteDecimals),
  buffer:buffer.toFixed(24),plannedBuffer:plannedBuffer.toFixed(scenario.pipetteDecimals),valid:errors.length===0,errors,
  clinicalUsable:false as const,holds:[...HOLDS]};
}
export type Calculation=ReturnType<typeof calculate>;
/** Seeded sampling without replacement; k and population are unapproved synthetic proposals. */
export function selectCrosscheck(slots:number[],seed:string){
 return [...slots].sort((a,b)=>digest({seed,slot:a}).localeCompare(digest({seed,slot:b}))).slice(0,Math.min(3,slots.length));
}
export function compareCrosscheck(calc:Calculation,selected:number[],values:{slot:number;value:string}[]){
 if(values.length!==selected.length||new Set(values.map(v=>v.slot)).size!==selected.length||values.some(v=>!selected.includes(v.slot)))return false;
 // Exact equality at scenario precision, no invented clinical tolerance.
 return values.every(v=>numeric.safeParse(v.value).success&&new D(v.value).eq(calc.rows.find(r=>r.slot===v.slot)?.planned??'-1'));
}
