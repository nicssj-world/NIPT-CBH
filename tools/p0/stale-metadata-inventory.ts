// Read-only inventory (Plan Rev 3.4 §5.1 step 6): workbook draft revisions whose Task metadata did not come from the
// Lab source, and native controlled documents issued from them. SELECT only, inside BEGIN READ ONLY; never writes.
// Usage: npx tsx tools/p0/stale-metadata-inventory.ts <file containing a postgres URL> [loopback port]
// A Docker-internal URL (e.g. db:5432 from a compose secret) is reached through its published loopback port, which must
// be given explicitly (UX-V2 preview: 19519) — the script never guesses a port.
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
import {staleMetadataInventory} from './stale-metadata-core';
const file=process.argv[2];if(!file)throw Error('URL_FILE_REQUIRED');
const url=new URL((await readFile(file,'utf8')).trim());
if(!/^\/(nipt_operational_ux_v2_local|nipt_synthetic_[a-z0-9_]+)$/.test(url.pathname))throw Error('LOCAL_SYNTHETIC_DATABASE_REQUIRED');
if(!['127.0.0.1','localhost'].includes(url.hostname)){
 const port=process.argv[3];if(!port||!/^\d{2,5}$/.test(port))throw Error('LOOPBACK_PORT_REQUIRED_FOR_CONTAINER_URL');
 url.hostname='127.0.0.1';url.port=port;
}
const db=new Client({connectionString:url.toString()});await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 const result=await staleMetadataInventory(db);
 await db.query('ROLLBACK');
 console.log(JSON.stringify({database:url.pathname.slice(1),readOnly:true,...result},null,1));
}finally{await db.end();}
