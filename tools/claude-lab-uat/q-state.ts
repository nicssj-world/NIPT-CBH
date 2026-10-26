// Read-only state probe of the isolated synthetic UAT DB (port 20229).
import {client} from './db-env';
const c=await client('migrator');
const q=async(s:string)=>console.log(JSON.stringify((await c.query(s)).rows));
await q("SELECT name FROM schema_migration ORDER BY name DESC LIMIT 3").catch(async()=>q("SELECT * FROM information_schema.tables WHERE table_name ILIKE '%migration%'"));
await q("SELECT r.setting_key,r.version,r.state,r.value->>'basePath' base,r.value->>'resDestinationPath' res FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key IN ('his_inbound','his_outbound','result_management')");
await q("SELECT v.state,count(*)::int n FROM result_report_version v GROUP BY 1");
await q("SELECT r.state,r.kind,(SELECT count(*) FROM p6_transfer t WHERE t.clinical_release_id=r.id)::int transfers FROM result_release r");
await q("SELECT model->>'state' state,count(*)::int FROM p6_transfer GROUP BY 1");
await c.end();
