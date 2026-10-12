import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {normalizeLn} from '../domain';
import {processInboundFile,type InboundDeps,type ProcessOutcome} from './process';

/**
 * Blind entry, step L2 (Plan §4.7, D-40): tells the registrant only whether an unlinked intake exists.
 * Never returns name, HN, DOB or any other value read from HIS.
 */
export async function intakePresence(db:Queryable,ln:string){
 const r=await db.query("SELECT 1 FROM his_inbound_file f JOIN his_intake_issue i ON i.inbound_file_id=f.id WHERE f.ln=$1 AND f.state='Unlinked' AND i.kind='UNLINKED' AND i.state='Open' LIMIT 1",[normalizeLn(ln)]);
 return {unlinkedIntake:r.rows.length>0};
}

export const IDENTIFIER_SOURCES=['TUBE_LABEL','REQUEST_FORM','PATIENT_DOCUMENT'] as const;
export const registrationLinkInput=z.strictObject({
 caseId:z.uuid(),ln:z.string().trim().regex(/^[0-9]+$/),
 hn:z.string().trim().min(1).max(32),dob:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
 identifierSource:z.enum(IDENTIFIER_SOURCES),actorId:z.uuid().optional()
});
export type RegistrationLinkInput=z.infer<typeof registrationLinkInput>;

/**
 * D-49 registration hook, step L3: call inside the registration transaction right after the case is created or
 * opened. Holds the same LN lock as the worker, so the final state is identical whichever happens first (AT-LDR-08).
 * Compares the registrant's blind-entered identifiers with the stored intake; on mismatch the case keeps S1 Expected
 * and the intake stays Unlinked with IDENTITY_MISMATCH for two-person review. The identifier source is recorded.
 */
export async function linkIntakeAtRegistration(db:Queryable,input:unknown,deps:InboundDeps):Promise<{outcome:ProcessOutcome|'NO_INTAKE'}>{
 const d=registrationLinkInput.parse(input);
 await lockLn(db,d.ln);
 const owner=(await db.query<{case_id:string}>("SELECT case_id FROM case_ln WHERE ln=$1 AND verification<>'RETIRED' ORDER BY version DESC LIMIT 1",[d.ln])).rows[0];
 if(owner?.case_id!==d.caseId)throw Error('CASE_LN_MISMATCH');
 const files=(await db.query<{id:string}>("SELECT f.id FROM his_inbound_file f JOIN his_intake_issue i ON i.inbound_file_id=f.id WHERE f.ln=$1 AND f.state='Unlinked' AND i.kind='UNLINKED' AND i.state='Open' ORDER BY f.discovered_at,f.source_path,f.id",[d.ln])).rows;
 let first:ProcessOutcome|'NO_INTAKE'='NO_INTAKE';
 for(const f of files){
  const outcome=await processInboundFile(db,f.id,deps,{identity:{scheme:'HN_PLAIN',hn:d.hn,dob:d.dob??null},actorId:d.actorId});
  if(first==='NO_INTAKE')first=outcome;
 }
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[d.caseId,'INTAKE_LINK_AT_REGISTRATION',JSON.stringify({outcome:first,identifierSource:d.identifierSource,blindEntry:true,actorId:d.actorId??null,synthetic:true})]);
 return {outcome:first};
}
