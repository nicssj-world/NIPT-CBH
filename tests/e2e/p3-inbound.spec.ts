import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Pool} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {FileStore} from "../../packages/storage";
import {buildSyntheticPet} from "../../packages/inbound/wire";
import {runInboundCycle} from "../../packages/inbound/cycle";
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username="synthetic.lab"){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
for(const width of [375,768,1280])test(`P3 inbound queue is accessible and responsive at ${width}px (Lab)`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page);
 await page.goto("/inbound");
 await expect(page.getByRole("heading",{level:1,name:"รับตัวอย่างจาก HIS"})).toBeVisible();
 // OWNER-LAB-020: connection status is a row of status cards (not a heading); sections carry live counts.
 for(const name of [/^ไฟล์ล่าสุด/,/^ประวัติการสแกน/])await expect(page.getByRole("heading",{name})).toBeVisible();
 await expect(page.getByText("โฟลเดอร์ต้นทาง",{exact:true}).first()).toBeVisible();
 await expect(page.getByRole("heading",{name:/รายการที่ต้องตรวจ/})).toBeVisible();
 // The simulator-only "สแกนไฟล์จำลอง" button no longer exists (scans run on the worker interval; Deep scan stays).
 await expect(page.getByLabel("สแกนย้อนหลัง (Deep scan) จำนวนวัน")).toBeVisible();
 await expect(page.getByRole("button",{name:"ทดสอบการเชื่อมต่อ",exact:true})).toHaveCount(0); // integration.configure is Admin/IT only
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
});
test("P3 inbound: Admin gets Test Connection but no LN-level PHI; ANC is denied",async({page,browser})=>{
 await login(page,"synthetic.admin");await page.goto("/inbound");
 await expect(page.getByRole("button",{name:"ทดสอบการเชื่อมต่อ",exact:true})).toBeVisible();
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
 const other=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});
 const anc=await other.newPage();await login(anc,"synthetic.anc");await expect(anc.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"รับตัวอย่างจาก HIS"})).toHaveCount(0);await anc.goto("/inbound");await expect(anc.getByRole("heading",{level:1,name:"รับตัวอย่างจาก HIS"})).toHaveCount(0);
 const me=await anc.request.get("/api/me").then(r=>r.json());
 expect((await anc.request.post("/api/p3/inbound/deep-scan",{headers:{"x-csrf-token":me.csrf,"content-type":"application/json"},data:{lookbackDays:5}})).status()).toBe(403);
 await other.close();
});

/** Simulator-side HIS: synthetic PETs through the real inbound pipeline into the app's file store (fixture DB owner). */
async function hisIntakes(pets:{ln:string;hn:string}[]){
 const url=browserFixtureDatabaseUrl(),db=new Pool({connectionString:url,max:2}),base=await mkdtemp(path.join(os.tmpdir(),"nipt-p3-e2e-")),root=path.join(base,"simulator");
 const day=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}).replace(/-/g,"");
 try{
  await mkdir(path.join(root,"inbound",day),{recursive:true});await writeFile(path.join(root,".nipt-synthetic-root"),"NIPT_SYNTHETIC_ONLY_V1");
  for(const p of pets){const pet=buildSyntheticPet({...p,name:"SYNTHETIC^^นาง ห้ามแสดงก่อนกรอก",receivedAt:day+"081500",specimenAt:day+"070000"});await writeFile(path.join(root,"inbound",day,pet.filename),pet.bytes);await writeFile(path.join(root,"inbound",day,pet.filename.replace(".pet",".ok")),"");}
  const lookupKey=readFileSync(process.env.IDENTITY_LOOKUP_KEY_FILE??"data/keys/lookup.key");
  const r=await runInboundCycle(db,{store:new FileStore(path.resolve(process.env.FILE_STORE_ROOT||"data/files")),lookupKey,root},{trigger:"MANUAL",lookbackDays:1,intervalSeconds:30});
  expect(r.counts).toMatchObject({outcome_UNLINKED:pets.length});
 }finally{await db.end();await rm(base,{recursive:true,force:true});}
}
test("P2-P3 Lab blind entry: presence only before entry, match links S1 at P[21], mismatch queues without HIS values",async({page})=>{
 test.setTimeout(90000);
 const n=String(Date.now()).slice(-4),match={ln:"99000"+n+"1",hn:"00990"+n+"1"},miss={ln:"99000"+n+"2",hn:"00990"+n+"2"},fresh="99000"+n+"3";
 await hisIntakes([match,miss]);
 await page.setViewportSize({width:375,height:900});await login(page,"synthetic.lab");
 await page.getByRole("button",{name:"เปิดเมนูหลัก",exact:true}).click();await expect(page.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"รับตัวอย่างจาก HIS"})).toBeVisible();await page.keyboard.press("Escape");
 const open=async(ln:string)=>{await page.goto("/cases");await page.getByRole("button",{name:"ลงทะเบียนโดย Lab",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("LN HIS จำลอง",{exact:false}).fill(ln);await dialog.getByLabel("LN HIS จำลอง",{exact:false}).blur();return dialog;};
 const fill=async(dialog:ReturnType<Page["getByRole"]>,hn:string,source:string)=>{await dialog.getByLabel("HN จำลอง",{exact:false}).fill(hn);const unit=dialog.getByLabel("หน่วยงานลงทะเบียน",{exact:false});await expect(unit.locator("option")).not.toHaveCount(1);await unit.selectOption({index:1});const s=dialog.getByLabel("แหล่งของตัวระบุ",{exact:false});await s.selectOption(source);await expect(s).toHaveValue(source);await dialog.getByRole("button",{name:"ตรวจข้อมูลก่อนลงทะเบียน",exact:true}).click();await dialog.getByRole("button",{name:"ยืนยันลงทะเบียน",exact:true}).click();};
 let dialog=await open(match.ln);
 await expect(dialog.getByRole("status")).toContainText("มีข้อมูลสั่งตรวจจาก HIS ของ LN นี้รอเชื่อมอยู่");
 await expect(dialog).not.toContainText(match.hn);await expect(dialog).not.toContainText("ห้ามแสดง");
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Identifier source is required for Lab registration: native validation blocks the POST.
 let posts=0;page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/p2/register")posts++;});
 await dialog.getByLabel("HN จำลอง",{exact:false}).fill(match.hn);const unit=dialog.getByLabel("หน่วยงานลงทะเบียน",{exact:false});await expect(unit.locator("option")).not.toHaveCount(1);await unit.selectOption({index:1});await dialog.getByRole("button",{name:"ตรวจข้อมูลก่อนลงทะเบียน",exact:true}).click();expect(posts).toBe(0);
 await fill(dialog,match.hn,"TUBE_LABEL");
 await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+$/);await expect(page.getByText("รับจาก HIS (จำลอง)").first()).toBeVisible();
 dialog=await open(miss.ln);await expect(dialog.getByRole("status")).toContainText("มีข้อมูลสั่งตรวจจาก HIS ของ LN นี้รอเชื่อมอยู่");
 await fill(dialog,"00990"+n+"9","REQUEST_FORM");
 await expect(dialog.getByRole("alert")).toContainText("HN ไม่ตรงกับข้อมูลสั่งตรวจจาก HIS");await expect(dialog.getByRole("link",{name:"เปิดเคสที่ลงทะเบียน"})).toBeVisible();
 await expect(dialog).not.toContainText(miss.hn);await expect(dialog).not.toContainText("ห้ามแสดง");
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
 await dialog.getByRole("link",{name:"เปิดเคสที่ลงทะเบียน"}).click();await expect(page.getByText("รอรับสิ่งส่งตรวจ").first()).toBeVisible();
 dialog=await open(fresh);await expect(dialog.getByRole("status")).toContainText("ยังไม่มีข้อมูลสั่งตรวจจาก HIS ที่รอเชื่อม");
 const db=new Pool({connectionString:browserFixtureDatabaseUrl(),max:1});
 try{
  const q=async(ln:string)=>(await db.query("SELECT a.identifier_source,(SELECT count(*)::int FROM his_order o WHERE o.case_ln_id=l.id) AS orders,(SELECT string_agg(i.kind,',') FROM his_intake_issue i WHERE i.ln=l.ln AND i.state='Open') AS issues,(SELECT r.state FROM specimen_round r WHERE r.case_ln_id=l.id) AS round FROM case_ln l JOIN registration_attempt a ON a.case_id=l.case_id WHERE l.ln=$1",[ln])).rows;
  expect(await q(match.ln)).toEqual([{identifier_source:"TUBE_LABEL",orders:1,issues:null,round:"ReceivedInHIS"}]);
  expect(await q(miss.ln)).toEqual([{identifier_source:"REQUEST_FORM",orders:0,issues:"IDENTITY_MISMATCH",round:"Expected"}]);
 }finally{await db.end();}
});
