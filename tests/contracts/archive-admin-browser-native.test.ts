import {it,expect} from 'vitest';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {chromium} from 'playwright';
import {expect as pwExpect} from '@playwright/test';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {runArchiveProbeCycle} from '../../packages/results/archive-worker';

async function availablePort(){
 const socket=net.createServer();
 await new Promise<void>((ok,no)=>socket.once('error',no).listen(0,'127.0.0.1',()=>ok()));
 const port=(socket.address() as net.AddressInfo).port;
 await new Promise<void>(ok=>socket.close(()=>ok()));
 return port;
}

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('real browser Admin NAS Settings, KPI/Audit and LAB forbidden on isolated native PostgreSQL',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const repo=process.cwd(),base=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-browser-synthetic-'));
 const archive=path.join(base,'archive'),port=await availablePort(),origin=`http://127.0.0.1:${port}`;
 const owner=new Client({connectionString:url});await owner.connect();
 let web:ReturnType<typeof spawn>|null=null,worker:Client|null=null,browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  // Web truly runs with inherited app_rw permissions, not the database owner.
  await owner.query('CREATE ROLE nipt_synthetic_browser_app LOGIN INHERIT');
  await owner.query('GRANT app_rw TO nipt_synthetic_browser_app');
  const webUrl=new URL(url);webUrl.username='nipt_synthetic_browser_app';webUrl.password='';
  await mkdir(archive);await mkdir(path.join(base,'data/files'),{recursive:true});
  const loader=pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href;
  execFileSync(process.execPath,['--import',loader,path.join(repo,'tools/init-dev.ts')],{
   cwd:base,windowsHide:true,stdio:'ignore',timeout:30000
  });
  const keys=(s:string)=>path.join(base,'data/keys',s);
  const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:webUrl.toString(),APP_ORIGIN:origin,E2E_BASE_URL:origin,
   HOSTNAME:'127.0.0.1',PORT:String(port),FILE_STORE_ROOT:path.join(base,'data/files'),
   SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:'http://127.0.0.1:63334',
   RENDERER_TOKEN_FILE:keys('renderer-token'),
   INTEGRATION_PUBLIC_KEY_FILE:keys('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:keys('integration-private.pem'),
   IDENTITY_ENCRYPTION_KEY_FILE:keys('identity.key'),IDENTITY_LOOKUP_KEY_FILE:keys('lookup.key'),
   BACKUP_KEY_FILE:keys('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password'),
  };
  await mkdir(path.join(base,'data/simulator/inbound'),{recursive:true});
  await mkdir(path.join(base,'data/simulator/results'),{recursive:true});
  await writeFile(path.join(base,'data/simulator/.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
  execFileSync(process.execPath,['--import','tsx','tools/seed.ts'],{
   cwd:repo,env:{...env,DATABASE_URL:url},windowsHide:true,stdio:'ignore',timeout:45000
  });
  await cp(path.join(repo,'public'),path.join(repo,'.next/standalone/public'),{recursive:true});
  await cp(path.join(repo,'.next/static'),path.join(repo,'.next/standalone/.next/static'),{recursive:true});
  const webLog=await import('node:fs');
  const log=webLog.openSync(path.join(base,'web.log'),'a');
  web=spawn(process.execPath,['.next/standalone/server.js'],{
   cwd:repo,env,windowsHide:true,stdio:['ignore',log,log]
  });webLog.closeSync(log);
  let ready=false;for(let i=0;i<100;i++){
   ready=await fetch(origin+'/login').then(x=>x.status===200).catch(()=>false);
   if(ready)break;
   if(web.exitCode!==null)break;
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  expect(ready).toBe(true);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({baseURL:origin});
  const login=async(username:string)=>{
   await page.goto('/login');
   await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(username);
   await page.getByLabel('รหัสผ่าน',{exact:true}).fill((await readFile(env.SYNTHETIC_SEED_PASSWORD_FILE,'utf8')).trim());
   await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
   await pwExpect(page).toHaveURL(/\/$/,{timeout:12000});
  };
  await login('synthetic.admin');
  await page.goto('/settings');
  await pwExpect(page.getByRole('heading',{name:'NAS PDF Archive'})).toBeVisible();
  await page.getByLabel('NAS UNC Path').fill(archive);
  await page.getByRole('button',{name:'Test Connection'}).click();
  await pwExpect(page.getByText('ส่งคำขอทดสอบไปยัง Worker แล้ว')).toBeVisible();
  worker=new Client({connectionString:url});await worker.connect();await worker.query('SET ROLE worker_rw');
  await runArchiveProbeCycle(worker);
  await pwExpect(page.getByText(/ผลทดสอบ: PASSED/)).toBeVisible({timeout:12000});
  await page.getByRole('button',{name:'Save & Enable'}).click();
  await pwExpect(page.getByText('เปิดใช้งานแล้ว',{exact:false}).first()).toBeVisible();
  await page.goto('/settings/operations');
  await pwExpect(page.getByRole('heading',{name:'งานผิดพลาดและสถิติระบบ'})).toBeVisible();
  await pwExpect(page.getByRole('heading',{name:/PDF Access Audit/})).toBeVisible();
  const lab=await browser.newContext({baseURL:origin});
  const labPage=await lab.newPage();
  try{
   await labPage.goto('/login');
   await labPage.getByLabel('ชื่อผู้ใช้',{exact:true}).fill('synthetic.lab');
   await labPage.getByLabel('รหัสผ่าน',{exact:true}).fill((await readFile(env.SYNTHETIC_SEED_PASSWORD_FILE,'utf8')).trim());
   await labPage.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
   await pwExpect(labPage).toHaveURL(/\/$/,{timeout:12000});
   const denied=await lab.request.get('/api/settings/pdf-archive');
   expect(denied.status()).toBe(403);
   expect(await denied.text()).not.toContain(archive);
   await labPage.goto('/settings/operations');
   await pwExpect(labPage).toHaveURL(/\/$/);
  }finally{await lab.close();}
  await page.goto('/settings');
  await page.getByRole('button',{name:'ปิดใช้งาน'}).click();
  await pwExpect(page.getByText('ปิดใช้งานแล้ว',{exact:false}).first()).toBeVisible();
 }finally{
  await browser?.close().catch(()=>{});
  await worker?.end().catch(()=>{});
  if(web){web.kill();await Promise.race([new Promise<void>(ok=>web!.once('exit',()=>ok())),new Promise(ok=>setTimeout(ok,2000))]);}
  await owner.end();
  if(path.basename(base).startsWith('nipt-archive-browser-synthetic-'))await rm(base,{recursive:true,force:true});
 }
},120000);
