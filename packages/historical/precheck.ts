import {normalizeLn} from '../domain';
import type {Reason} from './types';

/**
 * Pre-creation duplicate and identity check (Plan §4.8 H1, §5.11 LnCheck/IdentityCheck, AT-HIST-05/12/16). Pure: the caller reads the
 * registry facts (under the LN advisory lock, D-49) and passes them in. Nothing here links or merges; HN alone is never identity.
 */
export type Identifiers={hn?:string|null;name?:string|null;dob?:string|null;nationalIdLast4?:string|null};
export type RegistryLn={ln:string;caseId:string;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';version:number};
export type RegistryPatient={caseId:string;identifiers:Identifiers};
export type ActiveDraft={id:string;ln:string};
export type IntakeFact={ln:string;state:string};
export type PrecheckInput={
 ln:string;identifiers:Identifiers;selfDraftId?:string;
 caseLns:readonly RegistryLn[];activeDrafts:readonly ActiveDraft[];intakes:readonly IntakeFact[];patients:readonly RegistryPatient[];
};
export type PrecheckResult={outcome:'CLEAR'|'QUEUE';findings:Reason[]};

const norm=(v:string|null|undefined)=>(v??'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
const normHn=(v:string|null|undefined)=>(v??'').trim();
type Key='hn'|'name'|'dob'|'nationalIdLast4';
const KEYS:readonly Key[]=['hn','name','dob','nationalIdLast4'];
const val=(i:Identifiers,k:Key)=>k==='hn'?normHn(i.hn):k==='name'?norm(i.name):(i[k]??'').trim();

/** Compare two identity sets over the identifiers present on BOTH sides. */
export function compareIdentity(a:Identifiers,b:Identifiers):{outcome:'MATCH'|'CONFLICT'|'INSUFFICIENT';comparable:Key[];differing:Key[]}{
 const comparable=KEYS.filter(k=>val(a,k)!==''&&val(b,k)!=='');
 const differing=comparable.filter(k=>val(a,k)!==val(b,k));
 if(differing.length)return {outcome:'CONFLICT',comparable,differing};
 return {outcome:comparable.length>=2?'MATCH':'INSUFFICIENT',comparable,differing};
}

export function precheckHistoricalDraft(input:PrecheckInput):PrecheckResult{
 const ln=normalizeLn(input.ln);
 const findings:Reason[]=[];
 for(const c of input.caseLns)if(normalizeLn(c.ln)===ln)findings.push({code:'LN_EXISTS_IN_CASE_LN',ref:`${c.origin}:v${c.version}`});
 for(const d of input.activeDrafts)if(normalizeLn(d.ln)===ln&&d.id!==input.selfDraftId)findings.push({code:'ACTIVE_DRAFT_EXISTS',ref:d.id});
 for(const i of input.intakes)if(normalizeLn(i.ln)===ln)findings.push({code:'INTAKE_EXISTS_FOR_LN',ref:i.state});
 const id=input.identifiers;
 for(const p of input.patients){
  const sameHn=normHn(id.hn)!==''&&normHn(id.hn)===normHn(p.identifiers.hn);
  const cmp=compareIdentity(id,p.identifiers);
  if(sameHn){
   if(cmp.outcome==='CONFLICT')findings.push({code:'IDENTITY_CONFLICT_SAME_HN',ref:p.caseId});
   else if(cmp.outcome==='INSUFFICIENT')findings.push({code:'HN_ONLY_MATCH_NOT_LINKED',ref:p.caseId});
   else findings.push({code:'IDENTITY_MATCH_EXISTING_PATIENT_REVIEW',ref:p.caseId});
  }else if(norm(id.name)!==''&&norm(id.name)===norm(p.identifiers.name)&&(id.dob??'')!==''&&id.dob===p.identifiers.dob){
   findings.push({code:'POSSIBLE_DUPLICATE_PATIENT_DIFFERENT_HN',ref:p.caseId});
  }
 }
 return {outcome:findings.length?'QUEUE':'CLEAR',findings};
}
