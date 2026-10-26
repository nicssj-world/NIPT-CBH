/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped). Read-only: recorded migration checksums in the isolated UAT ledger.
import {client} from './db-env';
const c=await client('migrator');
const cols=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='schema_migration'")).rows.map(r=>r.column_name);
console.log(cols.join(','));
console.log(JSON.stringify((await c.query("SELECT * FROM schema_migration WHERE name ~ '^13[0-4]_' ORDER BY name")).rows.map(r=>({n:r.name,h:r.checksum??r.sha256??r.hash}))));
await c.end();
