import {pathToFileURL} from 'node:url';
import {startWorker} from '../../packages/jobs/worker';
export {startWorker};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startWorker().then(worker=>{for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void worker.stop().then(()=>process.exit(0)));}).catch(()=>{process.stderr.write('WORKER_START_FAILED\n');process.exitCode=1;});
