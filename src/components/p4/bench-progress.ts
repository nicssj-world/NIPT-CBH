/**
 * One definition of "which step of a Run is done", shared by the Run pages (Owner 2026-11-09: a four-step header on every Run page).
 * Nothing here is a new rule: QC / Pooling / Sequencing are exactly what lab-bench.tsx computed inline, and "Task List done" is the
 * server's own LOCKED set (packages/lab/batch.ts FINALIZED; tests/unit/bench-progress.test.ts keeps the two in sync).
 * A step is only ever "done" from evidence in the loaded data; an unreadable status is reported as unknown, never as done.
 */
export type StepKey="TASK"|"QC"|"POOL"|"SEQ";
export const STEP_ORDER:StepKey[]=["TASK","QC","POOL","SEQ"];

/** Task List sheet states from which the placement is locked (same list as packages/lab/batch.ts FINALIZED). "Amended" = re-opened, so not locked. */
export const LOCKED_SHEET_STATES=["PlacementFinalized","PreWorkIssued","InExecution","ExecutionRecorded","ExecutionVerified","CompletedIssued"] as const;
export const QC_STANDARDS=[["standard1","Standard 1"],["standard2","Standard 2"],["standard2Concentration","Standard 2 Conc."]] as const;

/** Identical to lab-bench.tsx's own `num`: only a real number counts as filled (a text "2.5" or "" is still missing). */
const num=(v:unknown)=>typeof v==="number"?v:null;

export type BenchFacts={revision:number;values:Record<string,unknown>;slots:{slot:number;kind:string}[];actualPooling?:{current?:boolean}|null;exports:{kind:string}[]};

/** QC fields still empty: every non-empty slot's library QC plus the three standards of each of the three Task Lists. */
export function qcMissingCount(slots:BenchFacts["slots"],values:Record<string,unknown>){
 return slots.filter(s=>s.kind!=="EMPTY").filter(s=>num(values[`slot.${s.slot}.libraryQc`])===null).length
  +[1,2,3].flatMap(n=>QC_STANDARDS.map(([k])=>`qc.${n}.${k}`)).filter(k=>num(values[k])===null).length;
}

/** QC / Pooling / Sequencing done flags. `values`/`dirty` let the editing page pass what is on screen; other pages pass the saved data. */
export function benchSteps(d:BenchFacts,opts:{values?:Record<string,unknown>;dirty?:boolean}={}){
 const values=opts.values??d.values,qcDone=!!d.revision&&!opts.dirty&&qcMissingCount(d.slots,values)===0;
 const poolDone=!!d.actualPooling?.current;
 return {QC:qcDone,POOL:poolDone,SEQ:poolDone&&d.exports.some(e=>e.kind==="HALOS_TASK_XLSX")} as Record<"QC"|"POOL"|"SEQ",boolean>;
}

/** Task List step: locked when all three sheets are in a locked state and the Run is not cancelled. */
export function taskListDone(sheets:{state:string}[],cancelled=false){
 return !cancelled&&sheets.length===3&&sheets.every(s=>(LOCKED_SHEET_STATES as readonly string[]).includes(s.state));
}

export type StepStatus={done:boolean;known:boolean;detail?:string;pending?:boolean};
export const stepText=(s:StepStatus,current:boolean,key:StepKey)=>
 s.pending?"กำลังโหลดสถานะ…":!s.known?"ไม่ทราบสถานะ":s.done?(key==="TASK"?"ล็อกตำแหน่งครบแล้ว":"บันทึกครบแล้ว"):current?`กำลังทำ${s.detail?` · ${s.detail}`:""}`:`ยังไม่เสร็จ${s.detail?` · ${s.detail}`:""}`;
