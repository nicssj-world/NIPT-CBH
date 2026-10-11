import { Pool, type PoolClient } from "pg";
export interface Queryable { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{rows: T[]}>; exec?(sql:string): Promise<unknown>; }
let instance: Pool | undefined;
export function assertSyntheticDatabase(url: string) {
 if(process.env.NIPT_MODE !== "synthetic") throw new Error("Synthetic mode required");
 const parsed = new URL(url);
 if(!["localhost","127.0.0.1","[::1]","db","postgres"].includes(parsed.hostname)) throw new Error("Synthetic database must be loopback or Docker database");
 if(!parsed.pathname.toLowerCase().includes("synthetic")) throw new Error("Database name must identify synthetic data");
}
export function pool(): Pool { const url=process.env.DATABASE_URL; if(!url) throw new Error("DATABASE_URL required"); assertSyntheticDatabase(url); return instance ??= new Pool({connectionString:url}); }
export async function withTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> { const client=await pool().connect(); try { await client.query("BEGIN"); const result=await fn(client); await client.query("COMMIT"); return result; } catch(error) { await client.query("ROLLBACK"); throw error; } finally {client.release();} }

