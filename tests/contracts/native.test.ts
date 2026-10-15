import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Opt-in only against the seeded native synthetic DB; child processes isolate pools/ports.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native PostgreSQL pg-boss worker and PET/redraw integration',async()=>{for(const script of ['smoke-worker.ts','smoke-pet.ts']){const result=await run(process.execPath,['--env-file-if-exists=.env.local','--import','tsx','tools/his-simulator/'+script],{env:{...process.env,NIPT_MODE:'synthetic',DATABASE_URL:process.env.NIPT_TEST_DATABASE_URL!},timeout:60000});expect(result.stdout).toContain('_SMOKE_PASSED');}},120000);
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native worker cannot bypass outbound identity validation on retries',async()=>{
 const result=await run(process.execPath,['--env-file-if-exists=.env.local','--import','tsx','tools/his-simulator/smoke-outbound-identity.ts'],{env:{...process.env,NIPT_MODE:'synthetic',DATABASE_URL:process.env.NIPT_TEST_DATABASE_URL!},timeout:120000});
 expect(result.stdout).toContain('NATIVE_OUTBOUND_IDENTITY_SMOKE_PASSED');
},150000);
