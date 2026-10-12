import type {PoolClient} from 'pg';
import type {Queryable} from '../db/connection';

export type Tx=<T>(fn:(client:Queryable)=>Promise<T>)=>Promise<T>;
type Connectable=Queryable&{connect?:()=>Promise<PoolClient>};

/** One transaction per unit of work: a pooled client for pg, or the single connection for PGlite in tests. */
export function transactional(db:Connectable):Tx{
 return async fn=>{
  if(db.connect){const client=await db.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  await db.query('BEGIN');try{const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}
 };
}

/** Stable machine code for persistence and audit; free text from drivers is never stored. */
export const errorCode=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]{1,64}$/.test(e.message)?e.message:'PROCESSING_FAILED';
