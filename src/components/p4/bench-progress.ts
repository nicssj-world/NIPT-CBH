/** Shared Run header progress based on the saved measurements, transfers and exports for each step. */
export type StepKey="TASK"|"QC"|"POOL"|"SEQ";
export const STEP_ORDER:StepKey[]=["TASK","QC","POOL","SEQ"];

/** Task List sheet states from which the placement is locked (same list as packages/lab/batch.ts FINALIZED). "Amended" = re-opened, so not locked. */
export const LOCKED_SHEET_STATES=["PlacementFinalized","PreWorkIssued","InExecution","ExecutionRecorded","ExecutionVerified","CompletedIssued"] as const;
export const QC_STANDARDS=[["standard1","Standard 1"],["standard2","Standard 2"],["standard2Concentration","Standard 2 Conc."]] as const;

/** Identical to lab-bench.tsx's own `num`: only a real number counts as filled (a text "2.5" or "" is still missing). */
const num=(v:unknown)=>typeof v==="number"?v:null;

export type BenchFacts={revision:number;values:Record<string,unknown>;slots:{slot:number;kind:string}[];sourceStale?:boolean;actualPooling?:{current?:boolean}|null;exports:{kind:string;current?:boolean|null}[]};
const FIRST_CYCLE_KEYS=["seq.loadedDnb","seq.q30","seq.bic","seq.fit"] as const;

function qcKeys(slots:BenchFacts["slots"]){
 return [...slots.filter(s=>s.kind!=="EMPTY").map(s=>`slot.${s.slot}.libraryQc`),
  ...[1,2,3].flatMap(n=>QC_STANDARDS.map(([k])=>`qc.${n}.${k}`))];
}

/** QC fields still empty: every non-empty slot's library QC plus the three standards of each of the three Task Lists. */
export function qcMissingCount(slots:BenchFacts["slots"],values:Record<string,unknown>){
 return qcKeys(slots).filter(key=>num(values[key])===null).length;
}

export function benchSteps(d:BenchFacts|null,{qcDirty=false,pending=false}:{qcDirty?:boolean;pending?:boolean}={}):Record<Exclude<StepKey,"TASK">,StepStatus>{
 if(!d){
  const unknown={done:false,known:false,pending};
  return {QC:unknown,POOL:unknown,SEQ:unknown};
 }
 const keys=qcKeys(d.slots);
 const missing=keys.filter(key=>num(d.values[key])===null).length;
 const seqExported=d.exports.some(e=>e.kind==="HALOS_TASK_XLSX");
 const qcDone=!!d.revision&&!d.sourceStale&&!qcDirty&&missing===0;
 const qcMessage=qcDirty?"มีค่า QC ที่ยังไม่บันทึก":d.sourceStale?"ข้อมูลต้นทางของ QC เปลี่ยน":
  d.revision&&missing>0&&missing<keys.length?`บันทึก QC บางส่วน · ขาด ${missing} ช่อง`:
  seqExported&&missing===keys.length?"รอบันทึก QC Measurements":undefined;
 const poolDone=!!d.actualPooling?.current;
 const poolExported=d.exports.some(e=>e.kind==="POOL_CSV"&&e.current);
 const seqDone=!!d.revision&&FIRST_CYCLE_KEYS.every(key=>num(d.values[key])!==null);
 const poolMessage=poolExported?"ส่งออกไฟล์ Pooling แล้ว · รอบันทึก QC2":
  d.actualPooling?"รอบันทึก QC2 อีกครั้ง":seqExported?"รอบันทึก QC2":undefined;
 return {
  QC:{done:qcDone,known:true,message:qcMessage},
  POOL:{done:poolDone,known:true,message:poolDone?undefined:poolMessage},
  SEQ:{done:seqDone,known:true,message:seqExported&&!seqDone?"ส่งออกไฟล์ Sequencing แล้ว":undefined},
 };
}

/** Task List step: locked when all three sheets are in a locked state and the Run is not cancelled. */
export function taskListDone(sheets:{state:string}[],cancelled=false){
 return !cancelled&&sheets.length===3&&sheets.every(s=>(LOCKED_SHEET_STATES as readonly string[]).includes(s.state));
}

export type StepStatus={done:boolean;known:boolean;detail?:string;pending?:boolean;message?:string};
export const stepText=(s:StepStatus,current:boolean,key:StepKey)=>
 s.pending?"กำลังโหลดสถานะ…":!s.known?"ไม่ทราบสถานะ":s.done?(key==="TASK"?"ล็อกตำแหน่งครบแล้ว":"บันทึกครบแล้ว"):s.message??`${current?"กำลังทำ":"ยังไม่เสร็จ"}${s.detail?` · ${s.detail}`:""}`;
