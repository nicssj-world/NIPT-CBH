import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {tx,setPendingPolicy,syntheticCase,receiveS1} from "../helpers/lab";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";

// P0 Task List remediation (Plan Rev 3.4). Synthetic data in the isolated P0 browser database only.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username:string){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).not.toHaveURL(/\/login/);
}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
const fixtureQuery=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[])=>{const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{return (await db.query<T>(sql,params)).rows;}finally{await db.end();}};

/** Same CSRF contract as the app's labApi (tests/e2e/p2.spec.ts pattern): double-submit cookie + same origin. */
async function labPost(page:Page,path:string,body:unknown){
 const token=(await page.context().cookies()).find(c=>c.name==="nipt_csrf")?.value??"";
 return page.request.post(path,{headers:{origin:new URL(page.url()).origin,"x-csrf-token":token,"content-type":"application/json"},data:body});
}
/** A fresh Draft batch for this test (the single-assembling-batch rule would otherwise reopen an older one). */
async function freshBatch(page:Page){
 await fixtureQuery("UPDATE lab_batch SET state='Cancelled',cancelled_by=(SELECT id FROM app_user WHERE username='synthetic.lab'),cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'");
 const r=await labPost(page,"/api/p4/batches",{});expect(r.ok(),`${r.status()} ${await r.text()}`).toBe(true);
 return (await r.json()).batchId as string;
}
const operator=(page:Page)=>page.getByLabel("ผู้ปฏิบัติที่วางแผน");
/** Planned work date for Task n, typed in BE (dd/mm/yyyy) as a user would. Day offset keeps the three Tasks distinct. */
async function fillPlannedDate(page:Page,n:number){const f=page.getByLabel(/วันที่.*วางแผน/);await f.fill(`${16+n}/10/2569`);await f.blur();}
/** Fixture owner plays HIS + P2 evidence and activates the labelled synthetic gate policy (same as p4-lab.spec.ts). */
async function readyCases(count:number){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const p=(i:string,role:string)=>({id:i,roles:[role],unitIds:[],permissions:[]}) as unknown as Principal;
  const staff=p(await id("synthetic.lab"),"LAB_STAFF"),certifier=p(await id("synthetic.certifier"),"LAB_CERTIFIER"),approver=p(await id("synthetic.approver"),"CLINICAL_APPROVER");
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const active=(await db.query<{v:string|null}>("SELECT r.value->>'pendingGovernanceGate' v FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='laboratory'")).rows[0]?.v;
  if(active!=="PROCEED_SYNTHETIC_LABELLED")await setPendingPolicy(q,{certifier,approver},"PROCEED_SYNTHETIC_LABELLED");
  const cases=[];for(let i=0;i<count;i++){const c=await tx(q,t=>syntheticCase(t,{staff,unit}));await tx(q,t=>receiveS1(t,c,new Date(Date.now()-(count-i)*60000)));cases.push(c);}
  return cases;
 }finally{await db.end();}
}

test("RC1: planned metadata never leaks between Task List 1–3 and each Task reloads its own values",async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const batchId=await freshBatch(page);await page.goto(`/lab/batches/${batchId}`);
 const tab=(n:number)=>page.getByRole("tab",{name:new RegExp(`^Task List ${n}`)});
 await tab(1).click();await expect(tab(1)).toHaveAttribute("aria-selected","true");
 // Unsaved TL1 input: switching asks first and never carries the value to TL2.
 await operator(page).fill("SYNTHETIC TL1 OPERATOR");
 await tab(2).click();
 await expect(page.getByRole("alert").filter({hasText:"Task List 1 มีข้อมูลแผนที่ยังไม่บันทึก"})).toBeVisible();
 await expect(tab(1)).toHaveAttribute("aria-selected","true");
 await page.getByRole("button",{name:"ทิ้งการแก้ไขและไป Task List 2"}).click();
 await expect(tab(2)).toHaveAttribute("aria-selected","true");
 await expect(page.getByRole("heading",{name:/ตำแหน่ง 17–32/})).toBeVisible();
 await expect(operator(page)).toHaveValue("");
 // Save distinct values per Task, then reload: every Task shows only its own values.
 for(const n of [2,3,1]){
  await tab(n).click();await fillPlannedDate(page,n);await operator(page).fill(`SYNTHETIC TL${n} OPERATOR`);
  await page.getByRole("button",{name:"บันทึกข้อมูลแผน"}).click();
  await expect(page.getByRole("status")).toContainText("บันทึกข้อมูลแผนแล้ว");
 }
 await page.reload();
 for(const n of [1,2,3]){await tab(n).click();await expect(operator(page)).toHaveValue(`SYNTHETIC TL${n} OPERATOR`);}
 const rows=await fixtureQuery<{sheet_number:number;planned_operator:string|null}>("SELECT sheet_number,planned_operator FROM lab_task_sheet WHERE batch_id=$1 ORDER BY sheet_number",[batchId]);
 expect(rows).toEqual([1,2,3].map(n=>({sheet_number:n,planned_operator:`SYNTHETIC TL${n} OPERATOR`})));
 await axe(page);
});

test("P0-2: Task tabs show per-Task counts, context card, BE dates, keyboard navigation and ?task= deep link",async({page})=>{
 test.setTimeout(150000);
 const cases=await readyCases(3);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const batchId=await freshBatch(page);
 const attempts=(await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)])).map(r=>r.id);
 const v=(await fixtureQuery<{version:number}>("SELECT version FROM lab_batch WHERE id=$1",[batchId]))[0].version;
 const assigned=await labPost(page,`/api/p4/batches/${batchId}`,{action:"assign",expectedVersion:v,attemptIds:attempts,queueOverrideReason:"จำลอง เลือกตัวอย่างของการทดสอบ P0"});
 expect(assigned.ok(),await assigned.text()).toBe(true);
 await page.goto(`/lab/batches/${batchId}`);
 const tab=(n:number)=>page.getByRole("tab",{name:new RegExp(`^Task List ${n}`)});
 await expect(tab(1)).toContainText("ผู้ป่วย 3/15 · ว่าง 12");
 await expect(tab(2)).toContainText("ผู้ป่วย 0/15 · ว่าง 15");await expect(tab(3)).toContainText("ผู้ป่วย 0/15 · ว่าง 15");
 await tab(1).click();
 const context=page.getByRole("region",{name:"สรุป Task List 1"});
 await expect(context).toContainText(/Run\d{3}\/\d{4} · Run\d{3} S1-1\/3 · Run\d{3} S2-1\/3/);
 await expect(context).toContainText("รอวันที่ปฏิบัติงาน");
 // BE input: a CE-looking year is refused with a clear message and cannot be saved.
 const date=page.getByLabel(/วันที่.*วางแผน/);await date.fill("17/10/2026");await date.blur();
 await expect(page.getByText("ใช้ปี พ.ศ. 4 หลัก เช่น 2569 (ไม่ใช่ ค.ศ.)")).toBeVisible();
 await expect(page.getByRole("button",{name:"บันทึกข้อมูลแผน"})).toBeDisabled();
 // BE in, ISO CE stored, BE shown back; the control ID stays Gregorian.
 await date.fill("17/10/2569");await date.blur();
 await page.getByLabel("Extraction Lot (ถ้าทราบ)").fill("SYN-EXT-01");
 const exp=page.getByLabel("Extraction Exp.");await exp.fill("31/12/2569");await exp.blur();
 await page.getByRole("button",{name:"บันทึกข้อมูลแผน"}).click();await expect(page.getByRole("status")).toContainText("บันทึกข้อมูลแผนแล้ว");
 await expect(context).toContainText("17/10/2569");await expect(context).toContainText("SYN-EXT-01 / Exp. 31/12/2569");
 await expect(context).toContainText("26N120261017-1");
 expect(await fixtureQuery("SELECT planned_work_date::text d,planned_extraction_expiry::text e FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1",[batchId])).toEqual([{d:"2026-10-17",e:"2026-12-31"}]);
 await page.reload();await expect(page.getByLabel(/วันที่.*วางแผน/)).toHaveValue("17/10/2569");
 // Keyboard: roving tabindex, arrows/Home/End, URL keeps the Task.
 await tab(1).focus();await page.keyboard.press("ArrowRight");
 await expect(tab(2)).toHaveAttribute("aria-selected","true");await expect(tab(2)).toBeFocused();await expect(page).toHaveURL(/\?task=2/);
 await page.keyboard.press("End");await expect(tab(3)).toHaveAttribute("aria-selected","true");
 await page.keyboard.press("Home");await expect(tab(1)).toHaveAttribute("aria-selected","true");
 await expect(tab(1)).toHaveAttribute("tabindex","0");await expect(tab(2)).toHaveAttribute("tabindex","-1");
 await page.goto(`/lab/batches/${batchId}?task=3`);await expect(tab(3)).toHaveAttribute("aria-selected","true");
 await expect(page.getByRole("heading",{name:/ตำแหน่ง 33–48/})).toBeVisible();
 await axe(page);
 // Worklist names the Task and deep-links to it.
 await page.goto("/lab");await page.getByRole("tab",{name:/อยู่ใน Batch/}).click();
 await page.getByLabel("ค้นหา LN / LN Halos / Sample ID / Run").fill(cases[0].ln);
 const link=page.getByRole("row",{name:new RegExp(cases[0].ln)}).getByRole("link",{name:/Task List 1 · ตน\. \d+/});
 await expect(link).toBeVisible();await expect(link).toHaveAttribute("href",new RegExp(`/lab/batches/${batchId}\\?task=1`));
});
/** Text of a downloaded PDF (pdfjs readback — the acceptance is on the PDF content, not on HTML or a screenshot). */
async function pdfText(path:string){
 const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const pdf=await getDocument({data:new Uint8Array(readFileSync(path)),useSystemFonts:true}).promise;
 const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);pages.push((await p.getTextContent()).items.map(x=>"str" in x?x.str:"").join(" "));}
 return {pages:pdf.numPages,text:pages.join("\n")};
}
async function api(page:Page,batchId:string,action:string,data:Record<string,unknown>){
 const v=(await fixtureQuery<{version:number}>("SELECT version FROM lab_batch WHERE id=$1",[batchId]))[0].version;
 const r=await labPost(page,`/api/p4/batches/${batchId}`,{action,expectedVersion:v,...data});expect(r.ok(),`${action}: ${await r.text()}`).toBe(true);
}

test("P0-5 / PDF acceptance: native Excel PDF per Task 1–3 carries only its own metadata, BE dates and CE control IDs",async({page})=>{
 test.setTimeout(900000);
 const cases=await readyCases(3);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const batchId=await freshBatch(page);
 const attempts=(await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)])).map(r=>r.id);
 await api(page,batchId,"assign",{attemptIds:attempts,queueOverrideReason:"จำลอง เลือกตัวอย่างของการทดสอบ P0"});
 // One sample per Task (moves within Draft; control slots untouched).
 await api(page,batchId,"move",{fromSlot:3,toSlot:18});await api(page,batchId,"move",{fromSlot:4,toSlot:34});
 const ids=await fixtureQuery<{slot_number:number;printed_sample_id:string}>("SELECT a.slot_number,t.printed_sample_id FROM lab_slot_assignment a JOIN analytical_attempt t ON t.id=a.attempt_id WHERE a.batch_id=$1 AND a.removed_at IS NULL ORDER BY a.slot_number",[batchId]);
 expect(ids.map(r=>r.slot_number)).toEqual([2,18,34]);
 const plan:Record<number,{date:string;be:string;op:string;lot:string;exp:string;expBe:string;control:string}>={
  1:{date:"2026-10-17",be:"17/10/2569",op:"SYNOPTL1",lot:"SYNEXT1",exp:"2026-12-31",expBe:"31/12/2569",control:"26N120261017-1"},
  2:{date:"2026-10-18",be:"18/10/2569",op:"SYNOPTL2",lot:"SYNEXT2",exp:"2027-01-31",expBe:"31/01/2570",control:"26N220261018-1"},
  3:{date:"2026-10-19",be:"19/10/2569",op:"SYNOPTL3",lot:"SYNEXT3",exp:"2027-02-28",expBe:"28/02/2570",control:"26N320261019-1"}};
 for(const n of [1,2,3]){const p=plan[n];
  await api(page,batchId,"updatePlan",{sheetNumber:n,plannedWorkDate:p.date,plannedOperator:p.op,plannedExtractionLot:p.lot,plannedExtractionExpiry:p.exp,plannedLibraryLot:null,plannedLibraryExpiry:null});
  await api(page,batchId,"planCheck",{sheetNumber:n,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});
  await api(page,batchId,"finalize",{sheetNumber:n});
 }
 const run=(await fixtureQuery<{run_label:string}>("SELECT run_label FROM lab_batch WHERE id=$1",[batchId]))[0].run_label;
 for(const n of [1,2,3]){const p=plan[n];
  await page.goto(`/lab/batches/${batchId}?task=${n}`);
  await expect(page.getByRole("region",{name:`สรุป Task List ${n}`})).toContainText(p.control);
  const [download]=await Promise.all([page.waitForEvent("download",{timeout:300000}),page.getByRole("button",{name:`ดาวน์โหลด PDF Task List ${n}`}).click()]);
  await expect(page.getByRole("status")).toContainText(`สร้าง PDF ของ Task List ${n} แล้ว (สำเนาตรวจทาน — ไม่ใช่เอกสารควบคุม)`);
  const saved=`.local/p0-e2e/evidence/${run.replace("/","-")}_Task-List-${n}.pdf`;await download.saveAs(saved); // kept as acceptance evidence (ignored by git)
  const {pages,text}=await pdfText(saved);
  expect(pages,`Task ${n} page count`).toBe(2);
  for(const s of [p.be,run,p.op,`${p.lot} / ${p.expBe}`,p.control,ids[n-1].printed_sample_id])expect(text,`Task ${n} must contain ${s}`).toContain(s);
  for(const m of [1,2,3].filter(m=>m!==n))for(const s of [plan[m].op,plan[m].lot,plan[m].control])expect(text,`Task ${n} must not contain Task ${m} value ${s}`).not.toContain(s);
  expect(text,"ISO dates must not appear in the document").not.toContain(p.date);
 }
});
test("P0-3: choosing a sample out of FIFO order shows the reason requirement before submitting; the user-chosen insertion is recorded",async({page})=>{
 test.setTimeout(150000);
 const cases=await readyCases(2);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 await fixtureQuery("UPDATE lab_batch SET state='Cancelled',cancelled_by=(SELECT id FROM app_user WHERE username='synthetic.lab'),cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'");
 await page.goto("/lab");
 const newest=page.getByRole("row",{name:new RegExp(cases[1].ln)});await expect(newest).toBeVisible();
 await newest.getByRole("checkbox").check();await page.getByRole("button",{name:/เพิ่มเข้า Batch \(1\)/}).click();
 const dialog=page.getByRole("dialog",{name:"เพิ่มตัวอย่างเข้า Batch"});
 await dialog.getByRole("button",{name:/สร้าง\/เปิด Batch ร่าง/}).click();await expect(dialog.getByLabel("Batch")).not.toHaveValue("");
 // The server preview (same rule as assign) says this selection overtakes FIFO.
 {const batchId=(await fixtureQuery<{id:string}>("SELECT id FROM lab_batch WHERE state='Draft' ORDER BY created_at DESC LIMIT 1"))[0].id;const attemptId=(await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=$1",[cases[1].roundId]))[0].id;
  const pv=await labPost(page,`/api/p4/batches/${batchId}`,{action:"previewAssign",attemptIds:[attemptId]});const body=await pv.text();expect(pv.ok(),body).toBe(true);expect(JSON.parse(body).reasonRequired,body).toBe(true);}
 // Before any submit: the reason field and the overtaken count are already shown.
 await expect(dialog.getByRole("note")).toContainText(/แซงลำดับ FIFO [1-9]\d* รายการที่รอก่อน — ผู้ใช้เลือกแทรกคิวได้/);
 await expect(dialog.getByLabel("เหตุผลที่แซงลำดับ FIFO (จำเป็น)")).toBeVisible();
 await expect(dialog.getByRole("button",{name:"ยืนยันเพิ่มเข้า Batch"})).toBeDisabled();
 await dialog.getByLabel("เหตุผลที่แซงลำดับ FIFO (จำเป็น)").fill("จำลอง ผู้ใช้เลือกแทรกคิว");
 await dialog.getByRole("button",{name:"ยืนยันเพิ่มเข้า Batch"}).click();
 await expect(dialog.getByRole("status")).toContainText("จัดเข้า Batch แล้ว 1 รายการ");
 expect(await fixtureQuery("SELECT e.reason FROM attempt_event e JOIN analytical_attempt a ON a.id=e.attempt_id WHERE a.round_id=$1 AND e.event_type='QUEUE_OVERRIDE'",[cases[1].roundId])).toEqual([{reason:"จำลอง ผู้ใช้เลือกแทรกคิว"}]);
 await axe(page);
});