/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// Read-only: check the template-registry objects and what the web role can read in the isolated UAT DB.
import {client} from './db-env';
const c=await client('web');
const q=async(l:string,s:string)=>{try{console.log(l,JSON.stringify((await c.query(s)).rows).slice(0,300));}catch(e){console.log(l,'ERR',(e as Error).message);}};
await q('active','SELECT count(*)::int n FROM report_template_active');
await q('rev','SELECT count(*)::int n FROM report_template_revision');
await q('mig','SELECT name FROM schema_migration ORDER BY name DESC LIMIT 3');
await q('grants',"SELECT has_table_privilege('nipt_web','report_template_active','SELECT') a,has_table_privilege('nipt_web','report_template_revision','SELECT') r");
await c.end();
