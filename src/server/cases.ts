import {pool,withTransaction} from "../../packages/db/connection";
import {recordPhiAccess} from "../../packages/db/phi-access";
import {authorize,type Principal} from "../../packages/security/policy";
import {deriveStatus,type Round,type Origin} from "../../packages/domain";
type CaseRow={id:string;ln:string;registration_origin:Origin;current_round_id:string;unit_id:string|null;round_number:number;state:Round["state"];analysis_started:boolean};
export async function visibleCases(user:Principal,logAccess=true){
 const rows=await pool().query<CaseRow>(`SELECT c.id,l.ln,c.registration_origin,c.current_round_id,s.unit_id,r.round_number,r.state,r.analysis_started
  FROM nipt_case c JOIN case_ln l ON l.case_id=c.id LEFT JOIN case_unit_scope s ON s.case_id=c.id
  LEFT JOIN specimen_round r ON r.id=c.current_round_id ORDER BY c.created_at DESC LIMIT 200`);
 const seen=new Set<string>();
 const result=rows.rows.filter(c=>{if(seen.has(c.id)||!authorize(user,"case.read",{unitId:c.unit_id??undefined,origin:c.registration_origin},"read"))return false;seen.add(c.id);return true;}).map(c=>({...c,status:deriveStatus([{id:c.current_round_id,number:c.round_number,state:c.state,analysisStarted:c.analysis_started,releasedCurrentReport:false}],[],[],c.current_round_id).status}));
 if(logAccess&&result.length)await withTransaction(db=>recordPhiAccess(db,user.id,result.map(c=>c.id),'REGISTRY_VIEW'));
 return result;
}
export async function caseTimeline(user:Principal,id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))return null;
 const item=(await visibleCases(user,false)).find(c=>c.id===id);if(!item)return null;
 const [rounds,events]=await Promise.all([pool().query<{id:string;round_number:number;state:string;received_source:string|null}>("SELECT id,round_number,state,received_source FROM specimen_round WHERE case_id=$1 ORDER BY round_number",[id]),pool().query<{event_type:string;created_at:Date}>("SELECT event_type,created_at FROM case_event WHERE case_id=$1 ORDER BY created_at DESC LIMIT 50",[id])]);
 await withTransaction(db=>recordPhiAccess(db,user.id,[id],'CASE_DETAIL_VIEW'));
 return {item,rounds:rounds.rows,events:events.rows};
}
