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
