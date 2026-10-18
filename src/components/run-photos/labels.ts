import type {RunGallery} from "../../../packages/run-photos/service";
// Shared by server pages and client components (no "use client"): Thai labels and the declared-range coverage helper.
const STATE_TEXT:Record<string,string>={Draft:"กำลังจัด Batch",InPreparation:"เตรียมงาน",ExtractionLibrary:"Extraction / Library",QC1Complete:"QC1 เสร็จ",Cancelled:"ยกเลิกแล้ว"};
export const runStateText=(s:string)=>STATE_TEXT[s]??s;
export const rangeText=(from:number|null,to:number|null)=>from===null?null:from===to?`คนที่ ${from}`:`คนที่ ${from}–${to}`;
/** Slots and sample codes covered by a declared range, from the Run's actual placement (controls are not counted). */
export function coverage(placement:RunGallery["placement"],from:number|null,to:number|null){
 if(from===null||to===null||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from)return null;
 const rows=placement.filter(p=>p.ordinal>=from&&p.ordinal<=to);
 return {rows,beyond:to>placement.length,text:rows.length?`ตำแหน่ง ${rows[0].slot}${rows.length>1?`–${rows[rows.length-1].slot}`:""} · ${rows.length} ตัวอย่างตามการจัดวางปัจจุบัน`:"ยังไม่มีตัวอย่างในลำดับนี้"};
}
