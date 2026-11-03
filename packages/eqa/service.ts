import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission} from '../security/policy';
import {registerP2,P2Error} from '../p2/service';
import type {Staff} from '../lab/core';
import {appendAudit} from '../db/audit';
import {isoDate} from '../domain/thai-date';

const text=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u001f\u007f]/.test(s),'CONTROL_CHARACTER');
/** Fields copied from the organizer's referral card. Nothing is inferred: EDD is not on the card, so it is not stored. */
export const eqaRegistrationSchema=z.strictObject({
 ln:z.string().trim().regex(/^[0-9-]{1,32}$/),
 unitId:z.uuid(),
 idempotencyKey:z.string().min(8).max(100),
 organizer:text(120),
 programYear:z.number().int().min(2020).max(2100),
 sampleRef:text(80),               // "Hospital No" on the referral card, e.g. 03NIPT26; also the registered HN
 surname:text(120),firstName:text(120),
 dob:isoDate,
 gaWeeks:z.number().int().min(0).max(45),gaDays:z.number().int().min(0).max(6),
 collectionDate:isoDate,
 pregnancy:z.enum(['Singleton','Twins']),
 note:text(200).optional()          // reference to the referral card / scheme document; not a clinical statement
});
export type EqaRegistration=z.infer<typeof eqaRegistrationSchema>;

/**
 * Registers an organizer-supplied EQA specimen and records its receipt in one transaction. It is an ordinary LAB_DIRECT
 * case (same Task List, QC, HALOS, ReadyGen, report and certification as a patient) with two differences enforced in the
 * database: it has no HIS PET, and it can never produce a HIS outbound result.
 */
export async function registerEqaCase(db:Queryable,user:Staff,raw:unknown,key:Buffer,intake:Parameters<typeof registerP2>[4]={}){
 const d=eqaRegistrationSchema.parse(raw);
 requirePermission(user,'case.register.lab',{unitId:d.unitId,origin:'LAB_DIRECT'});
 if(d.collectionDate>new Date().toISOString().slice(0,10))throw new P2Error('COLLECTION_DATE_FUTURE',422);
 const reg=await registerP2(db,user,{ln:d.ln,hn:d.sampleRef,unitId:d.unitId,origin:'LAB_DIRECT',idempotencyKey:d.idempotencyKey,identifierSource:'REQUEST_FORM'},key,intake) as {outcome:string;caseId:string|null};
 if(reg.outcome!=='CREATED'||!reg.caseId)throw new P2Error('EQA_REQUIRES_NEW_LAB_DIRECT_CASE',409);
 const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[reg.caseId])).rows[0].id;
 await db.query(`INSERT INTO eqa_case(case_id,round_id,organizer,program_year,sample_ref,surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,note,registered_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [reg.caseId,round,d.organizer,d.programYear,d.sampleRef,d.surname,d.firstName,d.dob,d.gaWeeks,d.gaDays,d.collectionDate,d.pregnancy,d.note??null,user.id]);
 // The organizer's specimen is physically in the laboratory: record the receipt through the existing local-receipt channel.
 await db.query(`UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,
  receipt_check=$3,collection_date=$4 WHERE id=$1 AND state='Expected' AND received_at IS NULL`,
  [round,user.id,JSON.stringify({identity:true,label:true,condition:'ACCEPTABLE',source:'EQA_REFERRAL_CARD'}),d.collectionDate]);
 const lnHalos=(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[round])).rows[0]?.ln_halos??null;
 if(!lnHalos)throw new P2Error('LN_HALOS_NOT_ISSUED',500);
 await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'EQA_REGISTERED',$2)",[reg.caseId,JSON.stringify({actorId:user.id,programYear:d.programYear})]);
 await appendAudit(db,{actorId:user.id,action:'EQA_REGISTERED',resourceType:'nipt_case',resourceId:reg.caseId,details:{outcome:'RECEIVED_WITHOUT_PET',count:d.programYear}});
 return {caseId:reg.caseId,roundId:round,lnHalos};
}
