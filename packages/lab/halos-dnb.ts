import type {Queryable} from '../db/connection';
import {bangkokDnbId} from '../sequencing/owner-task-import';
/**
 * DNB ID of the newest HALOS Task export of the batch (Owner 2026-11-14): exactly the value in that file's "*DNB ID" column, i.e. "DNB" + the
 * Bangkok day the export was clicked. Older exports did not store it, so it is derived from their stored click time by the same function. null = no export yet.
 */
export async function latestHalosDnbId(db:Queryable,batchId:string):Promise<string|null>{
 const m=(await db.query<{manifest:{dnbId?:string;clickedAt?:string}}>('SELECT manifest FROM lab_seq_export_pair WHERE batch_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[batchId])).rows[0]?.manifest;
 if(!m)return null;
 if(m.dnbId)return m.dnbId;
 return m.clickedAt?bangkokDnbId(new Date(m.clickedAt)):null;
}
