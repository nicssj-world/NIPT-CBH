import {client} from './db-env';
const c=await client('migrator');
console.log(JSON.stringify((await c.query("SELECT t.id,t.model->>'state' state,(t.model->>'reconciliationRequired') recon,(t.model->>'artifactsMayExist') files,l.ln,(t.plan->>'resName') res,t.created_at FROM p6_transfer t LEFT JOIN result_release r ON r.id=t.clinical_release_id LEFT JOIN specimen_round s ON s.id=r.round_id LEFT JOIN case_ln l ON l.id=s.case_ln_id ORDER BY t.created_at")).rows,null,1));
await c.end();
