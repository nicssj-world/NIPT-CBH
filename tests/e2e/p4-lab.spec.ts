import {test,expect,type Page,type Browser} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {tx,setPendingPolicy,syntheticCase,receiveS1} from "../helpers/lab";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
async function as(browser:Browser,username:string){const c=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});const p=await c.newPage();await login(p,username);return {page:p,close:()=>c.close()};}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);

/** Fixture owner plays HIS + P2 evidence on the reserved browser DB, then activates the labelled synthetic gate policy (maker-checker). */
async function labFixture(count:number){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const p=(i:string,role:string)=>({id:i,roles:[role],unitIds:[],permissions:[]}) as unknown as Principal;
  const staff=p(await id("synthetic.lab"),"LAB_STAFF"),certifier=p(await id("synthetic.certifier"),"LAB_CERTIFIER"),approver=p(await id("synthetic.approver"),"CLINICAL_APPROVER");
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  // Isolate this run: an older Draft batch would otherwise be reopened (single assembling batch rule).
  await db.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'",[staff.id]);
  const active=(await db.query<{v:string|null}>("SELECT r.value->>'pendingGovernanceGate' v FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='laboratory'")).rows[0]?.v;
  if(active!=="PROCEED_SYNTHETIC_LABELLED")await setPendingPolicy(q,{certifier,approver},"PROCEED_SYNTHETIC_LABELLED");
  const cases=[];for(let i=0;i<count;i++){const c=await tx(q,t=>syntheticCase(t,{staff,unit},{pregnancy:i===1?"Twins":"Singleton"}));await tx(q,t=>receiveS1(t,c,new Date(Date.now()-(count-i)*60000)));cases.push(c);}
  return cases;
 }finally{await db.end();}
}
const fixtureQuery=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>{const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{return (await db.query<T>(sql,params)).rows;}finally{await db.end();}};

for(const width of [375,768,1280])test(`P4 Lab worklist is accessible and responsive at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page,"synthetic.lab");
 if(await page.getByRole("button",{name:"เปิดเมนูหลัก",exact:true}).isVisible())await page.getByRole("button",{name:"เปิดเมนูหลัก",exact:true}).click();await page.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"งาน Lab"}).click();
 await expect(page.getByRole("heading",{level:1,name:"งาน Lab — คิวตัวอย่าง"})).toBeVisible();
 await expect(page.getByRole("tab",{name:/พร้อมเข้าตรวจ/})).toHaveAttribute("aria-selected","true");
 await expect(page.getByText("รอบที่ 1 เข้ามาเองจากการรับใน HIS")).toBeVisible();
 await expect(page.getByRole("button",{name:/รับสิ่งส่งตรวจ.*HIS/})).toHaveCount(0); // no second S1 receipt
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await axe(page);
 await page.goto("/lab/batches");await expect(page.getByRole("heading",{level:1,name:"Batch / Task List"})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await axe(page);
});

test("P4 journey: labels (4 stickers/8 halves) → batch → plan check → finalize → Pre-work → execution → second-person review",async({page,browser})=>{
 test.setTimeout(180000);
 const cases=await labFixture(2);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");await page.goto("/lab");
 await page.getByLabel("ค้นหา LN / LN Halos / Sample ID / Run").fill(cases[0].ln);
 const row=page.getByRole("row",{name:new RegExp(cases[0].ln)});await expect(row).toBeVisible();
 await expect(row.getByText("ยังไม่พิมพ์")).toBeVisible();
 // Labels: preview and print the exact Genomic-CBH layout from the issued LN Halos.
 await row.getByRole("button",{name:"ฉลาก",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:/พิมพ์ฉลากหลอด 1 ตัวอย่าง/});await expect(dialog).toBeVisible();
 const sheet=dialog.frameLocator("iframe");await expect(sheet.locator(".sticker")).toHaveCount(4);await expect(sheet.locator(".half")).toHaveCount(8);
 await expect(sheet.locator(".patient-ln").filter({hasText:`LN: ${cases[0].ln}`})).toHaveCount(8);
 await expect(sheet.locator("svg,img,canvas")).toHaveCount(0);
 await axe(page);
 await dialog.getByRole("button",{name:"บันทึกและพิมพ์"}).click();
 await expect(dialog.getByRole("status")).toContainText("บันทึกการพิมพ์แล้ว");
 await dialog.getByRole("button",{name:"ปิด"}).last().click();
 const jobs=await fixtureQuery<{kind:string;n:number}>("SELECT j.kind,j.sample_count n FROM label_print_job j JOIN label_print_item i ON i.job_id=j.id WHERE i.round_id=$1",[cases[0].roundId]);
 expect(jobs).toEqual([{kind:"PRINT",n:1}]);
 // Reprint requires a reason and never issues a number.
 await page.getByLabel("ค้นหา LN / LN Halos / Sample ID / Run").fill("");
 for(const c of cases)await page.getByRole("row",{name:new RegExp(c.ln)}).getByRole("checkbox").check();
 await page.getByRole("button",{name:/พิมพ์ฉลาก \(2\)/}).click();
 const multi=page.getByRole("dialog",{name:/พิมพ์ฉลากหลอด 2 ตัวอย่าง/});await expect(multi.frameLocator("iframe").locator(".sticker")).toHaveCount(8);
 await expect(multi.getByRole("button",{name:"บันทึกและพิมพ์ซ้ำ"})).toBeDisabled();
 await multi.getByLabel("เหตุผลการพิมพ์ซ้ำ (จำเป็น)").fill("จำลอง สติ๊กเกอร์เสียหาย");
 await multi.getByRole("button",{name:"บันทึกและพิมพ์ซ้ำ"}).click();await expect(multi.getByRole("status")).toContainText("เลข LN Halos เดิม");
 await multi.getByRole("button",{name:"ปิด"}).last().click();
 expect(await fixtureQuery("SELECT 1 FROM specimen_lab_number WHERE round_id=ANY($1::uuid[])",[cases.map(c=>c.roundId)])).toHaveLength(2);
 // Add both to a batch (FIFO order, control slots skipped).
 for(const c of cases)await page.getByRole("row",{name:new RegExp(c.ln)}).getByRole("checkbox").check();
 await page.getByRole("button",{name:/เพิ่มเข้า Batch \(2\)/}).click();
 const assign=page.getByRole("dialog",{name:"เพิ่มตัวอย่างเข้า Batch"});
 await assign.getByRole("button",{name:/สร้าง\/เปิด Batch ร่าง/}).click();await expect(assign.getByLabel("Batch")).not.toHaveValue("");
 await assign.getByRole("button",{name:"ยืนยันเพิ่มเข้า Batch"}).click();
 // Older Ready samples from earlier runs may precede these two: overtaking FIFO then requires a recorded reason (AT-TASK-09).
 const override=assign.getByLabel("เหตุผลที่แซงลำดับ FIFO (จำเป็น)");
 await expect(assign.getByRole("status").or(override)).toBeVisible();
 if(await override.isVisible()){await override.fill("จำลอง เลือกตัวอย่างของการทดสอบนี้");await assign.getByRole("button",{name:"ยืนยันเพิ่มเข้า Batch"}).click();}
 await expect(assign.getByRole("status")).toContainText(/จัดเข้า Batch แล้ว 2 รายการ: ตน\.2 .*, ตน\.3 /);
 await assign.getByRole("link",{name:"เปิด Batch"}).click();
 await expect(page.getByRole("heading",{level:1,name:/^Run\d{3}\/\d{4}$/})).toBeVisible();
 await expect(page.getByRole("row",{name:/^1 A1/}).getByText("PC")).toBeVisible();
 await axe(page);
 // Plan → plan check (not pipetting evidence) → Finalize Gate → immutable snapshot.
 {const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10).split("-");const planDate=page.getByLabel("วันที่ปฏิบัติงานที่วางแผน (ใช้สร้างรหัส Control)");await planDate.fill(`${today[2]}/${today[1]}/${Number(today[0])+543}`);await planDate.blur();} // BE input (Owner decision, Plan Rev 3.4 §7)
 await page.getByRole("button",{name:"บันทึกข้อมูลแผน"}).click();await expect(page.getByRole("status")).toContainText("บันทึกข้อมูลแผนแล้ว");
 await page.getByRole("button",{name:"ยืนยันแผนตำแหน่ง"}).click();
 const check=page.getByRole("dialog",{name:/ยืนยันแผนตำแหน่ง/});await expect(check.getByText("ไม่ใช่การยืนยันว่าดูดตัวอย่างแล้ว")).toBeVisible();
 for(const box of await check.getByRole("checkbox").all())await box.check();
 await check.getByRole("button",{name:"ยืนยันแผน"}).click();
 await page.getByRole("button",{name:"Finalize Placement"}).click();await expect(page.getByRole("status")).toContainText("Finalize Placement แล้ว");
 await expect(page.getByRole("button",{name:"บันทึก ✓"})).toHaveCount(0); // no ✓ before execution
 await page.getByRole("button",{name:"ออกใบงาน Pre-work (F2)"}).click();await expect(page.getByRole("status")).toContainText("ออกใบงาน Pre-work");
 await expect(page.getByRole("row",{name:/F2 Task List 1 · Pre-work/})).toContainText("มีผล");
 const pdf=await page.request.get(`/api/p4/documents/${(await fixtureQuery<{id:string}>("SELECT d.id FROM lab_document d JOIN lab_slot_assignment a ON a.batch_id=d.batch_id WHERE a.attempt_id=(SELECT id FROM analytical_attempt WHERE round_id=$1) AND d.form='F2' ORDER BY d.issued_at DESC LIMIT 1",[cases[0].roundId]))[0].id}`);
 expect(pdf.headers()["content-type"]).toBe("application/pdf");expect((await pdf.body()).subarray(0,5).toString()).toBe("%PDF-");
 // Physical execution: server-time anchor, ✓ recorded only now, then a different person verifies.
 await page.getByRole("button",{name:"เริ่มปฏิบัติงานจริง"}).click();await expect(page.getByRole("status")).toContainText("บันทึกเริ่มปฏิบัติแล้ว");
 await page.getByRole("button",{name:"บันทึก ✓"}).first().click();
 const tr=page.getByRole("dialog",{name:/ตรวจ Lab number ตำแหน่ง 1/});await tr.getByRole("button",{name:"บันทึก ✓ ก่อน/หลังดูด"}).click();
 await expect(page.getByRole("status")).toContainText("รอทวนสอบ");
 await expect(page.getByRole("heading",{name:/รอทวนสอบโดยคนที่สอง \(1\)/})).toBeVisible();
 await expect(page.getByText("(ของคุณ — ทวนสอบเองไม่ได้)")).toBeVisible();
 const cert=await as(browser,"synthetic.certifier");
 try{
  await cert.page.goto(page.url());await cert.page.getByRole("checkbox",{name:/✓ ตรวจ Lab number/}).check();
  await cert.page.getByRole("button",{name:/ยืนยันตรงกับต้นทาง \(1\)/}).click();await expect(cert.page.getByRole("status")).toContainText("ทวนสอบแล้ว");
  await expect(cert.page.getByText("ทำแล้ว (ทวนสอบ)").first()).toBeVisible();
 }finally{await cert.close();}
});

test("P4 RBAC: ANC sees no Lab screens and the Lab APIs refuse ANC and Auditor writes",async({browser})=>{
 const anc=await as(browser,"synthetic.anc");
 try{
  await expect(anc.page.getByRole("navigation",{name:"เมนูหลัก"}).getByRole("link",{name:"งาน Lab"})).toHaveCount(0);
  await anc.page.goto("/lab");await expect(anc.page.getByText("ไม่มีสิทธิ์เปิดคิวงาน Lab")).toBeVisible();
  const me=await anc.page.request.get("/api/me").then(r=>r.json());
  expect((await anc.page.request.get("/api/p4/worklist")).status()).toBe(403);
  expect((await anc.page.request.post("/api/p4/batches",{headers:{"x-csrf-token":me.csrf,"content-type":"application/json"},data:{}})).status()).toBe(403);
 }finally{await anc.close();}
 const auditor=await as(browser,"synthetic.auditor");
 try{
  expect((await auditor.page.request.get("/api/p4/worklist")).status()).toBe(200);
  const me=await auditor.page.request.get("/api/me").then(r=>r.json());
  expect((await auditor.page.request.post("/api/p4/labels",{headers:{"x-csrf-token":me.csrf,"content-type":"application/json"},data:{action:"preview",roundIds:[randomUUID()],includeName:false}})).status()).toBe(403);
 }finally{await auditor.close();}
});

test("AT-SORT-01/02: registry receive column defaults newest first; Ready Queue defaults oldest first; both toggle with a direction arrow",async({page})=>{
 test.setTimeout(90000);
 const cases=await labFixture(2); // receipts 2 min and 1 min ago
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.lab");
 await page.goto("/cases");
 const sortButton=page.getByRole("button",{name:/เรียงตามวันที่\/เวลารับสิ่งส่งตรวจ ปัจจุบันใหม่ไปเก่า/});await expect(sortButton).toContainText("↓");
 const lnOrder=async()=>(await page.locator(".registry-row strong").allTextContents()).map(t=>t.replace(/\D/g,""));
 const order=await lnOrder();expect(order.indexOf(cases[1].ln)).toBeLessThan(order.indexOf(cases[0].ln));
 await sortButton.click();await expect(page.getByRole("button",{name:/ปัจจุบันเก่าไปใหม่/})).toContainText("↑");
 await expect.poll(async()=>{const o=await lnOrder();return o.indexOf(cases[0].ln)<o.indexOf(cases[1].ln);}).toBe(true);
 await axe(page);
 await page.goto("/lab");await page.getByRole("tab",{name:/ติด Gate|พร้อมเข้าตรวจ/}).first().click();
 const header=page.getByRole("columnheader",{name:/วันที่\/เวลารับ/});await expect(header).toHaveAttribute("aria-sort","ascending");
 const rows=async()=>(await page.locator("tbody tr td:nth-child(2)").allTextContents()).map(t=>t.replace(/\D/g,""));
 let r=await rows();expect(r.indexOf(cases[0].ln)).toBeLessThan(r.indexOf(cases[1].ln));
 await header.getByRole("button").click();await expect(header).toHaveAttribute("aria-sort","descending");
 r=await rows();expect(r.indexOf(cases[1].ln)).toBeLessThan(r.indexOf(cases[0].ln));
 expect(await fixtureQuery("SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt t ON t.id=a.attempt_id WHERE t.round_id=ANY($1::uuid[])",[cases.map(c=>c.roundId)])).toHaveLength(0); // sorting never batches

});
