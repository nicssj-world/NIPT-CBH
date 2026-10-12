import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Opt-in against the seeded native synthetic test DB: real concurrency (AT-LDR-08) under app_rw/worker_rw logins and the pg-boss worker.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P3 inbound: concurrent registration vs worker, real worker scan, Test Connection, share outage',async()=>{
 const result=await run(process.execPath,['--env-file=.env.local','--import','tsx','tools/his-simulator/smoke-p3-inbound.ts'],{env:{...process.env,NIPT_MODE:'synthetic',DATABASE_URL:process.env.NIPT_TEST_DATABASE_URL!},timeout:150000});
 expect(JSON.parse(result.stdout.trim().split('\n').pop()!)).toEqual({code:'NATIVE_P3_INBOUND_SMOKE_PASSED',concurrentLns:12,ldr08Invariant:true,workerScanApplied:true,workerRole:'nipt_worker',connectionTestPassed:true,shareOutageVisible:true});
},180000);
