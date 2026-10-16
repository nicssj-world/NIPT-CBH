import { createHash } from "node:crypto";
import {Pool} from 'pg';
import type { Queryable } from "./connection";
const allowed = new Set(["outcome","reasonCode","ruleVersion","origin","version","count","synthetic"]);
export function safeDetails(details:Record<string,unknown> = {}) { for(const [key,value] of Object.entries(details)) if(!allowed.has(key) || !["boolean","number","string"].includes(typeof value) || (typeof value === "string" && !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(value))) throw new Error("Unsafe audit details"); return Object.fromEntries(Object.entries(details).sort(([a],[b])=>a.localeCompare(b))); }
export function auditHash(previous:string,payload:string) { return createHash("sha256").update(previous+"\n"+payload).digest("hex"); }
type AuditEvent={actorId?:string;action:string;resourceType:string;resourceId?:string;details?:Record<string,unknown>};
export async function appendAudit(client:Queryable,event:AuditEvent) {
 if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(event.action)||!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(event.resourceType)) throw new Error("Invalid audit vocabulary");
 // Pool.query runs each statement in autocommit and may use different sessions.
 // Keep the advisory transaction lock, tail read and insert on one connection.
 // Existing PoolClient/Queryable callers continue to own their transaction.
 if(!(client instanceof Pool))return appendAuditInTransaction(client,event);
 const connection=await client.connect();let destroy=false;
 try{await connection.query('BEGIN');const hash=await appendAuditInTransaction(connection,event);await connection.query('COMMIT');return hash;}
 catch(error){try{await connection.query('ROLLBACK');}catch{destroy=true;}throw error;}
 finally{if(destroy)connection.release(true);else connection.release();}
}
async function appendAuditInTransaction(client:Queryable,event:AuditEvent){
 await client.query("SELECT pg_advisory_xact_lock(75432801)");
 const last=await client.query("SELECT hash FROM audit_chain ORDER BY sequence DESC LIMIT 1");
 const previous=String(last.rows[0]?.hash ?? "GENESIS");
 const payload=JSON.stringify({actorId:event.actorId??null,action:event.action,resourceType:event.resourceType,resourceId:event.resourceId??null,details:safeDetails(event.details)});
 const hash=auditHash(previous,payload);
 await client.query("INSERT INTO audit_chain(actor_id,action,resource_type,resource_id,details,previous_hash,hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[event.actorId??null,event.action,event.resourceType,event.resourceId??null,safeDetails(event.details),previous,hash,payload]);
 return hash;
}
export function verifyAuditChain(rows:readonly {previous_hash:string;hash:string;payload:string}[]) {let previous="GENESIS"; for(const row of rows){if(row.previous_hash!==previous||auditHash(previous,row.payload)!==row.hash)return false;previous=row.hash;}return true;}
