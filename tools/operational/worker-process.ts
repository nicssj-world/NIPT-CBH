/** Test transport only: actual Worker, stopped through its existing graceful lifecycle. */
import {startWorker} from '../../packages/jobs/worker';
import {pool} from '../../packages/db/connection';
if(!process.send||process.env.NIPT_OPERATIONAL_TEST_BUILT_WEB!=='yes')throw Error('DISPOSABLE_WORKER_IPC_REQUIRED');
const worker=await startWorker();let stopping=false;
process.on('message',message=>{if(message==='STOP_DISPOSABLE_WORKER'&&!stopping){stopping=true;void worker.stop().then(()=>pool().end()).then(()=>process.exit(0));}});
