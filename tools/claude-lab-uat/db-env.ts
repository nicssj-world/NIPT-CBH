// Isolated synthetic runtime DB access for diagnostics/tests (port 20229 only; refuses anything else).
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
const base='.local/claude-lab-uat-runtime';
export const secret=(n:string)=>readFileSync(`${base}/secrets/${n}`,'utf8').trim();
export const isolatedUrl=(role:'migrator'|'web'='web')=>role==='web'?`postgresql://nipt_web:${encodeURIComponent(secret('web-password'))}@127.0.0.1:20229/nipt_task3_integrated_owner_uat`:`postgresql://nipt_migrator:${encodeURIComponent(secret('db-password'))}@127.0.0.1:20229/nipt_task3_integrated_owner_uat`;
export async function client(role:'migrator'|'web'='web'){const c=new Client({connectionString:isolatedUrl(role)});await c.connect();return c;}
export function setEnv(){Object.assign(process.env,{NIPT_MODE:'operational',IDENTITY_ENCRYPTION_KEY_FILE:`${base}/keys/identity.key`,IDENTITY_LOOKUP_KEY_FILE:`${base}/keys/lookup.key`,FILE_STORE_ROOT:`${base}/data/files`,NIPT_TASK_MASTER_PATH:`${base}/approved/master.xlsx`,NIPT_POOL_CSV_TEMPLATE:`${base}/approved/pooling.csv`});}
