import {Pool} from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
import type {Principal} from '../../packages/security/policy';
const url=new URL((await readFile('.local/ux-v2/secrets/migration-url','utf8')).trim());
if(url.hostname!=='db'||url.pathname!=='/nipt_operational_ux_v2_local')throw Error('UX_RUNTIME_TARGET_REQUIRED');
url.hostname='127.0.0.1';url.port='19519';
const db=new Pool({connectionString:url.toString()});
try {
 const user=async(username:string):Promise<Principal>=>{const r=await db.query('select u.id,a.role from app_user u join role_assignment a on a.user_id=u.id where u.username=$1',[username]);return {id:r.rows[0].id,roles:r.rows.map(v=>v.role),unitIds:[],permissions:[]};};
 const maker=await user('uat.admin'),checker=await user('uat.clinical-approver');
 for(const key of ['his_inbound','his_outbound'] as const){const client=await db.connect();try{await client.query('BEGIN');const id=await proposeSetting(client,maker,key,SETTINGS[key].default,'Restore HIS-disabled UX-only local synthetic runtime');await validateSetting(client,maker,id,async(_,value)=>{const v=value as {enabled:boolean;productionAuthorized?:boolean};return v.enabled===false&&v.productionAuthorized!==true;});await approveSetting(client,checker,id);await activateSetting(client,checker,id);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 await writeFile(path.resolve('.local/ux-v2/integration/share-policy.json'),JSON.stringify({version:1,grants:[]}));
 const result=await db.query("select a.setting_key,r.value from setting_active a join settings_revision r on r.id=a.revision_id where a.setting_key in ('his_inbound','his_outbound')");
 console.log(JSON.stringify(result.rows));
}finally{await db.end();}
