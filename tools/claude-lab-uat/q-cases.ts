import {client} from './db-env';
const c=await client('migrator');
console.log(JSON.stringify((await c.query("SELECT l.ln,c.id,c.registration_origin o,(SELECT count(*) FROM result_release r WHERE r.case_id=c.id AND r.state='Active')::int released FROM nipt_case c JOIN case_ln l ON l.case_id=c.id WHERE l.ln LIKE '262987010%' ORDER BY l.ln")).rows));
await c.end();
