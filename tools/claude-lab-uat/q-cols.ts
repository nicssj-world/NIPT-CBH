import {client} from './db-env';
const c=await client('migrator');
for(const t of process.argv.slice(2))console.log(t,(await c.query("SELECT string_agg(column_name,',') c FROM information_schema.columns WHERE table_name=$1",[t])).rows[0].c);
await c.end();
