import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';
import {operationalDataEnabled} from '../security/runtime';

/** EQA is an immutable organizer-backed classification, never a fake HIS PET. */
export async function receiveEqaSpecimen(db:Queryable,user:Principal,caseId:string,collectionDate:string){
 z.uuid().parse(caseId);z.iso.date().parse(collectionDate);
 requirePermission(user,'round.receive',{},'write');
 const r=(await db.query<{round_id:string;case_id:string;unit_id:string|null;state:string;received_at:Date|null;round_number:number;registration_origin:string}>(`SELECT c.current_round_id round_id,c.id case_id,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id,r.state,r.received_at,r.round_number,c.registration_origin
 FROM nipt_case c JOIN specimen_round r ON r.id=c.current_round_id JOIN eqa_case e ON e.case_id=c.id
 WHERE c.id=$1 FOR UPDATE OF c,r`,[caseId])).rows[0];
 if(!r)throw Error('EQA_REGISTRATION_REQUIRED');
 requirePermission(user,'round.receive',{unitId:r.unit_id??undefined,origin:'LAB_DIRECT'},'write');
 if(r.round_number!==1||r.state!=='Expected'||r.received_at!==null||r.registration_origin!=='LAB_DIRECT')throw Error('EQA_RECEIPT_STATE_INVALID');
 const his=(await db.query<{n:number}>(`SELECT count(*)::int n FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=$1`,[caseId])).rows[0].n;
 if(his>0)throw Error('EQA_MUST_NOT_HAVE_PET');
 const check={identity:true,label:true,organizerEvidence:true,source:'EQA_ORGANIZER',verifiedBy:user.id};
 // The normal P4 receipt trigger allocates the genuine LN Halos and first analytical attempt.
 await db.query(`UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=clock_timestamp(),received_by=$2,receipt_check=$3,collection_date=$4 WHERE id=$1`,[r.round_id,user.id,JSON.stringify(check),collectionDate]);
 const n=(await db.query<{ln_halos:string}>(`SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1`,[r.round_id])).rows[0];
 if(!n)throw Error('EQA_LN_HALOS_NOT_ISSUED');
 await appendAudit(db,{actorId:user.id,action:'EQA_SPECIMEN_RECEIVED',resourceType:'specimen_round',resourceId:r.round_id,details:{origin:'EQA',synthetic:!operationalDataEnabled()}});
 return {caseId,roundId:r.round_id,lnHalos:n.ln_halos,state:'ReceivedInNIPT',hisOutboundAllowed:false};
}
export async function listAnnualEqa(db:Queryable,user:Principal,year:number){
 z.number().int().min(2000).max(2200).parse(year);
 requirePermission(user,'case.read',{},'read');
 return (await db.query<{case_id:string;organizer:string;organizer_sample_id:string;patient_name:string;program_year:number;verified_at:Date;ln:string;ln_halos:string|null;run_label:string|null;report_id:string|null}>(`SELECT e.case_id,e.organizer,e.organizer_sample_id,e.patient_name,e.program_year,e.verified_at,l.ln,
   (SELECT n.ln_halos FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id WHERE r.case_id=e.case_id ORDER BY r.round_number DESC LIMIT 1) ln_halos,
   (SELECT b.run_label FROM lab_slot_assignment sa JOIN lab_batch b ON b.id=sa.batch_id JOIN analytical_attempt a ON a.id=sa.attempt_id WHERE a.case_id=e.case_id ORDER BY sa.assigned_at DESC LIMIT 1) run_label,
   (SELECT rr.id FROM result_release rr WHERE rr.case_id=e.case_id ORDER BY rr.certified_at DESC LIMIT 1) report_id
 FROM eqa_case e JOIN case_ln l ON l.case_id=e.case_id
 WHERE e.program_year=$1 ORDER BY e.verified_at DESC,e.case_id DESC LIMIT 200`,[year])).rows;
}

export async function listActualIqc(db:Queryable,user:Principal,year:number){
 z.number().int().min(2000).max(2200).parse(year);
 requirePermission(user,'batch.finalize',{},'read');
 return (await db.query<{batch_id:string;run_label:string;run_year:number;slot_number:number;control_type:'positive'|'negative';workbook_revision_id:string|null;revision:number|null;measurement:string|null}>(`SELECT b.id batch_id,b.run_label,b.run_year,s.slot_number,s.control_type,
    w.id workbook_revision_id,w.revision,
    (w.values->>concat('slot.',s.slot_number,'.libraryQc')) measurement
    FROM lab_batch b JOIN lab_batch_slot s ON s.batch_id=b.id
    LEFT JOIN LATERAL (
      SELECT id,revision,values FROM task_workbook_revision
      WHERE batch_id=b.id ORDER BY revision DESC LIMIT 1
    ) w ON true
    WHERE b.run_year=$1 AND s.control_type IN ('positive','negative')
    ORDER BY b.run_number DESC,s.slot_number
    LIMIT 400`,[year])).rows;
}
