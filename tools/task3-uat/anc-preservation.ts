import {Client} from 'pg';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const base=path.resolve('.local/task3-uat');
const password=(await readFile(path.join(base,'secrets/db-password'),'utf8')).trim();
const db=new Client({host:'127.0.0.1',port:20129,user:'nipt_migrator',password,database:'nipt_task3_integrated_owner_uat'});
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 const tables=(await db.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('app_session','login_throttle','app_user') ORDER BY tablename")).rows;
 const rows:Record<string,string[]>={};
 for(const {tablename} of tables)rows[tablename]=(await db.query(`SELECT md5(row_to_json(t)::text) hash FROM "${tablename}" t ORDER BY 1`)).rows.map(r=>r.hash);
 const ledger=(await db.query("SELECT * FROM schema_migration ORDER BY 1")).rows;
 await db.query('COMMIT');
 const files:Record<string,string>={};
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else files[path.relative(base,f)]=sha(await readFile(f));}}
 await walk(path.join(base,'data'));await walk(path.join(base,'forms'));
 const name=process.argv[2]??'before';
 await writeFile(`docs/anc-owner-uat-20261025/preservation-${name}.json`,JSON.stringify({at:new Date().toISOString(),database:'nipt_task3_integrated_owner_uat',rows,ledger,files},null,2));
 console.log(JSON.stringify({tables:tables.length,files:Object.keys(files).length,ledger:ledger.length}));
}finally{await db.end();}
