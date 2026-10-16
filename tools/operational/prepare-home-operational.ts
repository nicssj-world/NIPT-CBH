import {Pool,escapeIdentifier,escapeLiteral} from 'pg';
import {PgBoss} from 'pg-boss';
import {readFile} from 'node:fs/promises';
import {assertRuntimeDatabase,assertDatabaseMode} from '../../packages/db/connection';
import {hashPassword} from '../../packages/security/password';
import {configureOperational} from '../configure-operational';
import {migrate} from '../migrate';
type Account={username:string;displayName:string;password:string;role:'APP_ADMIN'|'LAB_STAFF'|'LAB_CERTIFIER'|'CLINICAL_APPROVER'|'AUDITOR'|'ANC_NURSE'};
const readSecret=async(name:string)=>{const file=process.env[name];if(!file)throw Error(name+'_REQUIRED');return (await readFile(file,'utf8')).trim();};
function accounts(bytes:string):Account[] {
 const values=JSON.parse(bytes) as unknown;
 if(!Array.isArray(values)||values.length!==6)throw Error('LOCAL_UAT_ACCOUNTS_INVALID');
 const allowed=new Set(['APP_ADMIN','LAB_STAFF','LAB_CERTIFIER','CLINICAL_APPROVER','AUDITOR','ANC_NURSE']);
 for(const row of values)if(!row||typeof row!=='object'||typeof row.username!=='string'||typeof row.displayName!=='string'||typeof row.password!=='string'||!allowed.has(row.role)||row.password.length<32)throw Error('LOCAL_UAT_ACCOUNTS_INVALID');
 if(new Set(values.map((row:Account)=>row.username)).size!==6||new Set(values.map((row:Account)=>row.role)).size!==6)throw Error('LOCAL_UAT_ACCOUNTS_INVALID');
 return values as Account[];
}
async function ensureDbLogin(db:Pool,name:'nipt_web'|'nipt_worker',group:'app_rw'|'worker_rw',fileVar:string) {
 const password=await readSecret(fileVar),exists=await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name]);
 if(!exists.rowCount)await db.query('CREATE ROLE '+escapeIdentifier(name)+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '+escapeLiteral(password));
 await db.query('GRANT '+escapeIdentifier(group)+' TO '+escapeIdentifier(name));
 if(name==='nipt_worker')await db.query('GRANT CREATE ON DATABASE '+escapeIdentifier(process.env.NIPT_OPERATIONAL_DATABASE??'')+' TO nipt_worker');
}
async function seedAccounts(db:Pool,values:Account[]) {
 const ids:Record<string,string>={};
 for(const account of values) {
  const existing=await db.query<{id:string}>('SELECT id FROM app_user WHERE username=$1',[account.username]);
  if(existing.rows[0])ids[account.username]=existing.rows[0].id;
  else ids[account.username]=(await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[account.username,account.displayName,await hashPassword(account.password)])).rows[0].id;
 }
 const admin=ids['uat.admin'],approver=ids['uat.clinical-approver'];
 for(const account of values) {
  const approverId=account.role==='LAB_CERTIFIER'?approver:null;
  await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids[account.username],account.role,approverId]);
 }
 const unit=(await db.query<{id:string}>('INSERT INTO unit(code,name) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET code=excluded.code RETURNING id',['LOCAL_UAT','LOCAL UAT test unit'])).rows[0].id;
 await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ids['uat.anc'],unit]);
 if(!admin||!approver)throw Error('LOCAL_UAT_ROLE_USERS_MISSING');
}
export async function prepareHomeOperational() {
 if(process.env.NIPT_MODE!=='operational')throw Error('OPERATIONAL_MODE_REQUIRED');
 const url=await readSecret('MIGRATION_DATABASE_URL_FILE');assertRuntimeDatabase(url);
 const expected=process.env.NIPT_OPERATIONAL_DATABASE;
 const parsed=new URL(url);
 if(!expected||decodeURIComponent(parsed.pathname.slice(1))!==expected||parsed.hostname!=='db')throw Error('LOCAL_UAT_DATABASE_TARGET_MISMATCH');
 const db=new Pool({connectionString:url});
 try {
  const client=await db.connect();
  try {
   await migrate(client);
   await configureOperational(client);
   await assertDatabaseMode(client);
  } finally {client.release();}
  const boss=new PgBoss(url);await boss.start();await boss.stop();
  await db.query(await readFile('packages/db/roles.sql','utf8'));
  await db.query(await readFile('packages/p6/grants.sql','utf8'));
  await ensureDbLogin(db,'nipt_web','app_rw','WEB_DB_PASSWORD_FILE');
  await ensureDbLogin(db,'nipt_worker','worker_rw','WORKER_DB_PASSWORD_FILE');
  await db.query('GRANT USAGE ON SCHEMA pgboss TO worker_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO worker_rw; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO worker_rw');
  await db.query('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');
  await seedAccounts(db,accounts(await readSecret('NIPT_UAT_ACCOUNTS_FILE')));
  const marker=await db.query<{mode:string;database:string}>('SELECT mode,current_database() AS database FROM nipt_runtime_config CROSS JOIN (SELECT current_database()) d WHERE singleton=true');
  if(marker.rows[0]?.mode!=='operational'||marker.rows[0]?.database!==expected)throw Error('LOCAL_UAT_DATABASE_MODE_MISMATCH');
  return {mode:marker.rows[0].mode,database:marker.rows[0].database,accounts:6};
 } finally {await db.end();}
}
const result=await prepareHomeOperational();
process.stdout.write('HOME_UAT_DATABASE_READY mode='+result.mode+' database='+result.database+' testAccounts='+result.accounts+' patientCases=0\n');
