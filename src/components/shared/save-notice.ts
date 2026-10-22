"use client";

export const SAVE_NOTICE_EVENT="nipt:save-success";
/** Call only after a persisted save is acknowledged. Autosave has its own inline status. */
export function notifySaved(){if(typeof window!=="undefined")window.dispatchEvent(new Event(SAVE_NOTICE_EVENT));}

// Explicit write commands only: POST is also used for queries, previews, tests and exports.
const writes=new Set([
 "save","saveDraft","updatePlan","record","review","verify","decideQc","recordActualPooling",
 "amend","planCheck","finalize","move","remove","urgent40","start","end","confirmDisposition","proposeDisposition",
 "create","accept","crosscheck","decideQc2","transition","createDnb","createHandoff","createSequencing",
 "decideQc3","recordObservation","recordQc4","reviewObservation","reviewQc4","transferHandoff","transitionSequencing","verifyHandoff",
 "setHold","setUrgent","acceptSpecimen","receiveRedraw","orderRedraw","cancelRedraw","orderRepeat","recoverLnHalos","assign",
 "lockRequest","paperReview","preparePaper","prepareConsent","setModes","approveClinical","refusePaperConsent","withdraw",
 "qc5","certify","propose","proposeAuto","decide","acceptRelease","unlink","void",
 "fix","confirm","edit","saveUnit","saveUser","updateUser",
]);
export function notifySavedCommand(path:string,body:unknown){
 if(!body||typeof body!=="object")return;
 const command=body as {action?:unknown;operation?:unknown};
 const name=command.action??command.operation;
 const manual=/^\/api\/p5h\/manual-(?:stages|review)\/[^/]+$/.test(path);
 const storage=path==="/api/settings/run-photo-storage"&&name==="activate";
 const form=path==="/api/p2/register"||path==="/api/auth/password"||(path==="/api/p4/batches"&&name===undefined);
 if(manual||storage||form||(typeof name==="string"&&writes.has(name)))notifySaved();
}
