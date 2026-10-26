import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {simpleXlsx} from '../workbook/simple-xlsx';
import {assertSession,need,audit,attemptFacts,caseVisible,type Staff} from './core';
import {specimenDisplayCode} from './rules';

const STATE:Record<string,string>={Ready:'พร้อม',Assigned:'จัดเข้า Batch',InProgress:'กำลังปฏิบัติ',QcFailed:'QC ไม่ผ่าน',Stopped:'หยุด',BatchCancelled:'Batch ถูกยกเลิก',Superseded:'ถูกแทนที่'};
const formatLn=(v:string)=>/^\d{10}$/.test(v)?`${v.slice(0,2)}-${v.slice(2,5)}-${v.slice(5,6)}-${v.slice(6)}`:v;

/** OWNER-LAB-011: current LAB attempts with HIS LN, HN, LN Halos and the full printed Sample ID (suffix included), one row
 *  per attempt in receipt order. Only cases the user may see are exported; the export is recorded as a PHI access. */
export async function exportWorklistXlsx(db:Queryable,user:Staff){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const rows=(await attemptFacts(db,"c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL' AND a.state<>'Superseded'",[])).filter(r=>caseVisible(user,r))
  .sort((x,y)=>(x.received_at?.getTime()??Infinity)-(y.received_at?.getTime()??Infinity)||x.ln.localeCompare(y.ln));
 for(let i=0;i<rows.length;i+=200)await recordPhiAccess(db,user.id,rows.slice(i,i+200).map(r=>r.case_id),'REGISTRY_VIEW');
 const at=(d:Date|null)=>d?new Intl.DateTimeFormat('th-TH-u-ca-buddhist',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(d):'';
 const table=[['ลำดับ','LN (HIS)','HN','LN Halos','Sample ID (พร้อม suffix)','รอบที่','ครั้งที่ตรวจ','สถานะ','Run / ตำแหน่ง','วันที่/เวลารับ'],
  ...rows.map((r,i)=>[String(i+1),formatLn(r.ln),r.hn??'',r.ln_halos?specimenDisplayCode(r.ln_halos,r.pregnancy,r.ln_halos_resampling):'',r.printed_sample_id??'',String(r.round_number),String(r.overall_ordinal),STATE[r.attempt_state]??r.attempt_state,r.run_label?`${r.run_label} · ${r.slot_number??''}`:'',at(r.received_at)])];
 await audit(db,user,'LAB_WORKLIST_EXPORTED','analytical_attempt',undefined,{count:rows.length,outcome:'XLSX'});
 return {bytes:simpleXlsx('LN และ LN Halos',table),count:rows.length};
}
