import {test,expect,type Page,type Browser} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {rename,readdir,mkdir} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {tx,setPendingPolicy,syntheticCase,receiveS1} from "../helpers/lab";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

// Run Photo Evidence. Synthetic data in the isolated run-photos browser database only (tools/run-photos-e2e/e2e.ts).
test.describe.configure({mode:"serial"});
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).not.toHaveURL(/\/login/);
}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
const q=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>{const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{return (await db.query<T>(sql,params)).rows;}finally{await db.end();}};
const shot=(page:Page,name:string)=>process.env.NIPT_E2E_SCREEN_DIR?page.screenshot({path:path.join(process.env.NIPT_E2E_SCREEN_DIR,name+".png"),fullPage:true}):Promise.resolve(Buffer.alloc(0));
const photoRoot=(name:string)=>path.join(process.env.NIPT_E2E_PHOTO_ROOT??".local/run-photos-e2e/data/photos",name);
async function labPost(page:Page,url:string,body:unknown){
 const token=(await page.context().cookies()).find(c=>c.name==="nipt_csrf")?.value??"";
 return page.request.post(url,{headers:{origin:new URL(page.url()).origin,"x-csrf-token":token,"content-type":"application/json"},data:body});
}
/** A Run with `count` received synthetic samples placed from slot 2 (slot 1 is the positive control). */
async function runWithSamples(page:Page,count:number){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const qq=db as unknown as Queryable;let cases;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const p=(i:string,role:string)=>({id:i,roles:[role],unitIds:[],permissions:[]}) as unknown as Principal;
  const staff=p(await id("synthetic.lab"),"LAB_STAFF"),certifier=p(await id("synthetic.certifier"),"LAB_CERTIFIER"),approver=p(await id("synthetic.approver"),"CLINICAL_APPROVER");
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const active=(await db.query<{v:string|null}>("SELECT r.value->>'pendingGovernanceGate' v FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='laboratory'")).rows[0]?.v;
  if(active!=="PROCEED_SYNTHETIC_LABELLED")await setPendingPolicy(qq,{certifier,approver},"PROCEED_SYNTHETIC_LABELLED");
  cases=[];for(let i=0;i<count;i++){const c=await tx(qq,t=>syntheticCase(t,{staff,unit}));await tx(qq,t=>receiveS1(t,c,new Date(Date.now()-(count-i)*60000)));cases.push(c);}
 }finally{await db.end();}
 await q("UPDATE lab_batch SET state='Cancelled',cancelled_by=(SELECT id FROM app_user WHERE username='synthetic.lab'),cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'");
 const r=await labPost(page,"/api/p4/batches",{});expect(r.ok(),await r.text()).toBe(true);const batchId=(await r.json()).batchId as string;
 const attempts=(await q<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)])).map(x=>x.id);
 const v=(await q<{version:number}>("SELECT version FROM lab_batch WHERE id=$1",[batchId]))[0].version;
 const a=await labPost(page,`/api/p4/batches/${batchId}`,{action:"assign",expectedVersion:v,attemptIds:attempts,queueOverrideReason:"จำลอง ตัวอย่างสำหรับทดสอบภาพประจำ Run"});expect(a.ok(),await a.text()).toBe(true);
 const runLabel=(await q<{run_label:string}>("SELECT run_label FROM lab_batch WHERE id=$1",[batchId]))[0].run_label;
 const lns=await q<{ln:string;ln_halos:string}>("SELECT l.ln,n.ln_halos FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id JOIN specimen_lab_number n ON n.round_id=r.id WHERE r.id=ANY($1::uuid[]) ORDER BY r.received_at",[cases.map(c=>c.roundId)]);
 return {batchId,runLabel,lns};
}
/** Real, browser-decodable JPEGs drawn on a canvas (synthetic rack + label text); `noise` makes a large phone-size file. */
async function jpeg(page:Page,label:string,o:{width?:number;height?:number;noise?:boolean;quality?:number}={}){
 const b64=await page.evaluate(async({label,width,height,noise,quality})=>{
  const c=document.createElement("canvas");c.width=width;c.height=height;const x=c.getContext("2d")!;
  if(noise){const img=x.createImageData(width,height);const a=new Uint32Array(img.data.buffer);for(let i=0;i<a.length;i++)a[i]=(Math.random()*0xffffffff)|0xff000000;x.putImageData(img,0,0);}
  else{x.fillStyle="#dfe7ee";x.fillRect(0,0,width,height);for(let i=0;i<10;i++){x.fillStyle=i%2?"#7a2e3a":"#9b3443";x.fillRect(120+i*(width-240)/10,height*.25,(width-240)/14,height*.55);}}
  x.fillStyle="#102a43";x.font=`${Math.round(height/12)}px sans-serif`;x.fillText(label,60,height*.15);
  const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),"image/jpeg",quality));const buf=new Uint8Array(await blob.arrayBuffer());let s="";for(let i=0;i<buf.length;i+=32768)s+=String.fromCharCode(...buf.subarray(i,i+32768));return btoa(s);
 },{label,width:o.width??1600,height:o.height??1200,noise:o.noise??false,quality:o.quality??.9});
 return {name:`SYNTHETIC-${label.replace(/\W+/g,"-")}.jpg`,mimeType:"image/jpeg",buffer:Buffer.from(b64,"base64")};
}
const uploadInput=(page:Page,camera=false)=>({setInputFiles:async(files:Parameters<ReturnType<Page["locator"]>["setInputFiles"]>[0])=>{await page.waitForLoadState("networkidle");await page.locator(camera?'input[type="file"][capture]':'input[type="file"][multiple]').setInputFiles(files);}});

let run:{batchId:string;runLabel:string;lns:{ln:string;ln_halos:string}[]};
let firstPhotoId="";

test("a Run without photos works normally and only offers an optional link",async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 run=await runWithSamples(page,12);
 await page.goto(`/lab/batches/${run.batchId}`);
 await expect(page.getByRole("link",{name:"ภาพประจำ Run (0 ภาพ)"})).toBeVisible();
 await expect(page.getByRole("tab",{name:/^Task List 1/})).toBeVisible();
 await expect(page.getByRole("dialog")).toHaveCount(0); // no "no photos" prompt
 await expect(page.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"ภาพประจำ Run"})).toBeVisible();
 await page.getByRole("link",{name:"ภาพประจำ Run (0 ภาพ)"}).click();
 await expect(page.getByRole("heading",{level:1,name:`ภาพประจำ ${run.runLabel}`})).toBeVisible();
 await expect(page.getByText("ยังไม่มีภาพของ Run นี้")).toBeVisible();
 await axe(page);
});

test("desktop: upload several photos with a sample range, view the full original, edit, duplicate refused",async({page})=>{
 test.setTimeout(180000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 await page.goto(`/lab/photos/${run.batchId}`);
 const files=[await jpeg(page,"RACK TASK1 1-10"),await jpeg(page,"RACK TASK1 LABELS"),await jpeg(page,"PHONE 12MP",{width:4000,height:3000,noise:true,quality:.97})];
 expect(files[2].buffer.length).toBeGreaterThan(10*1024*1024); // above the proxy's 10 MB body buffer
 await uploadInput(page).setInputFiles(files);
 await expect(page.getByText("พร้อมอัปโหลด",{exact:true})).toHaveCount(3);
 await page.getByLabel("ตั้งแต่คนที่").fill("1");await page.getByLabel("ถึงคนที่").fill("10");
 await expect(page.getByText("ตำแหน่ง 2–11 · 10 ตัวอย่างตามการจัดวางปัจจุบัน")).toBeVisible();
 await page.getByLabel("คำอธิบายภาพ").fill("Task 1 ชั้นวางหลอด คนที่ 1-10");
 await expect(page.getByText(/Run นี้ยังแก้ตำแหน่งได้/)).toBeVisible();
 await shot(page,"01-desktop-upload-staged");
 await page.getByRole("button",{name:"อัปโหลด 3 ภาพ"}).click();
 await expect(page.getByRole("status").filter({hasText:"อัปโหลดแล้ว 3 ภาพ"})).toBeVisible({timeout:60000});
 await expect(page.locator(".photo-grid > li")).toHaveCount(3);
 await expect(page.getByText(/คนที่ 1–10 · ตน\. 2–11/).first()).toBeVisible();
 const rows=await q<{id:string;byte_size:string;sha256:string;uploaded_by:string;thumb_sha256:string|null}>("SELECT p.id,p.byte_size::text,p.sha256,u.username uploaded_by,p.thumb_sha256 FROM run_photo p JOIN app_user u ON u.id=p.uploaded_by WHERE batch_id=$1 ORDER BY p.byte_size DESC",[run.batchId]);
 expect(rows).toHaveLength(3);expect(Number(rows[0].byte_size)).toBe(files[2].buffer.length);expect(rows.every(r=>r.uploaded_by==="synthetic.lab"&&r.thumb_sha256)).toBe(true);
 firstPhotoId=rows[0].id;
 // Thumbnails are small; the original is byte-identical and full resolution.
 const thumb=await page.request.get(`/api/run-photos/${rows[0].id}/file?variant=thumb`);expect(thumb.status()).toBe(200);expect((await thumb.body()).length).toBeLessThan(512*1024);
 const original=await page.request.get(`/api/run-photos/${rows[0].id}/file`);expect(original.status()).toBe(200);
 expect(Buffer.compare(await original.body(),files[2].buffer)).toBe(0);
 expect(original.headers()["cache-control"]).toContain("no-store");expect(original.headers()["x-content-type-options"]).toBe("nosniff");
 await shot(page,"02-desktop-gallery");
 await page.locator(".photo-thumb").first().click();
 const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 await expect(dialog.locator('.photo-stage img[alt]:not([aria-hidden])')).toBeVisible({timeout:30000});
 expect(await dialog.locator('.photo-stage img[alt]:not([aria-hidden])').evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(1000);
 await expect(dialog.getByText("ตัวอย่างในช่วงที่ระบุ")).toBeVisible();
 await expect(dialog.locator(".photo-samples li")).toHaveCount(10);
 await shot(page,"03-desktop-viewer");
 await axe(page);
 await page.keyboard.press("ArrowRight");await expect(dialog.getByRole("heading",{name:"ภาพที่ 2 จาก 3"})).toBeVisible();
 await dialog.getByText("แก้ไขคำอธิบาย ช่วงตัวอย่าง หรือวันที่").click();
 await dialog.getByLabel("คำอธิบายภาพ").fill("Task 1 ฉลากหลอด คนที่ 11-12");
 await dialog.getByLabel("ตั้งแต่คนที่").fill("11");await dialog.getByLabel("ถึงคนที่").fill("12");
 await dialog.getByRole("button",{name:"บันทึกการแก้ไข"}).click();
 await expect(page.getByRole("status").filter({hasText:"บันทึกการแก้ไขแล้ว"})).toBeVisible();
 await expect(page.getByText("Task 1 ฉลากหลอด คนที่ 11-12")).toBeVisible();
 // The same bytes again in the same Run: refused with an explanation, nothing stored twice.
 await uploadInput(page).setInputFiles([files[0]]);
 await page.getByRole("button",{name:"อัปโหลด 1 ภาพ"}).click();
 await expect(page.getByText(/มีอยู่แล้วใน Run นี้/).first()).toBeVisible({timeout:30000});
 expect((await q("SELECT 1 FROM run_photo WHERE batch_id=$1",[run.batchId])).length).toBe(3);
 await page.goto(`/lab/batches/${run.batchId}`);await expect(page.getByRole("link",{name:"ภาพประจำ Run (3 ภาพ)"})).toBeVisible();
});

test("mobile: take a photo with the camera input, browse and open it on a phone-size screen",async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:390,height:844});await login(page,"synthetic.lab");
 await page.goto(`/lab/photos/${run.batchId}`);
 await expect(page.getByText("ถ่ายภาพด้วยกล้อง")).toBeVisible();
 await uploadInput(page,true).setInputFiles([await jpeg(page,"MOBILE CAMERA",{width:3024,height:4032})]);
 await page.getByRole("button",{name:"อัปโหลด 1 ภาพ"}).click();
 await expect(page.getByRole("status").filter({hasText:"อัปโหลดแล้ว 1 ภาพ"})).toBeVisible({timeout:60000});
 await expect(page.locator(".photo-grid > li")).toHaveCount(4);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await shot(page,"04-mobile-gallery");
 await page.locator(".photo-thumb").first().click();
 await expect(page.getByRole("dialog").locator('.photo-stage img[alt]:not([aria-hidden])')).toBeVisible({timeout:30000});
 await shot(page,"05-mobile-viewer");
 await page.getByRole("dialog").getByRole("button",{name:"ปิด"}).click();await expect(page.getByRole("dialog")).toBeHidden();
});

test("search by Run, date, LN Halos, LN HIS, sample order and caption; LN stays out of the URL",async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 await page.goto("/lab/photos");
 await expect(page.getByRole("heading",{name:"Run ล่าสุด"})).toBeVisible();
 await expect(page.locator(".photo-run-list > li").filter({hasText:run.runLabel}).getByText("4 ภาพ",{exact:false})).toBeVisible();
 const target=run.lns[10]; // sample 11, slot 12
 await page.getByLabel("LN HIS").fill(target.ln);await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.getByText(`พบตัวอย่างนี้ใน 1 Run`)).toBeVisible();
 await expect(page.locator(".ln-hit")).toContainText(`${run.runLabel} · คนที่ 11 (ตำแหน่ง 12)`);
 await expect(page.locator(".photo-chip.covers")).toHaveCount(1);
 await expect(page.locator(".photo-chip.covers")).toContainText("ครอบคลุมคนที่ 11");
 expect(page.url()).not.toContain(target.ln);
 await shot(page,"06-search-ln");
 await axe(page);
 await page.getByRole("button",{name:"ล้างเงื่อนไข"}).click();
 await page.getByLabel("LN Halos").fill(target.ln_halos);await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.locator(".ln-hit")).toContainText("คนที่ 11");expect(page.url()).not.toContain(target.ln_halos);
 await page.getByRole("button",{name:"ล้างเงื่อนไข"}).click();
 await page.getByLabel("Run",{exact:true}).fill(run.runLabel);await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.getByRole("heading",{name:/ผลการค้นหา · 1 Run · 4 ภาพ/})).toBeVisible();
 await page.getByRole("button",{name:"ล้างเงื่อนไข"}).click();
 await page.getByLabel(/ลำดับตัวอย่างใน Run/).fill("5");await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.getByRole("heading",{name:/ผลการค้นหา · 1 Run · 2 ภาพ/})).toBeVisible();
 await page.getByRole("button",{name:"ล้างเงื่อนไข"}).click();
 await page.getByLabel("ข้อความในคำอธิบายภาพ").fill("11-12");await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.getByRole("heading",{name:/ผลการค้นหา · 1 Run · 1 ภาพ/})).toBeVisible();
 await page.getByRole("button",{name:"ล้างเงื่อนไข"}).click();
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok"}).format(new Date()).split("-");
 await page.getByLabel("วันที่ Run หรือวันที่ถ่ายภาพ").fill(`${today[2]}/${today[1]}/${Number(today[0])+543}`);await page.getByLabel("วันที่ Run หรือวันที่ถ่ายภาพ").blur();
 await page.getByRole("button",{name:"ค้นหา",exact:true}).click();
 await expect(page.locator(".photo-run-list > li").filter({hasText:run.runLabel})).toBeVisible();
});

async function anonymous(browser:Browser,url:string){const ctx=await browser.newContext();try{return (await ctx.request.get(url)).status();}finally{await ctx.close();}}
test("photos never leave through an unauthenticated or unauthorized request",async({page,browser})=>{
 expect(await anonymous(browser,`${process.env.E2E_BASE_URL}/api/run-photos/${firstPhotoId}/file`)).toBe(401);
 expect(await anonymous(browser,`${process.env.E2E_BASE_URL}/api/run-photos/${firstPhotoId}/file?variant=thumb`)).toBe(401);
 for(const user of ["synthetic.anc","synthetic.admin","synthetic.approver"]){
  await login(page,user);
  expect((await page.request.get(`/api/run-photos/${firstPhotoId}/file`)).status(),user).toBe(403);
  expect((await page.request.get(`/api/run-photos/runs/${run.batchId}`)).status(),user).toBe(403);
  await page.goto(`/lab/photos/${run.batchId}`);await expect(page.getByRole("alert").filter({hasText:"ไม่มีสิทธิ์"})).toBeVisible();
  await page.context().clearCookies();
 }
 // No static or public path exposes the files.
 const sha=(await q<{sha256:string}>("SELECT sha256 FROM run_photo WHERE id=$1",[firstPhotoId]))[0].sha256;
 for(const p of [`/run-photos/${sha}`,`/sha256/${sha.slice(0,2)}/${sha.slice(2,4)}/${sha}`,`/api/run-photos/../../${sha}`])expect(await anonymous(browser,`${process.env.E2E_BASE_URL}${p}`)).not.toBe(200);
 await login(page,"synthetic.auditor");expect((await page.request.get(`/api/run-photos/${firstPhotoId}/file`)).status()).toBe(200);
});

test("admin changes the Storage Path: tested as the storing account, new photos go there, old photos still open",async({page})=>{
 test.setTimeout(150000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.admin");
 await page.goto("/settings/run-photos");
 await expect(page.getByRole("heading",{name:"ที่เก็บภาพที่ใช้งานอยู่"})).toBeVisible();
 await expect(page.getByText("ค่าเริ่มต้นของการติดตั้ง").first()).toBeVisible();
 await page.getByLabel("Path ใหม่").fill(photoRoot("not-created"));await page.getByRole("button",{name:"ทดสอบการเข้าถึง"}).click();
 await expect(page.getByText("ทดสอบไม่ผ่าน — ยังใช้ Path นี้ไม่ได้")).toBeVisible();
 await expect(page.getByRole("button",{name:"บันทึกและใช้ Path นี้"})).toHaveCount(0);
 await page.getByLabel("Path ใหม่").fill(photoRoot("nas-a"));await page.getByRole("button",{name:"ทดสอบการเข้าถึง"}).click();
 await expect(page.getByText("ทดสอบผ่าน — ใช้ Path นี้ได้")).toBeVisible();
 await expect(page.locator(".storage-checks li")).toHaveCount(5);
 await page.getByLabel(/เหตุผลที่เปลี่ยน/).fill("ย้ายไปโฟลเดอร์ NAS จำลองของห้องปฏิบัติการ");
 await shot(page,"07-settings-tested");
 await axe(page);
 await page.getByRole("button",{name:"บันทึกและใช้ Path นี้"}).click();
 await expect(page.getByText(/บันทึกแล้ว — ภาพใหม่จะเก็บที่ Path นี้/)).toBeVisible();
 await expect(page.locator("table").getByText(photoRoot("nas-a"))).toBeVisible();
 await expect(page.locator("table").getByText("เก็บภาพเดิม")).toBeVisible();
 await shot(page,"08-settings-history");
 // Lab uploads after the change: the file lands in the new folder; the earlier photos still open from the old folder.
 await page.context().clearCookies();await login(page,"synthetic.lab");await page.goto(`/lab/photos/${run.batchId}`);
 await uploadInput(page).setInputFiles([await jpeg(page,"AFTER PATH CHANGE")]);await page.getByRole("button",{name:"อัปโหลด 1 ภาพ"}).click();
 await expect(page.getByRole("status").filter({hasText:"อัปโหลดแล้ว 1 ภาพ"})).toBeVisible({timeout:60000});
 const latest=(await q<{id:string;sha256:string}>("SELECT id,sha256 FROM run_photo WHERE batch_id=$1 ORDER BY uploaded_at DESC LIMIT 1",[run.batchId]))[0];
 expect(await readdir(path.join(photoRoot("nas-a"),"sha256",latest.sha256.slice(0,2),latest.sha256.slice(2,4)))).toContain(latest.sha256);
 expect((await page.request.get(`/api/run-photos/${firstPhotoId}/file`)).status()).toBe(200);
 // Other staff see the status without the absolute path.
 await page.context().clearCookies();await login(page,"synthetic.auditor");await page.goto("/settings/run-photos");
 await expect(page.getByText("แสดงเฉพาะผู้ดูแลระบบ")).toBeVisible();await expect(page.getByText(photoRoot("nas-a"))).toHaveCount(0);
});

test("storage offline or access denied: photos report it, Run work and pages carry on",async({page})=>{
 test.setTimeout(150000);
 await page.setViewportSize({width:1440,height:1000});
 const active=photoRoot("nas-a"),away=photoRoot("nas-a-offline");
 await rename(active,away);
 try{
  await login(page,"synthetic.lab");
  await page.goto(`/lab/batches/${run.batchId}`);
  await expect(page.getByRole("tab",{name:/^Task List 1/})).toBeVisible();
  await expect(page.getByRole("link",{name:/ภาพประจำ Run \(\d+ ภาพ\)/})).toBeVisible();
  // Run work during the outage: plan a Task (an ordinary write) succeeds.
  const v=(await q<{version:number}>("SELECT version FROM lab_batch WHERE id=$1",[run.batchId]))[0].version;
  const plan=await labPost(page,`/api/p4/batches/${run.batchId}`,{action:"updatePlan",expectedVersion:v,sheetNumber:1,plannedWorkDate:"2026-10-17",plannedOperator:"จำลอง ผู้ปฏิบัติ",plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
  expect(plan.ok(),await plan.text()).toBe(true);
  await page.goto(`/lab/photos/${run.batchId}`);
  await expect(page.locator(".photo-grid > li")).toHaveCount(5); // listing comes from the database
  await uploadInput(page).setInputFiles([await jpeg(page,"DURING OUTAGE")]);await page.getByRole("button",{name:"อัปโหลด 1 ภาพ"}).click();
  await expect(page.getByText(/ที่เก็บภาพเข้าถึงไม่ได้ขณะนี้|ไม่พบไฟล์ภาพในที่เก็บ/).first()).toBeVisible({timeout:60000});
  await expect(page.getByText(/งาน Run, Task List, QC, Pooling, ผลตรวจ และ HIS ทำต่อได้ตามปกติ|ข้อมูลภาพยังอยู่ในระบบ/).first()).toBeVisible();
  await shot(page,"09-offline-upload");
  const latest=(await q<{id:string}>("SELECT p.id FROM run_photo p JOIN run_photo_root_current c ON c.root_id=p.root_id WHERE c.state='Active' ORDER BY uploaded_at DESC LIMIT 1"))[0];
  expect([404,503]).toContain((await page.request.get(`/api/run-photos/${latest.id}/file`)).status());
  expect((await page.request.get(`/api/run-photos/${firstPhotoId}/file`)).status()).toBe(200); // older root still fine
 }finally{await mkdir(path.dirname(active),{recursive:true});await rename(away,active);}
});

test("wrong-Run upload is moved with a reason and a bad photo is retracted, both kept in history",async({page})=>{
 test.setTimeout(150000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const other=await runWithSamples(page,2);
 await page.goto(`/lab/photos/${other.batchId}`);
 await uploadInput(page).setInputFiles([await jpeg(page,"BELONGS TO FIRST RUN")]);await page.getByRole("button",{name:"อัปโหลด 1 ภาพ"}).click();
 await expect(page.getByRole("status").filter({hasText:"อัปโหลดแล้ว 1 ภาพ"})).toBeVisible({timeout:60000});
 await page.locator(".photo-thumb").first().click();const dialog=page.getByRole("dialog");
 await dialog.getByText("อัปโหลดผิด Run หรือภาพใช้ไม่ได้").click();
 await dialog.getByLabel(/เหตุผล/).fill("อัปโหลดผิด Run ย้ายไป Run ที่ถูกต้อง");
 await dialog.getByLabel("ย้ายไป Run ที่ถูกต้อง").selectOption({label:run.runLabel});
 await dialog.getByRole("button",{name:"ย้ายภาพไป Run นี้"}).click();
 await expect(page.getByRole("status").filter({hasText:"ย้ายภาพไป Run ที่เลือกแล้ว"})).toBeVisible();
 await expect(page.getByText("ยังไม่มีภาพของ Run นี้")).toBeVisible();
 await page.getByText(/ประวัติการเปลี่ยนแปลงภาพ/).click();await expect(page.getByText(`${other.runLabel} → ${run.runLabel}`)).toBeVisible();
 await page.goto(`/lab/photos/${run.batchId}`);
 await page.locator(".photo-thumb").first().click();
 await page.getByRole("dialog").getByText("อัปโหลดผิด Run หรือภาพใช้ไม่ได้").click();
 await page.getByRole("dialog").getByLabel(/เหตุผล/).fill("ภาพเบลอ อ่านฉลากไม่ได้");
 await page.getByRole("dialog").getByRole("button",{name:"ถอนภาพนี้ออก"}).click();
 await expect(page.getByRole("status").filter({hasText:"ถอนภาพออกแล้ว"})).toBeVisible();
 await page.getByLabel(/แสดงภาพที่ถอนออก/).check();await expect(page.locator(".photo-card.retracted")).toHaveCount(1);
 await shot(page,"10-retracted");
 expect((await q<{event_type:string}>("SELECT event_type FROM run_photo_event ORDER BY sequence")).map(e=>e.event_type)).toEqual(expect.arrayContaining(["UPLOADED","EDITED","MOVED","RETRACTED"]));
});
