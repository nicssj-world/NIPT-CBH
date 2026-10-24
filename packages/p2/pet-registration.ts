import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {appendAudit} from '../db/audit';
import {authorize,requirePermission} from '../security/policy';
import {lnHnKey} from '../inbound/identity';
import {readPet,processInboundFile,type InboundDeps} from '../inbound/process';
import {assertStaff,contentHash,P2Error,registerP2,type Staff} from './service';

const identifiers={ln:z.string().trim().regex(/^[0-9-]{6,24}$/).optional(),hn:z.string().trim().min(1).max(32).optional()};
const lookupSchema=z.strictObject(identifiers).refine(v=>!!v.ln||!!v.hn,'LN_OR_HN_REQUIRED');
type File={id:string;ln:string;sha256:string;filename:string;state:string;source_verified:boolean};
export type RegistrationPet={fileId:string;ln:string;hn:string;name:string;dob:string;sex:string;specimenAt:string;receivedAt:string;orderAt:string;ward:string;roundNumber:number};

/** Only authenticated LAB registrants may inspect stored, OK-discovered NIPT evidence. No citizen identity is returned. */
export async function lookupRegistrationPet(db:Queryable,user:Staff,input:unknown,deps:InboundDeps):Promise<{candidates:RegistrationPet[]}>{
 await assertStaff(db,user);requirePermission(user,'case.register.lab',{origin:'LAB_DIRECT'});
 if(deps.lookupKey.length!==32)throw new P2Error('IDENTITY_LOOKUP_KEY_INVALID',500);
 const d=lookupSchema.parse(input),ln=d.ln?.replaceAll('-','');
 const files=(await db.query<File>(`SELECT f.id,f.ln,f.sha256,f.filename,f.state,
  EXISTS(SELECT 1 FROM his_inbound_source s WHERE s.inbound_file_id=f.id AND s.sha256=f.sha256 AND s.byte_size=f.byte_size) source_verified
  FROM his_inbound_file f WHERE ($1::text IS NULL OR f.ln=$1) AND ($2::text IS NULL OR f.parsed->>'hn'=$2)
  AND f.state IN ('Ready','Unlinked','Applied(S1)','Applied(Redraw)') ORDER BY f.ln,f.id LIMIT 101`,[ln??null,d.hn??null])).rows;
 if(files.length>100)throw new P2Error('PET_SELECTION_TOO_BROAD',422);
 const candidates:RegistrationPet[]=[];
 for(const file of files){
  if(!file.source_verified)throw new P2Error('PET_PROVENANCE_INVALID',409);
  const existing=(await db.query<{id:string;hn:string|null;identity_key:string;registration_origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';round_number:number;unit_id:string;file_id:string|null}>(`SELECT c.id,i.hn,c.identity_key,c.registration_origin,r.round_number,s.unit_id,o.inbound_file_id file_id
   FROM case_ln l JOIN nipt_case c ON c.id=l.case_id LEFT JOIN p2_case_identity i ON i.case_id=c.id
   JOIN specimen_round_current r ON r.id=c.current_round_id LEFT JOIN case_unit_scope s ON s.case_id=c.id
   LEFT JOIN his_order_current o ON o.round_id=r.id WHERE l.ln=$1 AND l.verification<>'RETIRED'
   AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)`,[file.ln])).rows;
  if(existing.length&&!existing.some(c=>c.registration_origin!=='HISTORICAL'&&authorize(user,'case.read',{unitId:c.unit_id,origin:c.registration_origin},'read')))throw new P2Error('PET_NOT_ELIGIBLE',409);
  const blocked=(await db.query(`SELECT 1 FROM his_inbound_file f WHERE f.ln=$1 AND f.state IN ('ParseError','Conflict','IntegrityEvent','HistoricalIntake')
   UNION ALL SELECT 1 FROM his_intake_issue i WHERE i.ln=$1 AND i.kind<>'UNLINKED' AND i.state IN ('Open','Proposed') LIMIT 1`,[file.ln])).rows.length>0;
  if(blocked)throw new P2Error('PET_IDENTITY_CONFLICT',409);
  const round=existing[0];
  if(round?.round_number>1){
   if(round.file_id&&round.file_id!==file.id)continue;
   if(!round.file_id&&file.state.startsWith('Applied('))continue;
  }
  let pet;try{pet=await readPet(deps.store,file);}catch{throw new P2Error('PET_PROVENANCE_INVALID',409);}
  if((ln&&pet.ln!==ln)||(d.hn&&pet.hn!==d.hn))throw new P2Error('PET_IDENTITY_CONFLICT',409);
  if(existing.some(c=>c.hn!==pet.hn||c.identity_key!==lnHnKey(pet.ln,pet.hn,deps.lookupKey)))throw new P2Error('PET_IDENTITY_CONFLICT',409);
  if(candidates.some(p=>p.ln===pet.ln&&p.fileId!==file.id))throw new P2Error('PET_AMBIGUOUS',409);
  const {name,dob,sex,specimenAt,receivedAt,orderAt,ward}=pet;
  candidates.push({fileId:file.id,ln:pet.ln,hn:pet.hn,name,dob:dob.slice(0,10),sex,specimenAt,receivedAt,orderAt,ward,roundNumber:round?.round_number??1});
 }
 await appendAudit(db,{actorId:user.id,action:'PET_REGISTRATION_LOOKUP',resourceType:'his_inbound_file',details:{count:candidates.length,reasonCode:ln?'LN':'HN'}});
 return {candidates};
}

/** Registration and the existing receipt hook share the existing LN lock and number trigger. */
export async function registerFromPet(db:Queryable,user:Staff,input:unknown,deps:InboundDeps){
 const d=z.strictObject({...identifiers,fileId:z.uuid().optional(),unitId:z.uuid().optional(),consentMode:z.enum(['Paper','Electronic']),idempotencyKey:z.string().min(1).max(200)}).refine(v=>!!v.ln||!!v.hn,'LN_OR_HN_REQUIRED').parse(input);
 const query={...(d.ln?{ln:d.ln}:{}),...(d.hn?{hn:d.hn}:{})};
 const found=await lookupRegistrationPet(db,user,query,deps);
 if(!found.candidates.length)throw new P2Error('PET_NOT_READY',409);
 if(found.candidates.length>1&&!d.fileId)throw new P2Error('PET_SELECTION_REQUIRED',409);
 const selected=d.fileId?found.candidates.find(p=>p.fileId===d.fileId):found.candidates[0];if(!selected)throw new P2Error('PET_SELECTION_STALE',409);
 await lockLn(db,selected.ln);
 const fresh=await lookupRegistrationPet(db,user,{ln:selected.ln,hn:selected.hn},deps);
 if(!fresh.candidates.some(p=>p.fileId===selected.fileId))throw new P2Error('PET_SELECTION_STALE',409);
 const hash=contentHash({...d,fileId:selected.fileId});
 const prior=(await db.query<{case_id:string;hash:string}>(`SELECT case_id,details->>'inputHash' hash FROM case_event WHERE event_type='TASK15_PET_REGISTERED' AND details->>'idempotencyKey'=$1 ORDER BY created_at LIMIT 1`,[d.idempotencyKey])).rows[0];
 if(prior){if(prior.hash!==hash)throw new P2Error('IDEMPOTENCY_CONFLICT',409);return {caseId:prior.case_id,outcome:'OPENED',intake:{outcome:'DUPLICATE',fields:[]}};}
 const units=(await db.query<{id:string}>('SELECT id FROM unit ORDER BY code,id')).rows;
 const unit=d.unitId??units.find(u=>authorize(user,'case.register.lab',{unitId:u.id,origin:'LAB_DIRECT'}))?.id;if(!unit)throw new P2Error('UNIT_REQUIRED',422);
 const result=await registerP2(db,user,{ln:selected.ln,hn:selected.hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:d.idempotencyKey,labOperational:{paperRequest:true,paperConsent:d.consentMode==='Paper'}},deps.lookupKey,{store:deps.store});
 if(!result.caseId)throw new P2Error('PET_IDENTITY_CONFLICT',409);
 if(result.intake?.outcome==='NO_INTAKE'){
  const outcome=await processInboundFile(db,selected.fileId,deps,{via:'REGISTRATION',actorId:user.id});
  result.intake={outcome,fields:[]};
 }
 const received=(await db.query('SELECT 1 FROM nipt_case c JOIN specimen_round_current r ON r.id=c.current_round_id JOIN specimen_lab_number n ON n.round_id=r.id JOIN his_order_current o ON o.round_id=r.id WHERE c.id=$1 AND o.inbound_file_id=$2 AND r.received_source=\'HIS_PET_RECEIPT\' AND r.received_at IS NOT NULL',[result.caseId,selected.fileId])).rows.length>0;
 if(!received)throw new P2Error('PET_NOT_READY',409);
 await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'TASK15_PET_REGISTERED',$2)",[result.caseId,{idempotencyKey:d.idempotencyKey,inputHash:hash,inboundFileId:selected.fileId,actorId:user.id,consentMode:d.consentMode}]);
 return result;
}
