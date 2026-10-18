/** Database provisioning for the Windows installation. Runs with the release's own Node/tsx from the release `ops` folder.
 *  phase=install : create the database, apply forward migrations, mark the runtime operational, create the least-privilege
 *                  logins and the six test accounts (first installation only; refuses a database that is not empty).
 *  phase=migrate : apply forward migrations and re-assert grants/logins (upgrade). No accounts, no mode change.
 *  The migration ledger is forward-only with SHA-256 checksums (tools/migrate.ts): a changed, missing or backdated migration aborts.
 *  Test environment only; the installer never targets a database whose name looks like synthetic/template/postgres. */
import {Pool,escapeIdentifier,escapeLiteral} from 'pg';
import {PgBoss} from 'pg-boss';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertRuntimeDatabase,assertDatabaseMode} from '../../packages/db/connection';
import {hashPassword} from '../../packages/security/password';
import {configureOperational} from '../configure-operational';
import {migrate} from '../migrate';
type Account={username:string;displayName:string;password:string;role:'APP_ADMIN'|'LAB_STAFF'|'LAB_CERTIFIER'|'CLINICAL_APPROVER'|'AUDITOR'|'ANC_NURSE'};
const arg=(name:string)=>{const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:undefined;};
const root=arg('root'),phase=arg('phase');
if(!root||!['install','migrate'].includes(phase??''))throw Error('PROVISION_ARGUMENTS_REQUIRED');
const secrets=path.join(root,'secrets');
const secret=async(name:string)=>(await readFile(path.join(secrets,name),'utf8')).trim();
const database=process.env.NIPT_OPERATIONAL_DATABASE??'';
if(process.env.NIPT_MODE!=='operational'||!/^nipt_operational_[a-z0-9_]{1,40}$/.test(database)||/synthetic|template/.test(database))throw Error('INSTALLER_OPERATIONAL_TEST_DATABASE_REQUIRED');

const migrationUrl=await secret('migration-url');assertRuntimeDatabase(migrationUrl);
const accountsOf=(raw:string):Account[]=>{
 const values=JSON.parse(raw) as Account[];
 const allowed=new Set(['APP_ADMIN','LAB_STAFF','LAB_CERTIFIER','CLINICAL_APPROVER','AUDITOR','ANC_NURSE']);
 if(!Array.isArray(values)||values.length!==6||new Set(values.map(v=>v.username)).size!==6||new Set(values.map(v=>v.role)).size!==6)throw Error('ACCOUNTS_INVALID');
 for(const v of values)if(typeof v.username!=='string'||typeof v.displayName!=='string'||typeof v.password!=='string'||v.password.length<32||!allowed.has(v.role))throw Error('ACCOUNTS_INVALID');
 return values;
};
async function ensureLogin(db:Pool,login:'nipt_web'|'nipt_worker',group:'app_rw'|'worker_rw',passwordFile:string){
 const password=await secret(passwordFile);if(password.length<24)throw Error('DATABASE_PASSWORD_TOO_SHORT');
 if(!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[login])).rowCount)await db.query(`CREATE ROLE ${escapeIdentifier(login)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${escapeLiteral(password)}`);
 else await db.query(`ALTER ROLE ${escapeIdentifier(login)} PASSWORD ${escapeLiteral(password)}`);
 await db.query(`GRANT ${escapeIdentifier(group)} TO ${escapeIdentifier(login)}`);
 if(login==='nipt_worker')await db.query(`GRANT CREATE ON DATABASE ${escapeIdentifier(database)} TO nipt_worker`);
}
async function seedAccounts(db:Pool,values:Account[]){
 const ids:Record<string,string>={};
 for(const a of values){
  const existing=await db.query<{id:string}>('SELECT id FROM app_user WHERE username=$1',[a.username]);
  ids[a.username]=existing.rows[0]?.id??(await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[a.username,a.displayName,await hashPassword(a.password)])).rows[0].id;
 }
 const approver=ids['uat.clinical-approver'];
 for(const a of values)await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ids[a.username],a.role,a.role==='LAB_CERTIFIER'?approver:null]);
 const unit=(await db.query<{id:string}>('INSERT INTO unit(code,name) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET code=excluded.code RETURNING id',['INSTALL_TEST','Installed test unit'])).rows[0].id;
 await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ids['uat.anc'],unit]);
}

if(phase==='install'){
 // The database is created from the maintenance database with the migration owner's credentials.
 const maintenance=new URL(migrationUrl);maintenance.pathname='/postgres';
 const admin=new Pool({connectionString:maintenance.toString()});
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)await admin.query(`CREATE DATABASE ${escapeIdentifier(database)}`);}finally{await admin.end();}
}
const db=new Pool({connectionString:migrationUrl});
try{
 const client=await db.connect();
 try{await migrate(client);if(phase==='install')await configureOperational(client);await assertDatabaseMode(client);}finally{client.release();}
 const boss=new PgBoss(migrationUrl);await boss.start();await boss.stop();
 await db.query(await readFile('packages/db/roles.sql','utf8'));
 await db.query(await readFile('packages/p6/grants.sql','utf8'));
 await ensureLogin(db,'nipt_web','app_rw','web-password');
 await ensureLogin(db,'nipt_worker','worker_rw','worker-password');
 await db.query('GRANT USAGE ON SCHEMA pgboss TO worker_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO worker_rw; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO worker_rw');
 await db.query('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');
 if(phase==='install')await seedAccounts(db,accountsOf(await secret('uat-accounts.json')));
 const ledger=(await db.query<{name:string}>('SELECT name FROM schema_migration ORDER BY name')).rows;
 process.stdout.write(JSON.stringify({phase,database,migrations:ledger.length,last:ledger.at(-1)?.name,accounts:phase==='install'?6:undefined})+'\n');
}finally{await db.end();}
