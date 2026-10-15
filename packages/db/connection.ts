import { Pool, type PoolClient } from "pg";
import {runtimeMode,configuredOrigin} from "../security/runtime";
export interface Queryable { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{rows: T[]}>; exec?(sql:string): Promise<unknown>; }
let instance: Pool | undefined;
export function assertSyntheticDatabase(url: string) {
 if(process.env.NIPT_MODE !== "synthetic") throw new Error("Synthetic mode required");
 const parsed = new URL(url);
 if(!["postgres:","postgresql:"].includes(parsed.protocol))throw Error("INVALID_DATABASE_URL");
 if(!["localhost","127.0.0.1","[::1]","db","postgres"].includes(parsed.hostname)) throw new Error("Synthetic database must be loopback or Docker database");
 if(!parsed.pathname.toLowerCase().includes("synthetic")) throw new Error("Database name must identify synthetic data");
}
export function assertRuntimeDatabase(url: string): void {
 if(runtimeMode()==="synthetic"){assertSyntheticDatabase(url);return;}
 configuredOrigin();
 const parsed=new URL(url);
 if(!["postgres:","postgresql:"].includes(parsed.protocol)||!parsed.hostname||parsed.hash)throw Error("INVALID_DATABASE_URL");
 const expected=process.env.NIPT_OPERATIONAL_DATABASE;
 const database=decodeURIComponent(parsed.pathname.slice(1));
 if(!expected||database!==expected||/synthetic|template|^postgres$/i.test(database))throw Error("OPERATIONAL_DATABASE_TARGET_REQUIRED");
 const local=["localhost","127.0.0.1","[::1]","db","postgres"].includes(parsed.hostname);
 if(!local&&parsed.searchParams.get("sslmode")!=="verify-full")throw Error("DATABASE_VERIFIED_TLS_REQUIRED");
 if(parsed.searchParams.has("uselibpqcompat"))throw Error("INVALID_DATABASE_TLS_OVERRIDE");
}
export function pool(): Pool { const url=process.env.DATABASE_URL; if(!url) throw new Error("DATABASE_URL required"); assertRuntimeDatabase(url); return instance ??= new Pool({connectionString:url}); }
export async function assertDatabaseMode(db: Queryable): Promise<void> {
 const operational=runtimeMode()==="operational";
 const row=(await db.query<{operational:boolean}>("SELECT nipt_operational_enabled() AS operational")).rows[0];
 if(!row||row.operational!==operational)throw Error("RUNTIME_DATABASE_MODE_MISMATCH");
 if(operational&&(await db.query<{quarantined:boolean}>("SELECT nipt_runtime_quarantined() quarantined")).rows[0]?.quarantined!==false)throw Error("RESTORED_RUNTIME_QUARANTINED");
}
export async function withTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> { const client=await pool().connect(); try { await client.query("BEGIN"); if(runtimeMode()==="operational")await client.query("SELECT pg_advisory_xact_lock_shared(75432804)"); await assertDatabaseMode(client); const result=await fn(client); await client.query("COMMIT"); return result; } catch(error) { await client.query("ROLLBACK"); throw error; } finally {client.release();} }

