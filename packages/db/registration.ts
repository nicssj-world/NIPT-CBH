import {createHash} from "node:crypto";
import {normalizeLn,idempotencyKey,type Origin} from "../domain";
import type {Queryable} from "./connection";
import {appendAudit} from "./audit";
export async function lockLn(client:Queryable,ln:string) { await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,75432802))",[normalizeLn(ln)]); }
export interface RegisterInput {ln:string;identityKey:string;origin:Origin;actorId?:string;idempotencyKey:string;}
export async function registerCase(client:Queryable,input:RegisterInput) {
 const ln=normalizeLn(input.ln); idempotencyKey(input.idempotencyKey);
 if(input.origin==='HISTORICAL') throw new Error('P1 historical promotion disabled');
 if(!['ANC','LAB_DIRECT'].includes(input.origin)||! /^[a-f0-9]{64}$/.test(input.identityKey)) throw new Error('Invalid registration');
 const requestHash=createHash('sha256').update(JSON.stringify([ln,input.identityKey,input.origin,input.actorId??null])).digest('hex');
 await lockLn(client,ln);
 const replay=await client.query('SELECT case_id,outcome,request_hash FROM registration_attempt WHERE idempotency_key=$1',[input.idempotencyKey]);
 if(replay.rows[0]) {if(replay.rows[0].request_hash!==requestHash) throw new Error('Idempotency conflict');return {caseId: replay.rows[0].case_id as string|null,outcome:replay.rows[0].outcome as string};}
 const existing=await client.query('SELECT c.id,c.identity_key FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.ln=$1 ORDER BY l.version DESC LIMIT 1',[ln]);
 let caseId:string|null=null;let outcome:string;
 if(existing.rows[0]) {caseId=existing.rows[0].id as string;outcome=existing.rows[0].identity_key===input.identityKey?'OPENED':'CONFLICT';if(outcome==='CONFLICT')caseId=null;}
 else {
 const created=await client.query('INSERT INTO nipt_case(registration_origin,identity_key) VALUES($1,$2) RETURNING id',[input.origin,input.identityKey]);caseId=created.rows[0].id as string;
 const link=await client.query('INSERT INTO case_ln(case_id,ln,source) VALUES($1,$2,$3) RETURNING id',[caseId,ln,input.origin==='ANC'?'ANC_ENTRY':'LAB_ENTRY']);
 const round=await client.query('INSERT INTO specimen_round(case_id,case_ln_id,round_number) VALUES($1,$2,1) RETURNING id',[caseId,link.rows[0].id]);
 await client.query('UPDATE nipt_case SET current_round_id=$1 WHERE id=$2',[round.rows[0].id,caseId]);outcome='CREATED';
 }
 await client.query('INSERT INTO registration_attempt(case_id,origin,outcome,actor_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[caseId,input.origin,outcome,input.actorId??null,input.idempotencyKey,requestHash]);
 await appendAudit(client,{actorId:input.actorId,action:'CASE_REGISTRATION',resourceType:'nipt_case',resourceId:caseId??undefined,details:{outcome,origin:input.origin,synthetic:true}});
 return {caseId,outcome};
}
