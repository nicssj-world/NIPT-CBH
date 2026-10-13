import {test,expect,type Page,type Browser} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {csvOf,goodRow,pdfFor} from "../helpers/historical";
import {syntheticZip} from "../../tools/his-simulator/result-pdf";
import {hashPassword} from "../../packages/security/password";
import {proposeSetting,validateSetting,approveSetting,activateSetting} from "../../packages/settings/service";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

// P5H runs against the real web app and the real worker: staging (PDF parsing, duplicate checks, eligibility) is done by `npm run worker`.
// Cutoff and Anchor policy below are SYNTHETIC test values activated through the normal Maker-Checker flow, not Owner decisions.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ"}).click();
 await page.waitForURL(u=>!u.pathname.startsWith("/login"));
}
async function as(browser:Browser,username:string){const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3600",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});const page=await c.newPage();await login(page,username);return {page,close:()=>c.close()};}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);

async function fixture(){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const p=async(u:string,role:string)=>({id:await id(u),roles:[role],unitIds:[],permissions:[]}) as unknown as Principal;
  const approver=await p("synthetic.approver","CLINICAL_APPROVER"),certifier=await p("synthetic.certifier","LAB_CERTIFIER"),lab=await id("synthetic.lab");
  await db.query("INSERT INTO user_permission(user_id,permission,approved_by) VALUES($1,'HISTORICAL_ENTRY',$2) ON CONFLICT DO NOTHING",[lab,approver.id]);
  if(!(await db.query("SELECT 1 FROM app_user WHERE username='synthetic.verifier'")).rowCount){
   const v=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.verifier','ผู้ตรวจย้อนหลังจำลอง',$1) RETURNING id",[await hashPassword(password())])).rows[0].id;
   await db.query("INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,'HISTORICAL_VERIFIER',$2)",[v,approver.id]);
  }
  const activate=async(key:string,value:unknown)=>{await db.query("BEGIN");try{const sid=await proposeSetting(q,certifier,key,value,"SYNTHETIC_P5H_E2E");await validateSetting(q,certifier,sid,async()=>true);await approveSetting(q,approver,sid);await activateSetting(q,approver,sid);await db.query("COMMIT");}catch(e){await db.query("ROLLBACK");throw e;}};
  const active=async(key:string)=>(await db.query("SELECT 1 FROM setting_active WHERE setting_key=$1",[key])).rowCount;
  if(!(await active("go_live_cutoff")))await activate("go_live_cutoff",{cutoff:"2026-01-01",impactReportHash:"a".repeat(64)});
  if(!(await active("historical_backfill")))await activate("historical_backfill",{anchorPolicy:"A_FINAL_REPORT",minimumProfile:"OD18_B_BALANCED",maxBatchRows:100});
 }finally{await db.end();}
}
async function count(sql:string,args:unknown[]=[]){const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{return Number((await db.query(sql,args)).rows[0].n);}finally{await db.end();}}

test("a lab user imports 47 historical cases in three steps; a second person confirms them as a batch",async({browser})=>{
 test.setTimeout(240000);
 await fixture();
 const run=String(Date.now()).slice(-6);
 const rows=Array.from({length:47},(_,i)=>{const n=i+1;return goodRow(n,{ln:`2611${run}${String(n).padStart(2,"0")}`,hn:`990${run}${String(n).padStart(2,"0")}`,pdf_file:`e2e-${run}-${n}.pdf`});});
 const sheet=rows.map((r,i)=>i===4?{...r,report_date:"25/12/2025"}:r);   // one row the staff must fix
 const pdfs=rows.map(r=>({name:r.pdf_file!,data:pdfFor(r)}));

 // ① Upload (lab staff with HISTORICAL_ENTRY)
 const lab=await as(browser,"synthetic.lab");
 await lab.page.goto("/historical");
 await expect(lab.page.getByRole("heading",{name:"นำเข้าข้อมูลย้อนหลัง"})).toBeVisible();
 await axe(lab.page);
 await lab.page.getByLabel(/ไฟล์ตาราง/).setInputFiles({name:"historical-47.csv",mimeType:"text/csv",buffer:csvOf(sheet)});
 await lab.page.getByLabel(/ไฟล์ PDF ผลเดิม/).setInputFiles({name:"reports.zip",mimeType:"application/zip",buffer:syntheticZip(pdfs)});
 await lab.page.getByRole("button",{name:"อัปโหลดและตรวจสอบ"}).click();
 await lab.page.waitForURL(/\/historical\/[0-9a-f-]{36}$/);
 const batchUrl=lab.page.url();

 // ② The worker stages the batch; only the broken row needs work.
 await expect(lab.page.getByRole("heading",{name:"② ตรวจสอบรายการ"})).toBeVisible({timeout:90000});
 await expect(lab.page.getByText(/47\s*แถว/).first()).toBeVisible();
 const problemRow=lab.page.getByRole("row").filter({hasText:`2611${run}05`});
 await expect(problemRow).toContainText("รูปแบบวันที่ไม่ถูกต้อง");
 await expect(lab.page.getByRole("row")).toHaveCount(2+0);   // header + the one problem row (filter "only rows to fix" is on)
 await axe(lab.page);
 await problemRow.getByRole("button",{name:/แก้ไขแถว/}).click();
 await lab.page.getByLabel("วันที่รายงานผล").fill("2025-12-15");
 await lab.page.getByLabel(/เหตุผลที่แก้/).fill("แก้ตามเอกสารต้นฉบับ");
 await lab.page.getByRole("button",{name:"บันทึกและตรวจใหม่"}).click();
 await expect(lab.page.getByText("ไม่มีแถวที่ต้องแก้ไข")).toBeVisible({timeout:30000});
 // The importer is never the second person.
 await expect(lab.page.getByText("ขั้นตอนนี้ทำได้เฉพาะผู้ตรวจ")).toBeVisible();
 await lab.close();

 // ③ A different person checks every row against the originals and confirms the batch.
 const reviewer=await as(browser,"synthetic.verifier");
 await reviewer.page.goto(batchUrl);
 await expect(reviewer.page.getByRole("heading",{name:"③ ผู้ตรวจตรวจกับต้นฉบับและยืนยันเป็นชุด"})).toBeVisible({timeout:30000});
 const confirm=reviewer.page.getByRole("button",{name:/ยืนยันแถวที่ตรวจครบ/});
 await expect(confirm).toBeDisabled();                                   // nothing is confirmed until each row is checked
 const quick=reviewer.page.getByRole("button",{name:"ตรวจครบทุกข้อของแถวนี้แล้ว"});
 await expect(quick).toHaveCount(47);
 for(const b of await quick.all())await b.click();
 await expect(confirm).toContainText("47 แถว");
 await axe(reviewer.page);
 await confirm.click();
 await expect(reviewer.page.getByText("ผลการยืนยัน")).toBeVisible({timeout:60000});
 const outcomes=reviewer.page.getByRole("status").filter({hasText:"ผลการยืนยัน"}).getByRole("listitem");
 await expect(outcomes).toHaveCount(47);
 await expect(outcomes.filter({hasText:/: นำเข้าแล้ว$/})).toHaveCount(47);
 await reviewer.close();

 expect(await count("SELECT count(*) n FROM nipt_case c JOIN case_ln l ON l.case_id=c.id WHERE c.registration_origin='HISTORICAL' AND l.ln LIKE $1",[`2611${run}%`])).toBe(47);
 expect(await count("SELECT count(*) n FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.ln LIKE $1",[`2611${run}%`])).toBe(0);
});

test("ANC users have no historical menu or page; lab staff with HISTORICAL_ENTRY do",async({browser})=>{
 await fixture();
 const anc=await as(browser,"synthetic.anc");
 await expect(anc.page.getByRole("link",{name:"นำเข้าย้อนหลัง"})).toHaveCount(0);
 await anc.page.goto("/historical");
 await expect(anc.page).not.toHaveURL(/\/historical/);
 await anc.close();
 const lab=await as(browser,"synthetic.lab");
 await expect(lab.page.getByRole("link",{name:"นำเข้าย้อนหลัง"})).toBeVisible();
 await lab.close();
});
