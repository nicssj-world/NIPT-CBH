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
 |{scheme:'P2_LN_HN';ln:string;hn:string;key:string}
 |{scheme:'NONE'};
export type IdentityComparison={outcome:'MATCH'}|{outcome:'MISMATCH';fields:string[]}|{outcome:'UNVERIFIED'};

export interface RegistrantIdentitySource{forCase(db:Queryable,caseId:string):Promise<RegistrantIdentity>;}

/** P2 identity contract (docs/p2-p3-handoff.md): identityLookup(JSON.stringify([normalizedLn, hn]), key). Text, leading zeros kept. */
export const lnHnKey=(ln:string,hn:string,lookupKey:Buffer)=>identityLookup(JSON.stringify([ln,hn.trim()]),lookupKey);

export function compareRegistrant(registrant:RegistrantIdentity,pet:Pet,lookupKey:Buffer):IdentityComparison{
 if(registrant.scheme==='NONE')return {outcome:'UNVERIFIED'};
 if(registrant.scheme==='LN_HN_HMAC'){if(!/^[a-f0-9]{64}$/.test(registrant.key))return {outcome:'UNVERIFIED'};return lnHnKey(pet.ln,pet.hn,lookupKey)===registrant.key?{outcome:'MATCH'}:{outcome:'MISMATCH',fields:['hn']};}
 if(registrant.scheme==='P2_LN_HN'){
  // The stored case digest must itself be the P2 pair for this LN/HN; otherwise the registrant evidence is not P2-verified
  // (e.g. a P1 SYNTHETIC-ID digest) and nothing is inferred from LN or HN equality alone.
  if(!/^[a-f0-9]{64}$/.test(registrant.key)||lnHnKey(registrant.ln,registrant.hn,lookupKey)!==registrant.key)return {outcome:'UNVERIFIED'};
  const fields=[...(registrant.ln!==pet.ln?['ln']:[]),...(registrant.hn!==pet.hn.trim()?['hn']:[])];
  return fields.length?{outcome:'MISMATCH',fields}:{outcome:'MATCH'};
 }
 const hn=registrant.hn.trim();if(!hn)return {outcome:'UNVERIFIED'};
 const fields:string[]=[];if(hn!==pet.hn.trim())fields.push('hn');
 if(registrant.dob&&registrant.dob!==pet.dob.slice(0,10))fields.push('dob');
 return fields.length?{outcome:'MISMATCH',fields}:{outcome:'MATCH'};
}

/** Shared column nipt_case.identity_key only. Retained for explicit P1-only comparisons; not the integrated default. */
export const caseKeyIdentitySource:RegistrantIdentitySource={async forCase(db,caseId){
 const r=(await db.query<{identity_key:string}>('SELECT identity_key FROM nipt_case WHERE id=$1',[caseId])).rows[0];
 return r?{scheme:'LN_HN_HMAC',key:r.identity_key}:{scheme:'NONE'};
}};

/**
 * Integrated default (P2-P3): the registrant's immutable p2_case_identity HN, the case's current LN and its digest.
 * A case without P2 identity (P1 synthetic legacy digest) is NONE, so matching fails closed as IDENTITY_UNVERIFIED.
 */
export const p2IdentitySource:RegistrantIdentitySource={async forCase(db,caseId){
 const r=(await db.query<{ln:string;hn:string;identity_key:string}>("SELECT l.ln,i.hn,c.identity_key FROM nipt_case c JOIN p2_case_identity i ON i.case_id=c.id JOIN case_ln l ON l.case_id=c.id AND l.verification<>'RETIRED' WHERE c.id=$1 ORDER BY l.version DESC LIMIT 1",[caseId])).rows[0];
 return r?{scheme:'P2_LN_HN',ln:r.ln,hn:r.hn,key:r.identity_key}:{scheme:'NONE'};
}};
export const defaultIdentitySource=p2IdentitySource;
