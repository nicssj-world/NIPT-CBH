// Read-only: compare the latest HIS outbound draft with the active revision (non-path fields).
import {client} from './db-env';
const c=await client('migrator');
const rows=(await c.query("SELECT r.version,r.state,r.reason,r.value FROM settings_revision r WHERE setting_key='his_outbound' ORDER BY version")).rows;
const a=rows.find(r=>r.state==='Active')!,d=rows.at(-1)!;
console.log(rows.map(r=>[r.version,r.state,r.reason]));
for(const k of new Set([...Object.keys(a.value),...Object.keys(d.value)]))if(JSON.stringify(a.value[k])!==JSON.stringify(d.value[k]))console.log('DIFF',k,JSON.stringify(a.value[k]),'→',JSON.stringify(d.value[k]));
await c.end();
