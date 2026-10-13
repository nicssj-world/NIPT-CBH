/** Native test dependency only: abrupt process exit at the hardlink crash window. No finally
 * cleanup is allowed before exit, so the parent can verify real session-lock/staging recovery. */
import {Pool} from 'pg';
import {z} from 'zod';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {runTransfer} from '../../packages/p6/worker';
const url=process.env.DATABASE_URL??'';assertSyntheticDatabase(url);
if(new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/nipt_p6_synthetic_'))throw Error('ISOLATED_P6_NATIVE_DATABASE_REQUIRED');
const id=z.uuid().parse(process.argv[2]),artifact=z.enum(['PDF','RES','BACKUP','OK']).parse(process.argv[3]);
const pool=new Pool({connectionString:url}),db=await pool.connect();
try{await runTransfer(db,id,{fileHook:async e=>{if(e.artifact===artifact&&e.point==='AFTER_LINK')process.exit(91);}});}
finally{db.release();await pool.end();}
throw Error('EXPECTED_CRASH_POINT_NOT_REACHED');
