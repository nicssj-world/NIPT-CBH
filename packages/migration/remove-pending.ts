import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,audit,uuid,LabError,type Staff} from '../lab/core';

/** Owner 2026-11-10: a person can take an imported row that is still waiting for its PET ("รอเข้า LAB") off the list.
 *  Only a row that was never matched to a case can go; nothing is deleted: it becomes an exception (kept with who and when), which also frees its LN and LN Halos for a corrected import. */
export async function removePendingImport(db:Queryable,user:Staff,input:unknown):Promise<{outcome:'REMOVED'}>{
 await assertSession(db,user);need(user,'worksheet.revise');
 const d=z.strictObject({recordId:uuid}).parse(input);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`migration-remove:${d.recordId}`]);
 const r=(await db.query<{id:string;state:string;case_id:string|null;classification:string;exceptions:unknown[]}>('SELECT id,state,case_id,classification,exceptions FROM migration_record WHERE id=$1',[d.recordId])).rows[0];
 if(!r)throw new LabError('NOT_FOUND',404);
 if(r.state!=='IMPORTED'||r.case_id!==null||r.classification!=='NO_HALOS')throw new LabError('PENDING_IMPORT_NOT_REMOVABLE',409);
 await db.query("UPDATE migration_record SET state='EXCEPTION',exceptions=$2 WHERE id=$1",[r.id,JSON.stringify([...(Array.isArray(r.exceptions)?r.exceptions:[]),{code:'REMOVED_BY_USER'}])]);
 await db.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'REMOVED_BY_USER','{}')",[r.id,user.id]);
 await audit(db,user,'MIGRATION_PENDING_IMPORT_REMOVED','MIGRATION_RECORD',r.id,{outcome:'REMOVED'});
 return {outcome:'REMOVED'};
}
