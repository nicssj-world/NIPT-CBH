import {Client} from 'pg';
import {FileStore} from '../../packages/storage';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {runArchiveCycle} from '../../packages/results/archive-worker';

const url=process.env.NIPT_RESTART_CHILD_URL,source=process.env.NIPT_RESTART_SOURCE_ROOT;
if(process.env.NIPT_RESTART_CHILD_GUARD!=='1'||!url||!source)throw Error('RESTART_CHILD_SYNTHETIC_GUARD');
assertSyntheticDatabase(url);
const db=new Client({connectionString:url,connectionTimeoutMillis:5000});
try{
 await db.connect();
 await db.query('SET ROLE worker_rw');
 const store=new FileStore(source);
 if(process.env.NIPT_RESTART_CHILD_MODE==='STALL'){
  await runArchiveCycle(db,store,async()=>new Promise(()=>{}));
 }else if(process.env.NIPT_RESTART_CHILD_MODE==='RECOVER'){
  await runArchiveCycle(db,store);
 }else throw Error('RESTART_CHILD_MODE_INVALID');
}finally{await db.end();}
