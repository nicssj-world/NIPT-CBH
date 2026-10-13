import {test,expect,type Page,type Browser} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {tx,syntheticCase,receiveS1} from "../helpers/lab";
import {syntheticReportPdf} from "../../tools/his-simulator/result-pdf";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

// P5 runs against the real worker: Test Path, Scan and Preview are executed by `npm run worker` on SIMULATOR_ROOT/results.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
async function as(browser:Browser,username:string){const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});const p=await c.newPage();await login(p,username);return {page:p,close:()=>c.close()};}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);

/** A received S1 with a P2 HN and Request (DOB/EDD/sex wish), plus its synthetic result PDF written into a fresh results sub-folder. */
async function resultFixture(){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const staff={id:await id("synthetic.lab"),roles:["LAB_STAFF"],unitIds:[],permissions:[]} as unknown as Principal;
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const hn="99000"+String(Date.now()).slice(-7),c=await tx(q,t=>syntheticCase(t,{staff,unit}));
  const payload={draft:{patient:{dob:"1996-03-31"},pregnancy:{type:"Singleton",edd:"2027-04-22",fetalSex:"DoNotWant"}}};
  await tx(q,async t=>{await t.query("INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)",[c.caseId,hn]);
   await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5_E2E',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash("sha256").update(JSON.stringify(payload)+hn).digest("hex"),staff.id]);
   await receiveS1(t,c,new Date(Date.now()-3600000),"2026-10-10");});
  const folder=`e2e-${randomUUID().slice(0,8)}`,file=`SYNTHETIC-E2E-${hn}.pdf`;
  await mkdir(path.join(process.env.SIMULATOR_ROOT??"data/simulator","results",folder),{recursive:true});
  await writeFile(path.join(process.env.SIMULATOR_ROOT??"data/simulator","results",folder,file),syntheticReportPdf({kind:"SINGLETON",labNumber:"26B261010099-1",hn,collection:"10-Oct-2026"}));
  return {...c,hn,folder,file};
 }finally{await db.end();}
}

test("P5 folder workflow: Test Path → Scan → Preview → import, then two-person linkage and certification HOLD",async({page,browser})=>{
 test.setTimeout(150000);
 const f=await resultFixture();
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 await page.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"ผลตรวจ NIPT"}).click();
 await expect(page.getByRole("heading",{name:"ผลตรวจ NIPT",exact:true})).toBeVisible();
 await expect(page.getByText("ยังไม่ปล่อยผลจริง")).toBeVisible();
 await page.getByRole("button",{name:"ทดสอบโฟลเดอร์"}).click();
 await expect(page.getByLabel("ผลทดสอบโฟลเดอร์")).toContainText("อ่านได้",{timeout:60000});
 await page.getByRole("button",{name:"สแกนโฟลเดอร์"}).click();
 const scan=page.getByRole("region",{name:"ไฟล์ที่พบในโฟลเดอร์"});await expect(scan).toContainText(f.file,{timeout:60000});await expect(scan).toContainText(f.folder);
 await page.getByLabel("เลือกไฟล์ใหม่ทั้งหมด").uncheck();await page.getByLabel(`เลือก ${f.file}`).check();
 await axe(page);
 await page.getByRole("button",{name:"Preview ไฟล์ที่เลือก"}).click();
 const preview=page.getByRole("region",{name:"ผล Preview"});await expect(preview).toContainText("ผลตรวจ ครรภ์เดี่ยว",{timeout:60000});
 await expect(preview).toContainText(f.hn);await expect(preview).toContainText("1 รอบ/Attempt");await expect(preview).toContainText("อ่านได้ — พร้อมนำเข้า");
 await page.getByRole("button",{name:"ยืนยันนำเข้า"}).click();await expect(page.getByRole("status")).toContainText("นำเข้าแล้ว 1 รายการ");
 const row=page.getByRole("region",{name:"รายการรายงาน"}).getByRole("row").filter({hasText:f.file});await expect(row).toContainText("รอเชื่อมโยงกับรอบ/Attempt");
 await row.getByRole("link",{name:"เปิด"}).click();
 await expect(page.getByRole("heading",{name:"ตรวจทานผล",exact:true})).toBeVisible();
 await expect(page.getByRole("region",{name:"ค่าที่อ่านได้",exact:true})).toContainText("Low Risk");
 await page.getByRole("radio").first().check();await page.getByLabel("เหตุผลที่เลือก (อย่างน้อย 8 ตัวอักษร)").fill("จำลอง HN วันเกิด วันที่เก็บตรงกับรอบที่ 1");
 await page.getByRole("button",{name:"เสนอการเชื่อมโยง"}).click();await expect(page.getByText("มีข้อเสนอรอผู้รับรองคนที่สองยืนยัน")).toBeVisible();
 await expect(page.getByText("ผู้เสนอยืนยันรายการของตนเองไม่ได้")).toBeVisible();
 await axe(page);
 const url=page.url();
 const cert=await as(browser,"synthetic.certifier");
 try{
  await cert.page.goto(url);await cert.page.getByLabel("เหตุผลการตัดสิน (ผู้ยืนยันคนที่สอง)").fill("จำลอง ตรวจคุณสมบัติครบทุกข้อ");
  await cert.page.getByRole("button",{name:"ยืนยันการเชื่อมโยง"}).click();
  await expect(cert.page.getByText("ถูกบล็อกโดย Gate").first()).toBeVisible();
  const gate=cert.page.getByRole("heading",{name:/Final Result Release Gate/});await expect(gate).toBeVisible();
  await expect(cert.page.locator(".p5-gates")).toContainText("ยังไม่ใช่ FinalQcAccepted — รอ QC4/QC5 จาก P4b");
  await cert.page.getByLabel("ตรวจแล้วว่าค่าทุกค่าตรงกับ PDF ต้นฉบับ").check();await cert.page.getByRole("button",{name:"บันทึกการตรวจทาน"}).click();await expect(cert.page.getByRole("status")).toContainText("บันทึกการตรวจทานแล้ว");
  await cert.page.getByRole("button",{name:"รับรองและส่งผล"}).click();
  await expect(cert.page.getByText("รับรองไม่ได้")).toBeVisible();await expect(cert.page.getByText(/RG-07/).first()).toBeVisible();
  await axe(cert.page);
 }finally{await cert.close();}
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();
 try{expect((await db.query("SELECT count(*)::int n FROM result_release")).rows[0]).toEqual({n:0});}finally{await db.end();}
 // ANC sees the case's result section without any unreleased PDF; Lab-only result APIs are refused.
 const anc=await as(browser,"synthetic.anc");
 try{
  await anc.page.goto(`/cases/${f.caseId}`);const section=anc.page.getByRole("region",{name:"ผลตรวจ NIPT"});
  await expect(section).toContainText("ยังไม่มีผลตรวจที่ปล่อยสำหรับรอบนี้");await expect(section).not.toContainText(f.file);
  expect((await anc.page.request.get("/api/p5/results")).status()).toBe(403);
  const versionId=url.split("/").pop()!;expect([403,404]).toContain((await anc.page.request.get(`/api/p5/results/${versionId}/file`)).status());
  expect((await anc.page.request.get(`/api/p5/releases/${versionId}/file`)).status()).toBe(404);
  await axe(anc.page);
 }finally{await anc.close();}
});

for(const width of [375,768,1280])test(`P5 result workspace is accessible and responsive at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page,"synthetic.lab");await page.goto("/results");
 await expect(page.getByRole("heading",{name:"คิวตรวจทานผล"})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await axe(page);
 await page.getByRole("tab",{name:"เลือกไฟล์จากเครื่อง"}).click();await expect(page.getByLabel("ไฟล์ผล (.pdf หรือ .zip) ได้สูงสุด 20 ไฟล์")).toBeVisible();await axe(page);
});

test("Settings: labelled fields instead of JSON, HOLD fields read-only, coverage of all ten categories",async({page})=>{
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.admin");await page.goto("/settings?key=result_management");
 await expect(page.getByLabel("หมวดการตั้งค่า")).toHaveValue("result_management");
 await expect(page.getByLabel("โฟลเดอร์ผล PDF (PDF Source Folder)")).toHaveValue("simulator/results");
 const hold=page.getByLabel(/สิทธิ์ปล่อยผลจริง/);await expect(hold).toHaveAttribute("readonly","");await expect(hold).toHaveValue("HOLD_AL5");
 await expect(page.getByRole("region",{name:"ตารางความครอบคลุมของหมวด"})).toContainText("path_pdfresult");
 await page.getByText("สรุปทั้ง 10 หมวด").click();await expect(page.getByRole("region",{name:"สรุปความครอบคลุม"}).getByRole("row")).toHaveCount(11);
 await expect(page.locator("textarea#setting-value")).toHaveCount(0);
 for(const width of [375,768]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await axe(page);
});
