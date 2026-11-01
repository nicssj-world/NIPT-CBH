import type {Queryable} from '../db/connection';
/** Original registry presentation is independent of the canonical internal base and never rebuilt from demographics. */
export async function migrationOriginalIdentifiers(db:Queryable,roundIds:readonly string[]){
 const out=new Map<string,string>();if(!roundIds.length)return out;
 if(!(await db.query<{present:boolean}>("SELECT to_regclass('public.migration_record') IS NOT NULL present")).rows[0]?.present)return out;
 const rows=(await db.query<{round_id:string;ln_halos:string}>("SELECT round_id,ln_halos FROM migration_record WHERE round_id=ANY($1::uuid[]) AND state='IMPORTED'",[[...roundIds]])).rows;
 for(const r of rows)out.set(r.round_id,r.ln_halos);return out;
}
