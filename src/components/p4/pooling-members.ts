/**
 * Which positions are in the actual pooling (Owner 2026-11-09): the same rule as the exported CSV. A position is pooled when it is a patient, PC or NC
 * with a calculated volume of at least 2 µL; a Blank, a Re-xxx slot, an empty position and anything below 2 µL (CSV value 0) is not.
 */
export type PoolRow={slot:number;volume:string|null;belowTwo:boolean};
export const isPooled=<R extends PoolRow>(row:R,poolable:(row:R)=>boolean)=>poolable(row)&&row.volume!==null&&!row.belowTwo;
export const actualPoolingMembers=<R extends PoolRow>(rows:R[],poolable:(row:R)=>boolean)=>rows.map(r=>({slot:r.slot,pooled:isPooled(r,poolable)}));
