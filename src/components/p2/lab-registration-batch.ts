import type {RegistrationPet} from '../../../packages/p2/pet-registration';

/** One typed or scanned LN/HN in a Lab registration sitting. Nothing is registered until the whole list is confirmed. */
export type EntryState='matching'|'choose'|'matched'|'failed'|'registering'|'registered';
export type Entry={id:string;ln:string;hn:string;state:EntryState;failedAt?:'match'|'register';reason?:string;pet?:RegistrationPet;candidates?:RegistrationPet[];caseId?:string;key:string};

/** What the person typed (never the matched record), so a failed entry can still be checked against the paper form. */
export const entryLabel=(e:Pick<Entry,'ln'|'hn'>)=>e.ln?e.ln:e.hn?`HN ${e.hn}`:'';

export const CHOOSE_UNRESOLVED='พบหลาย LN แต่ยังไม่ได้เลือกรายการที่ถูกต้อง';
export const NOT_FOUND='ไม่พบ PET ที่พร้อมสำหรับตัวระบุนี้ กรุณาตรวจ LN/HN และสถานะ PET / .ok จาก HIS';
export const DUPLICATE='ซ้ำกับรายการก่อนหน้าในรอบนี้';

/** Result shown after confirming. Entries still waiting for a choice count as not matched; only registered entries count as done. */
export function summarize(items:Entry[]){
 const failed=items.filter(i=>i.state==='failed'||i.state==='choose');
 return {registered:items.filter(i=>i.state==='registered').length,failed:failed.length,failedEntries:failed.map(i=>({label:entryLabel(i),reason:i.state==='choose'?CHOOSE_UNRESOLVED:i.reason??''}))};
}
/** Only matched entries are registered; failed ones never are. The list shows the newest scan first, but registration (and so the LN Halos
 *  numbers issued in order) follows the order of scanning: the first scan is registered first (Owner 2026-11-10). */
export const toRegister=(items:Entry[])=>items.filter(i=>i.state==='matched'&&i.pet).reverse();
/** The same patient (LN) may appear once per sitting. */
export const isDuplicate=(items:Entry[],id:string,pet:RegistrationPet)=>items.some(o=>o.id!==id&&o.state!=='failed'&&o.pet?.ln===pet.ln);
