// Moves the unexecuted Draft batch created by the acceptance run to the trash through the real route (OWNER-LAB-030: slots released, Run number recycled).
import {readFileSync} from 'node:fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const O='https://127.0.0.1:20228',cache=JSON.parse(readFileSync(process.env.TEMP+'/nipt-e2e-sessions.json','utf8')).certifier;
const cookie=cache.jar.map(([k,v])=>`${k}=${v}`).join('; ');
const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const h={cookie,origin:O,'x-csrf-token':cache.csrf,'content-type':'application/json'};
const w=await (await fetch(O+'/api/p4/batches/'+fx.draftBatchId,{headers:{cookie}})).json();
const r=await fetch(O+'/api/p4/batches/'+fx.draftBatchId,{method:'POST',headers:h,body:JSON.stringify({action:'trash',reason:'SYNTHETIC-E2E cleanup of the acceptance fixture batch',expectedVersion:w.version??w.batch?.version??w.workspace?.version})});
console.log(r.status,(await r.text()).slice(0,300));
