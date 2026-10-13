import {Client} from 'pg';
import {z} from 'zod';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import type {Role} from '../../packages/security/policy';
import {FileStore} from '../../packages/storage';
import {inspectHistoricalIntegrity} from '../../packages/historical/maintenance';

// Explicit diagnostic connection only; never loads .env or falls back to DATABASE_URL.
if(process.env.NIPT_P7_MAINTENANCE_READONLY!=='yes')throw Error('EXPLICIT_READONLY_MAINTENANCE_REQUIRED');
const url=process.env.NIPT_P7_MAINTENANCE_URL??'';assertSyntheticDatabase(url);
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw Error('LOOPBACK_MAINTENANCE_REQUIRED');
const actorId=z.uuid().parse(process.env.NIPT_P7_MAINTENANCE_ACTOR_ID);
if(!process.env.NIPT_P7_MAINTENANCE_FILESTORE)throw Error('EXPLICIT_MAINTENANCE_FILESTORE_REQUIRED');
const db=new Client({connectionString:url});await db.connect();
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 if(!(await db.query('SELECT id FROM app_user WHERE id=$1 AND enabled AND (locked_until IS NULL OR locked_until<=now())',[actorId])).rowCount)throw Error('ACTIVE_ACTOR_REQUIRED');
 const roles=(await db.query<{role:Role}>("SELECT role FROM role_assignment WHERE user_id=$1 AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now()) AND (role<>'LAB_CERTIFIER' OR approved_by IS NOT NULL)",[actorId])).rows.map(r=>r.role);
 const report=await inspectHistoricalIntegrity(db,{id:actorId,roles,unitIds:[],permissions:[]},new FileStore(process.env.NIPT_P7_MAINTENANCE_FILESTORE));
 await db.query('COMMIT');process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(report.issues.length)process.exitCode=2;
}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
