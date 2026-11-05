import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {assertDatabaseMode,pool} from '../../packages/db/connection';
import {reconcilePendingLnImports} from '../../packages/migration/ln-halos-matching';
import {FileStore} from '../../packages/storage';

let started=false,busy=false;

/** The web role owns migration writes; the HIS worker retains its existing restricted privileges. */
export function startLnHalosReconciler(){
 if(started)return;started=true;
 const run=async()=>{
  if(busy||!process.env.IDENTITY_LOOKUP_KEY_FILE||!process.env.FILE_STORE_ROOT||!process.env.DATABASE_URL)return;
  busy=true;
  let client:PoolClient|undefined;
  let lock=false,fence=false;
  try{
   client=await pool().connect();
   lock=(await client.query<{ok:boolean}>('SELECT pg_try_advisory_lock(75432888) ok')).rows[0].ok;
   if(!lock)return;
   fence=(await client.query<{ok:boolean}>('SELECT pg_try_advisory_lock_shared(75432804) ok')).rows[0].ok;
   if(!fence)return;
   await assertDatabaseMode(client);
   const key=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE);
   if(key.length!==32)throw Error('IDENTITY_LOOKUP_KEY_INVALID');
   await reconcilePendingLnImports(pool(),new FileStore(path.resolve(process.env.FILE_STORE_ROOT)),key);
  }catch{console.error('LN_HALOS_IMPORT_RECONCILIATION_FAILED');}
  finally{
   if(client){try{if(fence)await client.query('SELECT pg_advisory_unlock_shared(75432804)');if(lock)await client.query('SELECT pg_advisory_unlock(75432888)');}finally{client.release();}}
   busy=false;
  }
 };
 const timer=setInterval(()=>{void run();},15000);timer.unref();void run();
}
