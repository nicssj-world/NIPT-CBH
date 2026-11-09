/**
 * ANC speaks people, not Lab (Owner 2026-11-08). Every internal state folds into one of three progress steps
 * (รับตัวอย่าง → ตรวจวิเคราะห์ → มีผลตรวจ) or a stop that needs the nurse. Presentation only: no state, predicate
 * or API changes. Fail-safe: an unknown state never reads as "nothing to do"; it asks the nurse to open the case.
 */
import type {QueueItem,Stage} from "../../../packages/anc/model";

export type ProgressStep=0|1|2|3;
/** The four Lab Run steps inside "กำลังตรวจวิเคราะห์" (Owner 2026-11-09), in order. */
export const LAB_STEP_NAMES=["ลง Task List","ตรวจ QC","Pooling","Sequencing"] as const;
export type Progress={
 /** Lab Run steps completed (0-4) while being analysed; absent when unknown */
 labSteps?:number|null;
 /** 0 = not at the Lab yet, 1 = received, 2 = being analysed, 3 = result available */
 step:ProgressStep;
 tone:"waiting"|"received"|"testing"|"done"|"warn"|"stop"|"check";
 label:string;
 /** why it stopped, in people language */
 reason?:string;
 /** the nurse's own next action; empty only when the system can confirm nothing is pending on the ANC side */
 todo:string;
};

const CHECK:Progress={step:0,tone:"check",label:"ตรวจสอบสถานะเคส",todo:"ดูรายละเอียดเคส"};

/** Fields of a registry row the mapping reads (subset of the /api/p2/cases row). */
export type RegistryFacts={labSteps?:number|null;state:string;analysis_started:boolean;round_number:number;received_at:string|null;consent_decision?:string|null;identityVerified:boolean;released?:boolean;hasResult?:boolean;progress:{missing:string[]}|null};

/** Round states the registry can return; a state outside this list is reported as CHECK by design (test enforces coverage). */
export const KNOWN_ROUND_STATES=["Expected","ReceivedInHIS","ReceivedInNIPT","RedrawRequested","RepeatRequested","PendingCertification","ValidationBlocked","Linked","Completed","CertifiedReleased","RevokedHold"] as const;

const missingTodo=(missing:string[]|undefined)=>missing?.length?`กรอกข้อมูลให้ครบ (ขาด ${missing.length} รายการ)`:"";

export function registryProgress(c:RegistryFacts):Progress{
 if(c.hasResult??c.released)return {step:3,tone:"done",label:"มีผลตรวจแล้ว",todo:""};
 if(c.consent_decision==="Declined")return {step:0,tone:"stop",label:"ผู้ป่วยไม่ยินยอม",reason:"หยุดทุกขั้นตอนตามใบยินยอม",todo:"ดูรายละเอียดเคส"};
 if(c.state==="RevokedHold")return {step:1,tone:"stop",label:"ถอนความยินยอม — พักเคส",todo:"ดูรายละเอียดเคส"};
 if(!c.identityVerified)return {step:0,tone:"check",label:"ตัวตนยังไม่ยืนยัน",todo:"ดูรายละเอียดเคส"};
 if(c.state==="RedrawRequested")return {step:1,tone:"warn",label:"ต้องเจาะเลือดใหม่",reason:"ตัวอย่างเดิมตรวจไม่ได้",todo:"นัดคุณแม่มาเจาะเลือดใหม่"};
 if(c.state==="Expected"){
  if(c.round_number>=2)return {step:0,tone:"waiting",label:"รอห้อง Lab รับตัวอย่าง",todo:`เก็บตัวอย่างใหม่ ครั้งที่ ${c.round_number}`};
  return {step:0,tone:"waiting",label:"รอห้อง Lab รับตัวอย่าง",todo:missingTodo(c.progress?.missing)||"ส่งหลอดเลือดไปห้อง Lab"};
 }
 const testing=c.analysis_started||["RepeatRequested","PendingCertification","ValidationBlocked","Linked","Completed","CertifiedReleased"].includes(c.state);
 if(testing)return {step:2,tone:"testing",label:"กำลังตรวจวิเคราะห์",todo:missingTodo(c.progress?.missing),labSteps:c.labSteps??null};
 if((c.state==="ReceivedInHIS"||c.state==="ReceivedInNIPT")&&c.received_at)return {step:1,tone:"received",label:"ห้อง Lab รับตัวอย่างแล้ว",todo:missingTodo(c.progress?.missing)};
 return CHECK;
}

/** Overview queue item (packages/anc/model.ts stages + flags). The 7 stages stay intact; this only names them for nurses. */
export const STAGE_STEP:Record<Stage,Pick<Progress,"step"|"tone"|"label">>={
 documents:{step:0,tone:"waiting",label:"รอเอกสารให้ครบ"},
 expected:{step:0,tone:"waiting",label:"รอห้อง Lab รับตัวอย่าง"},
 received:{step:1,tone:"received",label:"ห้อง Lab รับตัวอย่างแล้ว"},
 analysis:{step:2,tone:"testing",label:"กำลังตรวจวิเคราะห์"},
 review:{step:2,tone:"testing",label:"กำลังตรวจวิเคราะห์"},
 released:{step:3,tone:"done",label:"มีผลตรวจแล้ว"},
 followup:{step:1,tone:"warn",label:"ต้องเจาะเลือดใหม่"},
 exception:{step:0,tone:"check",label:"ตรวจสอบสถานะเคส"},
};
/** Flags that are the nurse's work, in priority order. Lab-only flags (repeat, validation_blocked) are not ANC to-dos. */
const FLAG_TODO:[string,string][]=[["consent_revoked","ดูรายละเอียดเคส"],["identity_issue","ตรวจสอบข้อมูลตัวตน"],["hold","ติดต่อห้อง Lab"],["redraw","นัดคุณแม่มาเจาะเลือดใหม่"],["documents","กรอกเอกสารให้ครบ"],["missing_s1","ดูรายละเอียดเคส"],["conflicting_release","ดูรายละเอียดเคส"],["unmapped_state","ดูรายละเอียดเคส"]];

export function queueProgress(c:Pick<QueueItem,"stage"|"flags"|"hasResult"|"roundState"|"labSteps">&{hold?:boolean}):Progress{
 const base=STAGE_STEP[c.stage]??CHECK;
 if(c.roundState==="RevokedHold"||c.flags.includes("consent_revoked"))return {step:base.step,tone:"stop",label:"ถอนความยินยอม — พักเคส",todo:"ดูรายละเอียดเคส"};
 if(c.flags.includes("hold"))return {step:base.step,tone:"stop",label:"พักการตรวจไว้ก่อน",reason:"ห้อง Lab ขอข้อมูลเพิ่ม",todo:"ติดต่อห้อง Lab"};
 const todo=c.stage==="released"?"":FLAG_TODO.find(([f])=>(c.flags as string[]).includes(f))?.[1]??(c.stage==="exception"?"ดูรายละเอียดเคส":c.stage==="expected"?"ส่งหลอดเลือดไปห้อง Lab":"");
 return {...base,reason:c.stage==="followup"?"ตัวอย่างเดิมตรวจไม่ได้":undefined,todo,...(base.tone==="testing"?{labSteps:c.labSteps??null}:{})};
}

/** The three visible steps and which of them is done / current / stopped. */
export const STEPS=["รับตัวอย่าง","ตรวจวิเคราะห์","มีผลตรวจ"] as const;
export function stepStates(p:Progress):("done"|"now"|"stop"|"")[]{
 return STEPS.map((_,i)=>{
  if(p.tone==="warn"||p.tone==="stop")return i<p.step?"done":i===p.step?"stop":"";
  if(p.step===3)return "done";
  if(p.step===2&&i===1)return "now";   // step 2 = the analysis step itself is in progress
  if(i<p.step)return "done";
  return "";
 });
}
