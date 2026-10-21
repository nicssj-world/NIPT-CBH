import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {correctLegacyPetClocks} from '../../packages/inbound/clock-correction';
import {FileStore} from '../../packages/storage';
import {assertRuntimeDatabase} from '../../packages/db/connection';
const urlFile=process.env.NIPT_LOCAL_MIGRATION_URL_FILE,actor=process.env.NIPT_LOCAL_CORRECTION_ACTOR_ID,lookup=process.env.IDENTITY_LOOKUP_KEY_FILE,root=process.env.FILE_STORE_ROOT;
if(!urlFile||!actor||!lookup||!root)throw Error('LOCAL_CORRECTION_CONFIGURATION_REQUIRED');
const url=(await readFile(urlFile,'utf8')).trim();assertRuntimeDatabase(url);
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw Error('LOCAL_CORRECTION_LOOPBACK_ONLY');
const apply=process.argv.includes('--apply'),reason=process.env.NIPT_LOCAL_CORRECTION_REASON??'Owner LAB-11 clock mapping correction from immutable PET source';
const pool=new Pool({connectionString:url}),db=await pool.connect();
try{
 await db.query('BEGIN');
 const authorized=(await db.query("SELECT 1 FROM role_assignment WHERE user_id=$1 AND role IN ('APP_ADMIN','IT_OPERATOR') AND effective_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())",[actor])).rows.length>0;
 if(!authorized)throw Error('LOCAL_CORRECTION_ACTIVE_ADMIN_REQUIRED');
 const rows=await correctLegacyPetClocks(db,{store:new FileStore(root),lookupKey:await readFile(lookup)},actor,reason,apply);
 await db.query(apply?'COMMIT':'ROLLBACK');
 // No identifiers, names, raw PET or secret URLs are written to console.
 console.log(JSON.stringify({mode:apply?'APPLIED_APPEND_ONLY_OVERLAY':'PREVIEW_ONLY',files:rows.length,receivedRounds:rows.filter(r=>r.roundId).length,issuedLabels:'PRESERVED',originalRows:'PRESERVED'}));
}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();await pool.end();}
