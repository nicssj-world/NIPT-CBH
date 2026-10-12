// Dev helper: one MANUAL inbound cycle against the local synthetic DB/simulator (same code path as the worker job).
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pool} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {simulatorRoot} from '../../packages/integrations/scanner';
import {runInboundCycle} from '../../packages/inbound/cycle';
const key=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE!);
try{const r=await runInboundCycle(pool(),{store:new FileStore(path.resolve(process.env.FILE_STORE_ROOT||'data/files')),lookupKey:key,root:simulatorRoot()},{trigger:'MANUAL',lookbackDays:3,intervalSeconds:30});console.log(JSON.stringify({code:'P3_DEMO_CYCLE',outcome:r.outcome,counts:r.counts}));}
finally{key.fill(0);await pool().end();}
