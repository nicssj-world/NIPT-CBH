import type {RequestDraft} from "../../../packages/p2/schema";
import {DCC_REQUEST_CONTRACT} from "../../../packages/forms/request-contract";
export const historyAnswers=[["cancerTreatment","4. เป็นมะเร็งหรือกำลังอยู่ในช่วงการรักษา"],["gaUnder8","5. อายุครรภ์น้อยกว่า 8 สัปดาห์ตามข้อมูลต้นทาง"],["tumor","6. มีประวัติเนื้องอก"],["priorChromosomeTest","7. เคยตรวจคัดกรองด้วยวิธีอื่นมาก่อน"],["otherHistory","8. ครอบครัวมีประวัติโรคทางพันธุกรรมชนิดโครโมโซมผิดปกติ"]];
const keys=["cancerTreatment","priorChromosomeTest","otherHistory"] as const;
export const requiresHistoryReanswer=(draft:RequestDraft,operational:boolean)=>operational&&draft.documentContractVersion!==DCC_REQUEST_CONTRACT;
/** Editable copy only. Old revisions and the original stored payload remain untouched. */
export function prepareRequestEdit(draft:RequestDraft,operational:boolean):RequestDraft{
 const copy=structuredClone(draft);if(!requiresHistoryReanswer(draft,operational))return copy;
 for(const key of keys)copy.history[key]=null;
 copy.history.priorTestMethod=null;copy.history.priorTestResult=null;copy.history.otherDetails=null;
 return copy;
}
export function answerCurrentHistory(draft:RequestDraft,path:string,operational:boolean):RequestDraft{
 if(requiresHistoryReanswer(draft,operational)&&keys.some(k=>path===`history.${k}`)&&keys.every(k=>draft.history[k]!==null))return {...draft,documentContractVersion:DCC_REQUEST_CONTRACT};
 return draft;
}

/** Request amendments apply only to the active specimen round. Earlier immutable requests do not lock a new redraw draft. */
export function currentRequestLocked(revisions:readonly {kind:string;payload:unknown}[],roundId:string){return revisions.some(r=>r.kind==='REQUEST'&&(r.payload as {identity?:{roundId?:string}}|null)?.identity?.roundId===roundId);}

/** Workspace versions restart for every specimen round. Never guess a document from its version alone. */
export function requestAuditRevisionId(details:{revisionId?:string;workspaceVersion?:number;roundId?:string}|undefined,revisions:readonly {id:string;kind:string;payload:unknown}[]){
 if(details?.revisionId)return details.revisionId;
 if(!details?.roundId||details.workspaceVersion===undefined)return undefined;
 const matches=revisions.filter(r=>{const payload=r.payload as {workspaceVersion?:number;identity?:{roundId?:string}}|null;return r.kind==='REQUEST'&&payload?.identity?.roundId===details.roundId&&payload?.workspaceVersion===details.workspaceVersion;});
 return matches.length===1?matches[0].id:undefined;
}
