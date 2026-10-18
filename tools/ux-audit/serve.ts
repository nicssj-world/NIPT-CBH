// Local synthetic runtime for the project-wide UX audit (tools/integration-e2e/e2e.ts environment, long-running).
// Serves the built standalone app on loopback 19928 (renderer 19930) against a reserved synthetic browser database that
// was cloned from an e2e run (NIPT_UX_AUDIT_DB_URL). Synthetic mode only; never a real, operational or shared database.
import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const repo=process.cwd(),base=path.resolve('.local/ux-audit'),data=path.join(base,'data');
const url=process.env.NIPT_UX_AUDIT_DB_URL??'';
if(!/^postgres(ql)?:\/\/[^@]+@127\.0\.0\.1:\d+\/nipt_synthetic_p2_browser_[a-z0-9_]+$/.test(url))throw Error('RESERVED_LOOPBACK_SYNTHETIC_DATABASE_REQUIRED');
const origin='http://127.0.0.1:19928',key=(n:string)=>path.join(data,'keys',n);
const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,APP_ORIGIN:origin,HOSTNAME:'127.0.0.1',PORT:'19928',
 FILE_STORE_ROOT:path.join(data,'files'),SIMULATOR_ROOT:path.join(data,'simulator'),RENDERER_URL:'http://127.0.0.1:19930',RENDERER_PORT:'19930',
 RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),
 IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),
 SYNTHETIC_SEED_PASSWORD_FILE:path.join(data,'secrets/seed-password'),RUN_PHOTO_DEFAULT_ROOT:path.join(data,'photos/default'),RUN_PHOTO_STORAGE_TIMEOUT_MS:'4000',
 NIPT_HIS_SHARE_POLICY_FILE:path.join(data,'his-share-policy.json'),NIPT_P6_SANDBOX_ENABLED:'yes',NIPT_ANC_FORM_REGISTRY:path.join(data,'forms-registry.json'),
 NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx'};
await fs.cp(path.join(repo,'public'),path.join(repo,'.next/standalone/public'),{recursive:true});
await fs.cp(path.join(repo,'.next/static'),path.join(repo,'.next/standalone/.next/static'),{recursive:true});
const children=[['renderer',['--import','tsx','apps/renderer/main.ts']],['worker',['--import','tsx','apps/worker/main.ts']],['web',['.next/standalone/server.js']]].map(([label,args])=>{
 const c=spawn(process.execPath,args as string[],{cwd:repo,env,windowsHide:true,stdio:'inherit'});c.on('exit',code=>{console.error(`[ux-audit] ${label} exited ${code}`);process.exit(1);});return c;});
const stop=()=>{for(const c of children)c.kill();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log(`[ux-audit] ${origin}`);
