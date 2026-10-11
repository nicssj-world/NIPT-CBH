export type Origin = "ANC" | "LAB_DIRECT" | "HISTORICAL";
export type RoundState = "Expected" | "ReceivedInHIS" | "ReceivedInNIPT" | "RedrawRequested" | "Completed" | "Cancelled";
export interface Round { id: string; number: number; state: RoundState; analysisStarted: boolean; releasedCurrentReport: boolean; }
export interface Attempt { roundId: string; placementFinalized: boolean; activeSlot: boolean; }
export interface Repeat { roundId: string; state: "RepeatRequested" | "RepeatPendingBatch" | "RepeatInProgress" | "Completed" | "Cancelled"; }
export function normalizeLn(input: string): string { const value = input.trim(); if (!/^[0-9]+$/.test(value)) throw new Error("LN ต้องเป็นตัวเลขและคงเลขศูนย์นำหน้า"); return value; }
export function deriveStatus(rounds: readonly Round[], attempts: readonly Attempt[] = [], repeats: readonly Repeat[] = [], currentRoundId?: string) {
 const round = currentRoundId ? rounds.find(r=>r.id===currentRoundId && r.state!=="Cancelled") : [...rounds].filter(r => r.state !== "Cancelled").sort((a,b) => b.number-a.number)[0];
 if (!round) return { status: "รอสิ่งส่งตรวจ", roundId: null, repeating: false };
 const started = round.analysisStarted || attempts.some(a => a.roundId === round.id && (a.placementFinalized || a.activeSlot));
 const status = round.releasedCurrentReport ? "รายงานผล" : started ? "เริ่มตรวจวิเคราะห์" : ["ReceivedInHIS","ReceivedInNIPT","Completed","RedrawRequested"].includes(round.state) ? "รับสิ่งส่งตรวจ" : "รอสิ่งส่งตรวจ";
 return {status, roundId: round.id, repeating: started && repeats.some(r => r.roundId === round.id && ["RepeatRequested","RepeatPendingBatch","RepeatInProgress"].includes(r.state))};
}
export type Gate = "CG" | "BG_ASSIGNMENT" | "BG_FINALIZE" | "RG" | "RN";
export interface GateInput { roundId: string; ruleVersion: string; facts: Readonly<Record<string, boolean | null | undefined>>; }
const rules: Record<Gate, readonly string[]> = {
 CG: ["clinicalRulesApproved","complete","noContraindication","datesConsistent","roundAcknowledgements"],
 BG_ASSIGNMENT: ["currentRound","received","requestVerified","consentGranted","clinicalGatePassed","attemptReady","noActiveSlot","repeatPendingIfApplicable"],
 BG_FINALIZE: ["currentRound","received","requestVerified","consentGranted","clinicalGatePassed","exactSheetAssignment","repeatInProgressIfApplicable"],
 RG: ["currentRound","clinicalGatePassed","consentGranted","finalQcAccepted","reportVerified"],
 RN: ["currentRound","reasonApproved","noActiveRelease","authorized"]
};
export function evaluateGate(gate: Gate, input: GateInput) {
 const results = rules[gate].map(code => ({code, passed: input.facts[code] === true, reason: input.facts[code] === true ? "ผ่าน" : `ยังไม่ผ่านหรือไม่ทราบข้อมูล: ${code}`}));
 if (!input.ruleVersion || !input.roundId) results.push({code:"SNAPSHOT_REQUIRED",passed:false,reason:"ต้องระบุรอบและรุ่นกฎ"});
 if (gate === "RG" || gate === "RN") results.push({code:"P1_RELEASE_PROHIBITED",passed:false,reason:"P1 ยังปล่อยผลหรือหนังสือแจ้งไม่ได้ ต้องผ่านการตรวจรับในระยะที่เกี่ยวข้องก่อน"});
 return {gate,roundId:input.roundId,ruleVersion:input.ruleVersion,inputSnapshot:structuredClone(input.facts),passed:results.every(r=>r.passed),results};
}
export function assertReceipt(roundNumber: number, source: string, check?: {identity:boolean;label:boolean}, receiver?:string) {
 if (roundNumber === 1 && source === "HIS_PET_RECEIPT") return;
 if (roundNumber >= 2 && source === "NIPT_LOCAL_RECEIPT" && check?.identity === true && check.label === true && receiver) return;
 throw new Error("ช่องทางรับหรือรายการตรวจรับของรอบไม่ครบ");
}
export function assertRepeatLineage(sourceRoundId:string,targetRoundId:string) { if(sourceRoundId!==targetRoundId) throw new Error("Repeat ต้องใช้สิ่งส่งตรวจรอบเดิม"); }
export function redrawLineage(previous:{caseId:string;caseLnId:string;number:number},request:{id:string;caseId:string;state:string}) {
 if(request.caseId!==previous.caseId || request.state!=="Requested" || !request.id || !Number.isSafeInteger(previous.number) || previous.number<1) throw new Error("Redraw ต้องมีคำสั่งของเคสเดิมและใช้ LN เดิม");
 return {caseId:previous.caseId,caseLnId:previous.caseLnId,number:previous.number+1,redrawRequestId:request.id,state:"Expected" as const};
}
export function assertEpoch(expected:number,actual:number) { if(!Number.isSafeInteger(expected)||expected<0||expected!==actual) throw new Error("Cancellation epoch ไม่ตรง"); }
export function idempotencyKey(value:string) { if(!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error("Idempotency key ไม่ถูกต้อง"); return value; }
