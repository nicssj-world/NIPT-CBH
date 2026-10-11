import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pool,type Queryable} from '../packages/db/connection';
export async function migrate(client:Queryable,directory=resolve('db/migrations')) {
 await client.query('CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
 const files=(await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 const ledger=await client.query('SELECT name,checksum FROM schema_migration');
 if(ledger.rows.some(row=>!files.includes(String(row.name))))throw new Error('Applied migration missing from bundle');
 const applied = new Set(ledger.rows.map(row=>String(row.name)));
 const lastApplied = files.reduce((last,name,index)=>applied.has(name)?index:last,-1);
 if(files.slice(0,lastApplied+1).some(name=>!applied.has(name)))throw new Error('Backdated migration violates forward-only ordering');
 for(const row of ledger.rows) {
  const checksum=createHash('sha256').update(await readFile(resolve(directory,String(row.name)),'utf8')).digest('hex');
  if(row.checksum!==checksum) throw new Error(`Migration checksum mismatch: ${row.name}`);
 }
 for(const name of files) {
 const sql=await readFile(resolve(directory,name),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
 await client.query('BEGIN');
 try {
 await client.query('SELECT pg_advisory_xact_lock(75432800)');
 const existing=await client.query('SELECT checksum FROM schema_migration WHERE name=$1',[name]);
 if(existing.rows[0]) {if(existing.rows[0].checksum!==checksum)throw new Error(`Migration checksum mismatch: ${name}`);}
 else {if(client.exec) await client.exec(sql); else await client.query(sql);await client.query('INSERT INTO schema_migration(name,checksum) VALUES($1,$2)',[name,checksum]);}
 await client.query('COMMIT');
 } catch(error){await client.query('ROLLBACK');throw error;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {const client=await pool().connect();try {await migrate(client);}finally{client.release();await pool().end();}}

