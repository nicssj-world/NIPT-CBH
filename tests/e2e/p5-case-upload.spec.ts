import {test,expect,type Page,type Browser} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {mkdtemp,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {tx,syntheticCase,receiveS1} from "../helpers/lab";
import {syntheticReportPdf} from "../../tools/his-simulator/result-pdf";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

// Owner 2026-10-18 fallback channel in the browser: "อัปโหลด PDF ผลตรวจ" on the patient's case page.
const AA=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);}
async function as(browser:Browser,username:string){const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});const page=await c.newPage();await login(page,username);return {page,close:()=>c.close()};}
async function receivedCases(n:number){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const staff={id:(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.lab'")).rows[0].id,roles:["LAB_STAFF"],unitIds:[],permissions:[]} as unknown as Principal;
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id,out=[];
  for(let i=0;i<n;i++){
   const hn="99000"+String(Date.now()+i).slice(-7),c=await tx(q,t=>syntheticCase(t,{staff,unit}));
   const payload={draft:{patient:{dob:"1996-03-31"},pregnancy:{type:"Singleton",edd:"2027-04-22",fetalSex:"DoNotWant"}}};
   await tx(q,async t=>{await t.query("INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)",[c.caseId,hn]);
    await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5_E2E',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash("sha256").update(JSON.stringify(payload)+hn).digest("hex"),staff.id]);
    // Electronic request (as entered in the ANC form); otherwise opening the case creates the default Paper workspace without a verified panel.
    await t.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Electronic','Electronic',$4)",[c.roundId,c.caseId,JSON.stringify(payload.draft),staff.id]);
    await receiveS1(t,c,new Date(Date.now()-3600000),"2026-10-10");});
   const ln=(await db.query<{ln_halos:string}>("SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1",[c.roundId])).rows[0].ln_halos;
   out.push({...c,hn,pdf:syntheticReportPdf({kind:"SINGLETON",labNumber:ln,hn,collection:"10-Oct-2026"})});
  }
  return out;
 }finally{await db.end();}
}
const count=async(sql:string)=>{const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{return (await db.query<{n:number}>(sql)).rows[0].n;}finally{await db.end();}};

test("Case page upload: a wrong patient's PDF is refused; the right one is checked, previewed, attached and still needs a second person and acceptance",async({page,browser})=>{
 test.setTimeout(180000);
 const [a,b]=await receivedCases(2),dir=await mkdtemp(path.join(os.tmpdir(),"nipt-case-upload-"));
 const fileA=path.join(dir,`report-${a.hn}.pdf`),fileB=path.join(dir,`report-${b.hn}.pdf`);await writeFile(fileA,a.pdf);await writeFile(fileB,b.pdf);
 await page.setViewportSize({width:1280,height:1000});await login(page,"synthetic.lab");await page.goto(`/cases/${a.caseId}`);
 const panel=page.getByRole("region",{name:"ผล PDF ฉบับสุดท้าย"});await expect(panel).toBeVisible();
 await expect(panel.getByRole("region",{name:"สถานะผล PDF แต่ละรอบ"})).toContainText("ยังไม่มีผล");
 await expect(panel).toContainText("ช่องทางโฟลเดอร์");
 const jobs=await count("SELECT count(*)::int n FROM job_outbox"),versions=await count("SELECT count(*)::int n FROM result_report_version");
 // Wrong patient: refused, nothing attached.
 await panel.getByLabel("ไฟล์ PDF ผลตรวจ").setInputFiles(fileB);await panel.getByRole("button",{name:"อัปโหลด PDF ผลตรวจ"}).click();
 await expect(panel.getByRole("alert")).toContainText("ไม่ตรงกับผู้ป่วย/รอบที่เลือก");await expect(panel.getByRole("alert")).toContainText("HN");
 expect(await count("SELECT count(*)::int n FROM result_report_version")).toBe(versions);
 // Right patient: comparison and preview, then confirm.
 await panel.getByLabel("ไฟล์ PDF ผลตรวจ").setInputFiles(fileA);await panel.getByRole("button",{name:"อัปโหลด PDF ผลตรวจ"}).click();
 const checked=panel.getByRole("region",{name:"ตรวจ PDF กับรายการที่เลือก"});await expect(checked).toContainText("ตรงกับรายการที่เลือก");
 await expect(checked.getByRole("row").filter({hasText:"HN"})).toContainText("ตรงกัน");
 const previewResponse=page.waitForResponse(r=>r.url().includes('/api/p5/intake/')&&r.url().endsWith('/file')&&r.request().method()==='GET');
 await checked.getByRole('button',{name:'ตัวอย่าง PDF ที่อัปโหลด',exact:true}).click();const preview=page.getByRole('dialog',{name:'ตัวอย่าง PDF ที่อัปโหลด'}),response=await previewResponse;
 expect(response.headers()['content-type']).toContain('application/pdf');const previewBytes=await page.request.get(response.url());expect(previewBytes.ok()).toBe(true);expect(await previewBytes.body()).toEqual(a.pdf);
 await expect(preview.locator('canvas[data-pdf-page="1"]')).toBeVisible();await expect(preview).toContainText(a.hn);await preview.getByRole('button',{name:'ปิด',exact:true}).click();
 await new AxeBuilder({page}).withTags(AA).analyze().then(r=>expect(r.violations).toEqual([]));
 await checked.getByRole("button",{name:"ยืนยันแนบ PDF กับรายการนี้"}).click();
 const done=panel.getByRole("region",{name:"ผลการอัปโหลด"});await expect(done).toContainText("รอผู้รับรองคนที่สองยืนยันการเชื่อมโยง");
 const attachedResponse=page.waitForResponse(r=>r.url().includes('/api/p5/results/')&&r.url().endsWith('/file')&&r.request().method()==='GET');
 await done.getByRole('button',{name:'PDF ที่แนบแล้ว',exact:true}).click();const attached=page.getByRole('dialog',{name:'PDF ที่แนบแล้ว'});const attachedBytes=await page.request.get((await attachedResponse).url());expect(attachedBytes.ok()).toBe(true);expect(await attachedBytes.body()).toEqual(a.pdf);
 await expect(attached.locator('canvas[data-pdf-page="1"]')).toBeVisible();await expect(attached).toContainText(a.hn);await attached.getByRole('button',{name:'ปิด',exact:true}).click();
 const reviewUrl=await done.getByRole("link",{name:"เปิดหน้าตรวจรับผล"}).getAttribute("href");
 await expect(panel.getByRole("region",{name:"สถานะผล PDF แต่ละรอบ"})).toContainText("รอจับคู่");await expect(panel).toContainText("อัปโหลดจากหน้าผู้ป่วย");
 expect(await count("SELECT count(*)::int n FROM job_outbox")).toBe(jobs); // parsed in the web request, no Worker job
 // The same file again (as if the folder delivered it too) is not a second report.
 await panel.getByLabel("ไฟล์ PDF ผลตรวจ").setInputFiles(fileA);await panel.getByRole("button",{name:"อัปโหลด PDF ผลตรวจ"}).click();
 await expect(panel.getByRole("status").filter({hasText:"ไฟล์นี้มีในระบบแล้ว"})).toBeVisible();
 expect(await count("SELECT count(*)::int n FROM result_report_version")).toBe(versions+1);
 // Second person approves the link on the result page; the round then waits for acceptance (nothing released).
 const cert=await as(browser,"synthetic.certifier");
 try{await cert.page.goto(reviewUrl!);await cert.page.getByLabel("เหตุผลการตัดสิน (ผู้ยืนยันคนที่สอง)").fill("ตรวจตัวตนจากการอัปโหลดในหน้าผู้ป่วยแล้ว");
  await cert.page.getByRole("button",{name:"ยืนยันการเชื่อมโยง"}).click();await expect(cert.page.getByText("ถูกบล็อกโดย Gate").first()).toBeVisible();}finally{await cert.close();}
 await page.reload();await expect(page.getByRole("region",{name:"สถานะผล PDF แต่ละรอบ"})).toContainText("รอตรวจรับ");
 expect(await count("SELECT count(*)::int n FROM result_release")).toBe(0);
 // ANC never gets the upload panel.
 const anc=await as(browser,"synthetic.anc");try{await anc.page.goto(`/cases/${a.caseId}`);await expect(anc.page.getByRole("region",{name:"ผล PDF ฉบับสุดท้าย"})).toHaveCount(0);
  const csrfCookie=(await anc.page.context().cookies()).find(c=>c.name==="nipt_csrf")?.value??"";
  expect((await anc.page.request.post(`/api/p5/cases/${a.caseId}/pdf-intake`,{headers:{origin:process.env.E2E_BASE_URL??"http://127.0.0.1:3000","x-csrf-token":csrfCookie},multipart:{roundId:a.roundId,file:{name:"x.pdf",mimeType:"application/pdf",buffer:a.pdf}}})).status()).toBe(403);}finally{await anc.close();}
});
