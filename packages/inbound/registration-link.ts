import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {normalizeLn} from '../domain';
import {authorize,type Principal} from '../security/policy';
import {lnHnKey} from './identity';
import {processInboundFile,type InboundDeps,type ProcessOutcome} from './process';

/**
 * Blind entry, step L2 (Plan §4.7, D-40): tells the registrant only whether an unlinked intake waits for an LN that has
 * no case yet. Never returns name, HN, DOB or any other value read from HIS, and never reveals whether a case exists.
 */
export async function intakePresence(db:Queryable,ln:string){
 const r=await db.query("SELECT 1 FROM his_inbound_file f JOIN his_intake_issue i ON i.inbound_file_id=f.id WHERE f.ln=$1 AND f.state='Unlinked' AND i.kind='UNLINKED' AND i.state='Open' AND NOT EXISTS(SELECT 1 FROM case_ln l WHERE l.ln=f.ln AND l.verification<>'RETIRED') LIMIT 1",[normalizeLn(ln)]);
 return {unlinkedIntake:r.rows.length>0};
}

export const IDENTIFIER_SOURCES=['TUBE_LABEL','REQUEST_FORM','PATIENT_DOCUMENT'] as const;
export type IdentifierSource=typeof IDENTIFIER_SOURCES[number];
export const registrationLinkInput=z.strictObject({
 caseId:z.uuid(),ln:z.string().trim().regex(/^[0-9]+$/),hn:z.string().trim().min(1).max(32),
 identifierSource:z.enum(IDENTIFIER_SOURCES).nullable()
});
export type RegistrationLinkInput=z.infer<typeof registrationLinkInput>;
export type RegistrationLinkResult={outcome:ProcessOutcome|'NO_INTAKE';fields:string[]};

/**
 * D-49 registration hook, step L3: called by registerP2 inside the registration transaction after the case is created or
 * reopened. Holds the same LN lock as the worker, so the final state is identical whichever happens first (AT-LDR-08).
 * The caller's HN is only a cross-check: it must equal the case's immutable P2 identity and digest, and the actor must see
 * the case's unit. Matching itself reads that stored identity, exactly as the worker does. On mismatch the case keeps S1
 * Expected and the intake stays Unlinked with IDENTITY_MISMATCH for two-person review. Field names only are returned.
 */
export async function linkIntakeAtRegistration(db:Queryable,user:Principal,input:unknown,deps:Omit<InboundDeps,'store'>&{store?:InboundDeps['store']}):Promise<RegistrationLinkResult>{
 const d=registrationLinkInput.parse(input);
 await lockLn(db,d.ln);
 const c=(await db.query<{case_id:string;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';identity_key:string;hn:string|null}>("SELECT l.case_id,c.registration_origin AS origin,c.identity_key,i.hn FROM case_ln l JOIN nipt_case c ON c.id=l.case_id LEFT JOIN p2_case_identity i ON i.case_id=c.id WHERE l.ln=$1 AND l.verification<>'RETIRED' ORDER BY l.version DESC LIMIT 1",[d.ln])).rows[0];
 if(c?.case_id!==d.caseId)throw Error('CASE_LN_MISMATCH');
 if(c.hn===null||c.hn!==d.hn||c.identity_key!==lnHnKey(d.ln,d.hn,deps.lookupKey))throw Error('IDENTITY_UNVERIFIED');
 const units=(await db.query<{unit_id:string}>('SELECT unit_id FROM case_unit_scope WHERE case_id=$1',[d.caseId])).rows;
 if(c.origin==='HISTORICAL'||!units.some(u=>authorize(user,'case.read',{unitId:u.unit_id,origin:c.origin},'read')))throw Error('FORBIDDEN');
 const files=(await db.query<{id:string}>("SELECT f.id FROM his_inbound_file f JOIN his_intake_issue i ON i.inbound_file_id=f.id WHERE f.ln=$1 AND f.state='Unlinked' AND i.kind='UNLINKED' AND i.state='Open' ORDER BY f.discovered_at,f.source_path,f.id",[d.ln])).rows;
 if(!files.length)return {outcome:'NO_INTAKE',fields:[]};
 const store=deps.store;if(!store)throw Error('INTAKE_STORE_UNAVAILABLE');
 let first:ProcessOutcome|undefined;
 for(const f of files){
  const outcome=await processInboundFile(db,f.id,{...deps,store},{via:'REGISTRATION',actorId:user.id});
  first??=outcome;
 }
 const fields=first==='IDENTITY_MISMATCH'?(await db.query<{details:{fields?:string[]}}>("SELECT details FROM his_intake_issue WHERE inbound_file_id=$1 AND kind='IDENTITY_MISMATCH'",[files[0].id])).rows[0]?.details.fields??[]:[];
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[d.caseId,'INTAKE_LINK_AT_REGISTRATION',JSON.stringify({outcome:first,intakes:files.length,identifierSource:d.identifierSource,blindEntry:true,actorId:user.id,synthetic:true})]);
 return {outcome:first!,fields};
}
