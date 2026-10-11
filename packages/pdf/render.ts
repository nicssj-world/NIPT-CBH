import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {FileStore} from '../storage';
import type {Queryable} from '../db/connection';
import {TEMPLATE_VERSION,snapshotSchema,type FoundationSnapshot} from './template';
export {TEMPLATE_VERSION,snapshotSchema} from './template';
export type {FoundationSnapshot} from './template';
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function renderFoundationPdf(input:FoundationSnapshot){const s=snapshotSchema.parse(input);const font=await readFile(path.resolve('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2'));const browser=await chromium.launch({headless:true,args:process.env.CHROMIUM_NO_SANDBOX==="true"?["--no-sandbox"]:[]});try{const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',route=>route.abort());await page.setContent(`<html><head><meta charset="utf-8"><style>@font-face{font-family:Thai;src:url(data:font/woff2;base64,${font.toString('base64')})}body{font-family:Thai,sans-serif}h1{font-size:24px}</style></head><body><h1>เอกสารทดสอบสังเคราะห์ NIPT CBH</h1><p>SYNTHETIC ONLY — NOT A CLINICAL REPORT</p><p>${escape(s.reference)}</p><p>${escape(s.label)}</p><p>${TEMPLATE_VERSION}</p></body></html>`,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);return await page.pdf({format:'A4',printBackground:true});}finally{await browser.close();}}
export async function cachePreview(db:Queryable,store:FileStore,sessionId:string,snapshot:FoundationSnapshot){const bytes=await renderFoundationPdf(snapshot);const hash=await store.put(bytes);const r=await db.query<{id:string}>("INSERT INTO pdf_preview_cache(session_id,asset_hash,template_version,expires_at) SELECT id,$2,$3,now()+interval '15 minutes' FROM app_session WHERE id=$1 AND revoked_at IS NULL AND absolute_expires_at>now() AND idle_expires_at>now() RETURNING id",[sessionId,hash,TEMPLATE_VERSION]);if(!r.rows[0])throw Error('SESSION_REQUIRED');return {id:r.rows[0].id,hash,bytes};}
export async function readPreview(db:Queryable,store:FileStore,id:string,sessionId:string){const r=await db.query<{asset_hash:string}>("SELECT p.asset_hash FROM pdf_preview_cache p JOIN app_session s ON s.id=p.session_id WHERE p.id=$1 AND p.session_id=$2 AND p.expires_at>now() AND s.revoked_at IS NULL AND s.absolute_expires_at>now() AND s.idle_expires_at>now()",[id,sessionId]);if(!r.rows[0])throw Error('PREVIEW_NOT_AUTHORIZED');return store.get(r.rows[0].asset_hash);}

