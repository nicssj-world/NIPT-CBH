import type {Queryable} from '../db/connection';
import type {Pet} from '../integrations/pet';
import {identityLookup} from '../security/envelope';

/**
 * Independent identifiers recorded by the registrant (ANC/Lab), never values copied from HIS.
 * OD-15 synthetic boundary (AL-2): LN + HN. LN alone is never identity evidence.
 */
export type RegistrantIdentity=
 |{scheme:'HN_PLAIN';hn:string;dob?:string|null}
 |{scheme:'LN_HN_HMAC';key:string}
 |{scheme:'NONE'};
export type IdentityComparison={outcome:'MATCH'}|{outcome:'MISMATCH';fields:string[]}|{outcome:'UNVERIFIED'};

export interface RegistrantIdentitySource{forCase(db:Queryable,caseId:string):Promise<RegistrantIdentity>;}

/** Same derivation as the P2 registration service: HMAC over [LN, HN] with the identity lookup key. */
export const lnHnKey=(ln:string,hn:string,lookupKey:Buffer)=>identityLookup(JSON.stringify([ln,hn.trim()]),lookupKey);

export function compareRegistrant(registrant:RegistrantIdentity,pet:Pet,lookupKey:Buffer):IdentityComparison{
 if(registrant.scheme==='NONE')return {outcome:'UNVERIFIED'};
 if(registrant.scheme==='LN_HN_HMAC'){if(!/^[a-f0-9]{64}$/.test(registrant.key))return {outcome:'UNVERIFIED'};return lnHnKey(pet.ln,pet.hn,lookupKey)===registrant.key?{outcome:'MATCH'}:{outcome:'MISMATCH',fields:['hn']};}
 const hn=registrant.hn.trim();if(!hn)return {outcome:'UNVERIFIED'};
 const fields:string[]=[];if(hn!==pet.hn.trim())fields.push('hn');
 if(registrant.dob&&registrant.dob!==pet.dob.slice(0,10))fields.push('dob');
 return fields.length?{outcome:'MISMATCH',fields}:{outcome:'MATCH'};
}

/** P1/P2 shared column: nipt_case.identity_key. P2 derives it as lnHnKey (verified at local P2 commit 456e65d). */
export const caseKeyIdentitySource:RegistrantIdentitySource={async forCase(db,caseId){
 const r=(await db.query<{identity_key:string}>('SELECT identity_key FROM nipt_case WHERE id=$1',[caseId])).rows[0];
 return r?{scheme:'LN_HN_HMAC',key:r.identity_key}:{scheme:'NONE'};
}};

/**
 * Integration seam for P2: prefers the registrant HN in p2_case_identity when that table exists.
 * Falls back to the shared case key on a P1-only schema. A P2 case without an HN row is UNVERIFIED.
 */
export const defaultIdentitySource:RegistrantIdentitySource={async forCase(db,caseId){
 const table=(await db.query<{name:string|null}>("SELECT to_regclass('public.p2_case_identity')::text AS name")).rows[0]?.name;
 if(!table)return caseKeyIdentitySource.forCase(db,caseId);
 const r=(await db.query<{hn:string}>('SELECT hn FROM p2_case_identity WHERE case_id=$1',[caseId])).rows[0];
 return r?{scheme:'HN_PLAIN',hn:r.hn}:{scheme:'NONE'};
}};
