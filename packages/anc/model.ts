export const stages = [
 ['documents','ลงทะเบียน / รอเอกสาร'], ['expected','รอรับตัวอย่าง'], ['received','รับตัวอย่างแล้ว'],
 ['analysis','อยู่ระหว่างตรวจวิเคราะห์'], ['review','รอทบทวน / รับรองผล'], ['released','ผลตรวจพร้อมแล้ว'],
 ['followup','ต้องติดตามเพิ่มเติม'], ['exception','ตรวจสอบข้อมูล'],
] as const;
export type Stage = typeof stages[number][0];
export const flagLabels = {redraw:'เก็บตัวอย่างใหม่',repeat:'ตรวจซ้ำ',hold:'HOLD',urgent:'เร่งด่วน',documents:'เอกสารยังไม่ครบ',missing_s1:'ข้อมูล S1 ไม่ครบ',conflicting_release:'หลักฐานผลตรวจขัดกัน',unmapped_state:'ตรวจสอบสถานะ',validation_blocked:'ผลตรวจติดเงื่อนไข',consent_revoked:'ถอนความยินยอม',identity_issue:'ข้อมูลระบุตัวตนรอตรวจสอบ'} as const;
export type Flag = keyof typeof flagLabels;
export type CaseFacts = {
 id:string; ln:string; hn:string|null; unitIds:string[]; currentRoundId:string|null; roundNumber:number|null; roundState:string|null;
 s1ReceivedAt:string|null; currentReceivedAt:string|null; analysisStarted:boolean; documentsReady:boolean;
 reportState:string|null; activeReleaseCount:number; certifiedReleaseCount:number; redraw:boolean; repeat:boolean; hold:boolean; urgent:boolean; consentRevoked:boolean; identityIssue:boolean;
};
export type QueueItem = CaseFacts & {stage:Stage;stageLabel:string;flags:Flag[];released:boolean;pending:boolean;daysWaiting:number|null};
export type Filters = {fy:number;unitId?:string;kpi?:'sent'|'pending'|'released'|'attention';stage?:Stage;flag?:Flag;tab?:'all'|'pending'|'released'|'attention'|'redraw'|'hold';q?:string;page:number;pageSize:number};
export function fiscalYear(iso:string):number {const d=new Date(new Date(iso).getTime()+7*3600000);return d.getUTCFullYear()+(d.getUTCMonth()>=9?1:0)+543;}
export function project(c:CaseFacts,now:Date):QueueItem {
 const flags:Flag[]=[];
 for(const key of ['redraw','repeat','hold','urgent'] as const)if(c[key])flags.push(key);
 if(c.consentRevoked)flags.push('consent_revoked');if(c.identityIssue)flags.push('identity_issue');
 if(!c.documentsReady)flags.push('documents');
 const missingS1=!!c.currentReceivedAt&&!c.s1ReceivedAt;
 const conflict=c.activeReleaseCount>1||c.activeReleaseCount!==c.certifiedReleaseCount;
 if(missingS1)flags.push('missing_s1');if(conflict)flags.push('conflicting_release');
 if(c.reportState==='ValidationBlocked')flags.push('validation_blocked');
 const released=!missingS1&&!conflict&&c.certifiedReleaseCount===1;
 let stage:Stage='exception';
 if(missingS1||conflict||!c.currentRoundId)stage='exception';
 else if(released)stage='released';
 else if(c.redraw)stage='followup';
 else if(['Linked','ValidationBlocked','PendingCertification'].includes(c.reportState??''))stage='review';
 else if(c.analysisStarted)stage='analysis';
 else if(['ReceivedInHIS','ReceivedInNIPT','Completed'].includes(c.roundState??'')&&c.currentReceivedAt)stage='received';
 else if(c.roundState==='Expected')stage=c.documentsReady?'expected':'documents';
 if(stage==='exception'&&!missingS1&&!conflict)flags.push('unmapped_state');
 return {...c,stage,stageLabel:stages.find(s=>s[0]===stage)![1],flags,released,pending:!!c.s1ReceivedAt&&!released,
 daysWaiting:c.s1ReceivedAt?Math.max(0,Math.floor((now.getTime()-new Date(c.s1ReceivedAt).getTime())/86400000)):null};
}
export function matches(c:QueueItem,f:Partial<Filters>):boolean {
 const metric=(key:string)=>key==='sent'?!!c.s1ReceivedAt&&fiscalYear(c.s1ReceivedAt)===f.fy:key==='pending'?c.pending:key==='released'?c.released:key==='attention'?c.flags.length>0:false;
 return (!f.unitId||c.unitIds.includes(f.unitId))&&(!f.kpi||metric(f.kpi))&&(!f.stage||c.stage===f.stage)&&(!f.flag||c.flags.includes(f.flag))&&
 (!f.tab||f.tab==='all'||(f.tab==='redraw'?c.redraw:f.tab==='hold'?c.hold:metric(f.tab)))&&
 (!f.q||[c.ln,c.hn??'',c.id].some(v=>v.toLowerCase().includes(f.q!.trim().toLowerCase())));
}
export type Dashboard = {fiscalYear:number;generatedAt:string;scope:{unitIds:string[];allUnits:boolean};metrics:Record<'sent'|'pending'|'released'|'attention',number>;stages:{id:Stage;label:string;count:number}[];queue:{items:QueueItem[];total:number;page:number;pageSize:number};units:{id:string;name:string}[];limitations:string[]};
