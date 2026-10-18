/** Worker process for the Windows installation: the existing Worker, stopped through its own graceful lifecycle.
 * Windows cannot deliver SIGTERM to a child process, so the supervisor sends STOP_WORKER over the IPC channel. */
import {startWorker} from '../../packages/jobs/worker';
import {pool} from '../../packages/db/connection';
if(!process.send)throw Error('SUPERVISOR_IPC_REQUIRED');
const worker=await startWorker();let stopping=false;
process.on('message',message=>{if(message==='STOP_WORKER'&&!stopping){stopping=true;void worker.stop().then(()=>pool().end()).then(()=>process.exit(0),()=>process.exit(1));}});
