import {pathToFileURL} from 'node:url';
import {pool,assertRuntimeDatabase,type Queryable} from '../packages/db/connection';
import {runtimeMode} from '../packages/security/runtime';
/** Run explicitly after migrations, before patient intake. Runtime DB users cannot update this table. */
export async function configureOperational(db:Queryable){
 if(runtimeMode()!=='operational')throw Error('OPERATIONAL_MODE_REQUIRED');
 await db.query('BEGIN');
 try{
  const row=(await db.query<{mode:string}>('SELECT mode FROM nipt_runtime_config WHERE singleton=true FOR UPDATE')).rows[0];
  if(!row)throw Error('RUNTIME_CONFIG_MISSING');
  if(row.mode==='operational'){await db.query('COMMIT');return {configured:false};}
  const populated=(await db.query<{populated:boolean}>('SELECT EXISTS(SELECT 1 FROM nipt_case UNION ALL SELECT 1 FROM p2_case_identity UNION ALL SELECT 1 FROM his_inbound_file UNION ALL SELECT 1 FROM p2_doctor_version UNION ALL SELECT 1 FROM file_asset) AS populated')).rows[0];
  if(populated?.populated)throw Error('EMPTY_OPERATIONAL_DATABASE_REQUIRED');
  await db.query("UPDATE nipt_runtime_config SET mode='operational' WHERE singleton=true");
  await db.query('COMMIT');return {configured:true};
 }catch(error){await db.query('ROLLBACK');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]!=='--apply')throw Error('EXPLICIT_APPLY_REQUIRED');
 assertRuntimeDatabase(process.env.DATABASE_URL??'');
 const client=await pool().connect();try{await configureOperational(client);process.stdout.write('OPERATIONAL_DATABASE_CONFIGURED\n');}finally{client.release();await pool().end();}
}
