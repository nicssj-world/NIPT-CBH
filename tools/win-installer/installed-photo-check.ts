/** Run Photo Evidence check against an INSTALLED instance (test data only): upload a synthetic JPEG through the real HTTPS API as a Lab
 *  account, and later fetch the original and compare its SHA-256. Used by the rehearsal before and after a restore/activation.
 *    tsx tools/win-installer/installed-photo-check.ts upload --root <install root> --out <state.json>
 *    tsx tools/win-installer/installed-photo-check.ts fetch  --root <install root> --state <state.json>
 *  Photo upload is optional in the product and never gates Lab work; this tool only proves storage, backup and restore of the evidence files. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Pool} from 'pg';
import {chromium} from '@playwright/test';
import {layout} from './lib.mjs';

const [mode]=process.argv.slice(2);
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const root=arg('root');if(!root||!['upload','fetch'].includes(mode))throw Error('USAGE');
const L=layout(root);
const config=JSON.parse(await readFile(L.configFile,'utf8')) as {origin:string;testEnvironmentOnly:boolean};
if(config.testEnvironmentOnly!==true)throw Error('INSTALLED_TEST_ENVIRONMENT_REQUIRED');
const accounts=JSON.parse(await readFile(path.join(L.secrets,'uat-accounts.json'),'utf8')) as {username:string;password:string}[];
const lab=accounts.find(a=>a.username==='uat.lab')!;
/** A structurally valid baseline JPEG header (SOI, APP0, SOF0, SOS) followed by random bytes. Synthetic only. */
const syntheticJpeg=(w=1600,h=1200,body=8192)=>{
 const app0=Buffer.from([0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00]);
 const sof=Buffer.from([0xff,0xc0,0x00,0x11,0x08,h>>8,h&255,w>>8,w&255,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01]);
 return Buffer.concat([Buffer.from([0xff,0xd8]),app0,sof,Buffer.from([0xff,0xda,0x00,0x08]),randomBytes(body),Buffer.from([0xff,0xd9])]);
};
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({baseURL:config.origin,ignoreHTTPSErrors:true});const page=await context.newPage();
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(lab.username);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(lab.password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'));
 const csrf=(await context.cookies()).find(c=>c.name==='nipt_csrf')?.value??'';
 if(mode==='upload'){
  const db=new Pool({connectionString:(await readFile(path.join(L.secrets,'migration-url'),'utf8')).trim()});
  let batchId:string;try{batchId=(await db.query<{id:string}>("SELECT id FROM lab_batch ORDER BY created_at DESC LIMIT 1")).rows[0].id;}finally{await db.end();}
  const bytes=syntheticJpeg(),thumb=syntheticJpeg(480,360,512);
  const meta={batchId,idempotencyKey:randomUUID().replaceAll('-',''),caption:'installer rehearsal synthetic photo',sampleFrom:1,sampleTo:2,takenOn:new Date(Date.now()+7*3600000).toISOString().slice(0,10)};
  const res=await context.request.post('/api/run-photos/upload',{headers:{'x-csrf-token':csrf,origin:config.origin},multipart:{file:{name:'IMG_REHEARSAL.jpg',mimeType:'image/jpeg',buffer:bytes},thumb:{name:'thumb.jpg',mimeType:'image/jpeg',buffer:thumb},meta:JSON.stringify(meta)}});
  const body=await res.json() as {photoId?:string;sha256?:string;error?:string};
  if(res.status()!==201||!body.photoId||!body.sha256)throw Error('UPLOAD_FAILED_'+res.status()+'_'+JSON.stringify(body).slice(0,200));
  const expected=createHash('sha256').update(bytes).digest('hex');if(body.sha256!==expected)throw Error('UPLOAD_HASH_MISMATCH');
  const state={photoId:body.photoId,sha256:expected,batchId,bytes:bytes.length};
  const out=arg('out');if(out)await writeFile(out,JSON.stringify(state,null,2));process.stdout.write(JSON.stringify(state)+'\n');
 }else{
  const state=JSON.parse(await readFile(arg('state')??'','utf8')) as {photoId:string;sha256:string};
  const res=await context.request.get(`/api/run-photos/${state.photoId}/file?variant=original`);
  if(res.status()!==200)throw Error('FETCH_FAILED_'+res.status());
  const got=createHash('sha256').update(await res.body()).digest('hex');
  if(got!==state.sha256)throw Error('PHOTO_HASH_MISMATCH');
  process.stdout.write(JSON.stringify({photoId:state.photoId,sha256:got,verified:true})+'\n');
 }
}finally{await browser.close();}
