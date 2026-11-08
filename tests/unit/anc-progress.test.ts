import {describe,expect,it} from "vitest";
import {KNOWN_ROUND_STATES,STAGE_STEP,queueProgress,registryProgress,stepStates,type RegistryFacts} from "../../src/components/p2/anc-progress";
import {stages} from "../../packages/anc/model";

const row=(o:Partial<RegistryFacts>={}):RegistryFacts=>({state:"Expected",analysis_started:false,round_number:1,received_at:null,consent_decision:null,identityVerified:true,released:false,hasResult:false,progress:{missing:[]},...o});
const LAB_WORDS=/FIFO|Task List|QC|Batch|Pool|HOLD|PendingCertification|ValidationBlocked/;

describe("ANC progress speaks people, not Lab (Owner 2026-11-08)",()=>{
 it("names every known round state without Lab vocabulary",()=>{
  for(const state of KNOWN_ROUND_STATES)for(const analysis_started of [false,true]){
   const p=registryProgress(row({state,analysis_started,received_at:state==="Expected"?null:"2026-11-01T02:00:00Z"}));
   expect(p.label,state).not.toMatch(LAB_WORDS);expect(p.todo,state).not.toMatch(LAB_WORDS);
  }
 });
 it("an unknown state is never silent: it asks the nurse to open the case",()=>{
  const p=registryProgress(row({state:"SomethingNew",received_at:"2026-11-01T02:00:00Z"}));
  expect(p.tone).toBe("check");expect(p.todo).toBe("ดูรายละเอียดเคส");
 });
 it("leaves the to-do empty only when nothing is pending on the ANC side",()=>{
  expect(registryProgress(row({state:"ReceivedInHIS",received_at:"x"})).todo).toBe("");
  expect(registryProgress(row({state:"ReceivedInHIS",analysis_started:true,received_at:"x"})).todo).toBe("");
  expect(registryProgress(row({state:"ReceivedInHIS",received_at:"x",progress:{missing:["a","b"]}})).todo).toBe("กรอกข้อมูลให้ครบ (ขาด 2 รายการ)");
  expect(registryProgress(row({consent_decision:"Declined",state:"ReceivedInHIS",received_at:"x"})).todo).not.toBe("");
  expect(registryProgress(row({identityVerified:false})).todo).not.toBe("");
 });
 it("a released result wins over every other state and has no to-do",()=>{
  const p=registryProgress(row({state:"RedrawRequested",hasResult:true}));
  expect(p).toMatchObject({step:3,label:"มีผลตรวจแล้ว",todo:""});
 });
 it("a redraw stops at the Lab step; the new round is again 'waiting for the Lab'",()=>{
  expect(registryProgress(row({state:"RedrawRequested",received_at:"x"}))).toMatchObject({tone:"warn",label:"ต้องเจาะเลือดใหม่"});
  expect(registryProgress(row({state:"Expected",round_number:2}))).toMatchObject({step:0,label:"รอห้อง Lab รับตัวอย่าง",todo:"เก็บตัวอย่างใหม่ ครั้งที่ 2"});
 });
 it("Completed is never shown as a result (mirrors the overview rule)",()=>{
  expect(registryProgress(row({state:"Completed",received_at:"x"})).step).toBe(2);
 });
 it("maps all seven overview stages plus exception, Lab words never leak",()=>{
  expect(Object.keys(STAGE_STEP).sort()).toEqual(stages.map(s=>s[0]).sort());
  for(const [stage] of stages){const p=queueProgress({stage,flags:[],hasResult:stage==="released",roundState:null});expect(p.label).not.toMatch(LAB_WORDS);}
  expect(queueProgress({stage:"exception",flags:["unmapped_state"],hasResult:false,roundState:null}).todo).toBe("ดูรายละเอียดเคส");
  expect(queueProgress({stage:"analysis",flags:["hold"],hasResult:false,roundState:null})).toMatchObject({tone:"stop",todo:"ติดต่อห้อง Lab"});
  expect(queueProgress({stage:"analysis",flags:["repeat"],hasResult:false,roundState:null}).todo).toBe("");
 });
 it("draws the three steps as done / now / stop",()=>{
  expect(stepStates(registryProgress(row()))).toEqual(["","",""]);
  expect(stepStates(registryProgress(row({state:"ReceivedInHIS",received_at:"x"})))).toEqual(["done","",""]);
  expect(stepStates(registryProgress(row({state:"ReceivedInHIS",received_at:"x",analysis_started:true})))).toEqual(["done","now",""]);
  expect(stepStates(registryProgress(row({hasResult:true})))).toEqual(["done","done","done"]);
  expect(stepStates(registryProgress(row({state:"RedrawRequested",received_at:"x"})))).toEqual(["done","stop",""]);
 });
});
