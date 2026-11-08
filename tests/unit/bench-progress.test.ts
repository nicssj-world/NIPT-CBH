import {describe,expect,it} from "vitest";
import {FINALIZED} from "../../packages/lab/batch";
import {LOCKED_SHEET_STATES,benchSteps,qcMissingCount,stepText,taskListDone,type BenchFacts} from "../../src/components/p4/bench-progress";

const slots=[{slot:1,kind:"PC"},{slot:2,kind:"PATIENT"},{slot:3,kind:"EMPTY"}];
const qcFull=Object.fromEntries([...["slot.1.libraryQc","slot.2.libraryQc"].map(k=>[k,2.5]),...[1,2,3].flatMap(n=>["standard1","standard2","standard2Concentration"].map(k=>[`qc.${n}.${k}`,1]))]);
const facts=(o:Partial<BenchFacts>={}):BenchFacts=>({revision:1,values:qcFull,slots,actualPooling:null,exports:[],...o});

describe("Run step progress is evidence-based and shared by every Run page",()=>{
 it("locked Task List states are exactly the server's FINALIZED set",()=>{expect([...LOCKED_SHEET_STATES]).toEqual(FINALIZED);});
 it("Task List is done only when all three sheets are locked; a re-opened (Amended) or cancelled Run is not",()=>{
  const locked=[{state:"PlacementFinalized"},{state:"PreWorkIssued"},{state:"InExecution"}];
  expect(taskListDone(locked)).toBe(true);
  expect(taskListDone([...locked.slice(0,2),{state:"Amended"}])).toBe(false);
  expect(taskListDone([...locked.slice(0,2),{state:"PlanChecked"}])).toBe(false);
  expect(taskListDone(locked.slice(0,2))).toBe(false);
  expect(taskListDone(locked,true)).toBe(false);
 });
 it("QC is done only with a saved revision, nothing unsaved and no empty QC field",()=>{
  expect(qcMissingCount(slots,qcFull)).toBe(0);
  expect(benchSteps(facts()).QC).toBe(true);
  expect(benchSteps(facts({revision:0})).QC).toBe(false);
  expect(benchSteps(facts(),{dirty:true}).QC).toBe(false);
  expect(benchSteps(facts({values:{...qcFull,"slot.2.libraryQc":""}})).QC).toBe(false);
  expect(qcMissingCount(slots,{...qcFull,"qc.2.standard1":null})).toBe(1);
 });
 it("Pooling needs a current actual pooling; Sequencing also needs the exported HALOS file (export evidence, as before)",()=>{
  expect(benchSteps(facts()).POOL).toBe(false);
  expect(benchSteps(facts({actualPooling:{current:true}})).POOL).toBe(true);
  expect(benchSteps(facts({actualPooling:{current:true}})).SEQ).toBe(false);
  expect(benchSteps(facts({actualPooling:{current:true},exports:[{kind:"HALOS_TASK_XLSX"}]})).SEQ).toBe(true);
  expect(benchSteps(facts({exports:[{kind:"HALOS_TASK_XLSX"}]})).SEQ).toBe(false);   // an export without pooling is never "sequencing done"
 });
 it("an unknown status never reads as done",()=>{
  expect(stepText({done:true,known:false},false,"QC")).toBe("ไม่ทราบสถานะ");
  expect(stepText({done:false,known:false,pending:true},false,"QC")).toBe("กำลังโหลดสถานะ…");
  expect(stepText({done:false,known:true,detail:"ตัวอย่าง 27/45"},true,"TASK")).toBe("กำลังทำ · ตัวอย่าง 27/45");
  expect(stepText({done:false,known:true},false,"POOL")).toBe("ยังไม่เสร็จ");
  expect(stepText({done:true,known:true},false,"TASK")).toBe("ล็อกตำแหน่งครบแล้ว");
  expect(stepText({done:true,known:true},true,"SEQ")).toBe("บันทึกครบแล้ว");
 });
});
