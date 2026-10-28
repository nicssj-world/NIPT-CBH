import {expect,it,vi} from 'vitest';
import {createArchiveRunner} from '../../packages/results/archive-runner';
it('waits for active archive I/O before graceful shutdown and refuses another cycle',async()=>{
 let release!:()=>void;const run=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
 const runner=createArchiveRunner(run),active=runner.cycle();let stopped=false;
 const shutdown=runner.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
 await runner.cycle();expect(run).toHaveBeenCalledTimes(1);release();await active;await shutdown;expect(stopped).toBe(true);
});
