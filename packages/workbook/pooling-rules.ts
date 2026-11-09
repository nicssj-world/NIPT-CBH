/**
 * Owner Pooling rules of 2026-11-07, applied to the generated copy of the master (the master bytes and the pinned hash stay immutable):
 * a BLANK control and a slot that goes to any Re-xxx never enter the Pooling count and get no volume. Without this the printed
 * Pooling Table (recalculated by Excel from the master formula) disagreed with the CSV and the Pooling screen, which already use the rule
 * (packages/pooling/owner-master.ts).
 */
export const POOLING_RULES_VERSION='exclude-blank-repeat-v1';
const COUNTA="COUNTA('QC measurements'!$C$7:$C$54)";
const qcCell=(slot:number)=>`'QC measurements'!C${slot+6}`;

/** Row 8..55 of the Pooling Table hold the volume of slot 1..48 (column C after the barcode column was inserted). */
export function applyPoolingRules(parts:Map<string,Buffer>,excludedSlots:readonly number[]){
 const slots=[...new Set(excludedSlots)].filter(s=>Number.isInteger(s)&&s>=1&&s<=48).sort((a,b)=>a-b);
 if(!slots.length)return [];
 const path='xl/worksheets/sheet5.xml',xml=parts.get(path)!.toString(),excluded=new Set(slots);
 // The denominator counts QC entries except those of excluded slots; an excluded slot with no QC value subtracts nothing.
 const measured=`(${COUNTA}-COUNTA(${slots.map(qcCell).join(',')}))`;
 let counted=0;
 const next=xml.replace(/<c r="C(\d+)"([^>]*)>([\s\S]*?)<\/c>/g,(all,row,attrs,body)=>{
  const slot=Number(row)-7;if(slot<1||slot>48||!/<f\b/.test(body))return all;
  if(excluded.has(slot))return `<c r="C${row}"${attrs.replace(/\s+t="[^"]*"/,'')} t="str"><f>""</f><v></v></c>`;
  if(!body.includes(COUNTA))return all;
  counted++;
  return `<c r="C${row}"${attrs}>${body.replace(COUNTA,measured)}</c>`;
 });
 // A template change must never silently skip the rule.
 if(counted!==48-slots.length)throw new Error('POOL_RULE_FORMULA_NOT_FOUND');
 parts.set(path,Buffer.from(next));
 return [path];
}
