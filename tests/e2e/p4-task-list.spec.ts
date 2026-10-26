import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {signInSyntheticBrowser} from "../helpers/browser-auth";
import {readFileSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
import {readArchive,sha256} from "../../packages/workbook/archive";
import {tx,setPendingPolicy,syntheticCase,receiveS1} from "../helpers/lab";
import type {Queryable} from "../../packages/db/connection";
import type {Principal} from "../../packages/security/policy";
import {buildSyntheticPet} from "../../packages/inbound/wire";
import {FileStore} from "../../packages/storage";

// P0 Task List remediation (Plan Rev 3.4). Synthetic data in the isolated P0 browser database only.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
async function login(page:Page,username:string){
 await signInSyntheticBrowser(page,username);
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
const operator=(page:Page)=>page.getByLabel("ผู้ปฏิบัติงาน",{exact:true});
/** Planned work date for Task n, typed in BE (dd/mm/yyyy) as a user would. Day offset keeps the three Tasks distinct. */
async function fillPlannedDate(page:Page,n:number){const f=page.getByLabel(/วันที่ทำ Library Preparation/);await f.fill(`${16+n}/10/2569`);await f.blur();}
/** Fixture owner plays HIS + P2 evidence and activates the labelled synthetic gate policy (same as p4-lab.spec.ts). */
async function readyCases(count:number,exportable=false,lnPrefix?:string){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const q=db as unknown as Queryable;
 try{
  const id=async(u:string)=>(await db.query<{id:string}>("SELECT id FROM app_user WHERE username=$1",[u])).rows[0].id;
  const p=(i:string,role:string)=>({id:i,roles:[role],unitIds:[],permissions:[]}) as unknown as Principal;
  const staff=p(await id("synthetic.lab"),"LAB_STAFF"),certifier=p(await id("synthetic.certifier"),"LAB_CERTIFIER"),approver=p(await id("synthetic.approver"),"CLINICAL_APPROVER");
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const active=(await db.query<{v:string|null}>("SELECT r.value->>'pendingGovernanceGate' v FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='laboratory'")).rows[0]?.v;
  if(active!=="PROCEED_SYNTHETIC_LABELLED")await setPendingPolicy(q,{certifier,approver},"PROCEED_SYNTHETIC_LABELLED");
  const cases=[];for(let i=0;i<count;i++){const c=await tx(q,t=>syntheticCase(t,{staff,unit},exportable||lnPrefix?{ln:`${lnPrefix??`99000${Date.now()}`}${String(i+1).padStart(2,'0')}`}:{ }));await tx(q,t=>receiveS1(t,c,new Date(Date.now()-(count-i)*60000)));cases.push(c);}
  return cases;
 }finally{await db.end();}
}
/** Owner XLSX export needs a synthetic PET and Request provenance, not only an S1 receipt row. */
async function readyExportCases(count:number){
 const cases=await readyCases(count,true),db=new Client({connectionString:browserFixtureDatabaseUrl()}),store=new FileStore(process.env.FILE_STORE_ROOT!);await db.connect();
 try{
  const labId=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.lab'")).rows[0].id;
  for(let i=0;i<cases.length;i++){
   const c=cases[i],hn=`990123456${i+1}`,pet=buildSyntheticPet({ln:c.ln,hn,name:"SYNTHETIC TASK EXPORT PATIENT",dob:"20000101",orderAt:"20261010070000",specimenAt:"20261010080000",receivedAt:"20261010100000"}),sha256=await store.put(pet.bytes);
   await db.query("INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)",[c.caseId,hn]);
   await db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Paper','Paper',$4)",[c.roundId,c.caseId,JSON.stringify({patient:{syntheticName:"SYNTHETIC TASK EXPORT PATIENT",dob:"2000-01-01"},pregnancy:{type:"Singleton",edd:"2027-03-24"}}),labId]);
   await db.query("UPDATE his_inbound_file f SET sha256=$2,filename=$3,ln=$4,state='Applied(S1)' FROM his_order o WHERE o.inbound_file_id=f.id AND o.round_id=$1",[c.roundId,sha256,pet.filename,c.ln]);
  }
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
  await expect(page.locator('[role="status"]:not([popover])')).toContainText("บันทึกข้อมูลแผนแล้ว",{timeout:15000});
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
 await expect(tab(1)).toContainText("ตัวอย่าง 3/15 · ว่าง 12");
 await expect(tab(2)).toContainText("ตัวอย่าง 0/15 · ว่าง 15");await expect(tab(3)).toContainText("ตัวอย่าง 0/15 · ว่าง 15");
 await tab(1).click();
 const context=page.getByRole("region",{name:"สรุป Task List 1"});
 await expect(context).toContainText(/Run\d{3}\/\d{4}[\s\S]*Run\d{3} S1-1\/3 · Run\d{3} S2-1\/3/);
 await expect(context).toContainText("รอวันที่ปฏิบัติงาน");
 // BE input: a CE-looking year is refused with a clear message and cannot be saved.
 const date=page.getByLabel(/วันที่ทำ Library Preparation/);await date.fill("17/10/2026");await date.blur();
 await expect(page.getByText("ใช้ปี พ.ศ. 4 หลัก เช่น 2569 (ไม่ใช่ ค.ศ.)")).toBeVisible();
 await expect(page.getByRole("button",{name:"บันทึกข้อมูลแผน"})).toBeDisabled();
 // BE in, ISO CE stored, BE shown back; the control ID stays Gregorian.
 await date.fill("17/10/2569");await date.blur();
 await page.getByLabel("Extraction Lot (ถ้าทราบ)").fill("SYN-EXT-01");
 const exp=page.getByLabel("Extraction Exp.");await exp.fill("31/12/2569");await exp.blur();
 await page.getByRole("button",{name:"บันทึกข้อมูลแผน"}).click();await expect(page.locator('[role="status"]:not([popover])')).toContainText("บันทึกข้อมูลแผนแล้ว",{timeout:15000});
 await expect(context).toContainText("17/10/2569");await expect(context).toContainText("SYN-EXT-01 / Exp. 31/12/2569");
 await expect(context).toContainText("26N120261017-1");
 expect(await fixtureQuery("SELECT planned_work_date::text d,planned_extraction_expiry::text e FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1",[batchId])).toEqual([{d:"2026-10-17",e:"2026-12-31"}]);
 await page.reload();await expect(page.getByLabel(/วันที่ทำ Library Preparation/)).toHaveValue("17/10/2569");
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
 await page.getByLabel("ค้นหา LN / HN / LN Halos / Sample ID / Run").fill(cases[0].ln);
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
  await expect(page.locator('[role="status"]:not([popover])')).toContainText(`สร้าง PDF ของ Task List ${n} แล้ว (สำเนาตรวจทาน — ไม่ใช่เอกสารควบคุม)`);
  const evidenceDir=process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence";const saved=path.join(evidenceDir,`${run.replace("/","-")}_Task-List-${n}.pdf`);await download.saveAs(saved); // kept as acceptance evidence (ignored by git)
  const {pages,text}=await pdfText(saved);
  expect(pages,`Task ${n} page count`).toBe(2);
  for(const s of [p.be,run,p.op,`${p.lot} / ${p.expBe}`,p.control,ids[n-1].printed_sample_id])expect(text,`Task ${n} must contain ${s}`).toContain(s);
  for(const m of [1,2,3].filter(m=>m!==n))for(const s of [plan[m].op,plan[m].lot,plan[m].control])expect(text,`Task ${n} must not contain Task ${m} value ${s}`).not.toContain(s);
  expect(text,"ISO dates must not appear in the document").not.toContain(p.date);
 }
 // Owner Task1: once a finalized Task PDF is available, the same workflow goes directly to QC Measurements.
 await page.goto(`/lab/batches/${batchId}/bench`);
 await expect(page.getByRole("heading",{name:run})).toBeVisible();
 await expect(page.getByRole("button",{name:"QC Measurements",exact:true})).toBeVisible();
});

test("T1-09: more than 50 authenticated Ready attempts paginate and remain searchable from the next page",async({page})=>{
 test.setTimeout(180000);
 const prefix=`99000${Date.now()}`,cases=await readyCases(55,false,prefix);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");await page.goto("/lab");
 // Keep exact 55-row/page-size assertions without modifying pre-existing integrated cases.
 await page.getByLabel("ค้นหา LN / HN / LN Halos / Sample ID / Run").fill(prefix);
 const summary=page.getByRole("status").filter({hasText:/แสดง 1–50 จาก 55 รายการ/});
 await expect(summary).toContainText("หน้า 1 จาก 2");
 const rows=page.getByRole("region",{name:"รายการงาน Lab"}).getByRole("row");
 await expect(rows).toHaveCount(51); // header + the 50 server-returned candidates
 await page.getByRole("button",{name:"หน้าถัดไป",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:/แสดง 51–55 จาก 55 รายการ/})).toContainText("หน้า 2 จาก 2");
 await expect(rows).toHaveCount(6); // header + five candidates, all from page 2
 const candidate=page.getByRole("row",{name:new RegExp(cases[54].ln)});
 await expect(candidate).toBeVisible();await candidate.getByRole("checkbox").check();
 await expect(page.getByText("เลือก 1 รายการ",{exact:true})).toBeVisible();
 const search=page.getByLabel("ค้นหา LN / HN / LN Halos / Sample ID / Run");
 await search.fill(cases[54].ln);await expect(page.getByRole("row",{name:new RegExp(cases[54].ln)})).toBeVisible();
 const pageEvidence={scope:"authenticated browser; real worklist API and isolated synthetic PostgreSQL",total:55,pageSize:50,page2Rows:5,selectedAttempt:cases[54].ln,search:"HIS LN"};
 await mkdir(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence",{recursive:true});
 await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-pagination-55.json"),JSON.stringify(pageEvidence,null,2));
});

test("T1-03/T1-06: urgent Slot 40 replaces the previous Ready sample without losing its lineage and the Task PDF is readable",async({page})=>{
 test.setTimeout(240000);
 const cases=await readyCases(2);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const ids=await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)]);
 expect(ids).toHaveLength(2);
 const batchId=await freshBatch(page);await page.goto(`/lab/batches/${batchId}?task=3`);
 const before=await page.request.get(`/api/p4/batches/${batchId}`).then(r=>r.json()) as {urgent40:boolean;sheets:{sheet_number:number;state:string;placement_revision:number}[];slots:{slot:number;assignment:unknown}[];allowed:{draft:boolean}};
 await mkdir(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence",{recursive:true});
 const slot40Toggle=page.getByLabel("ใช้ช่อง 40 สำหรับผู้ป่วย Urgent แทน BLANK (สูงสุด 46 ผู้ป่วย)");
 const toggleDom=await slot40Toggle.evaluate(el=>({checked:(el as HTMLInputElement).checked,disabled:(el as HTMLInputElement).disabled,outerHTML:el.outerHTML,parent:el.parentElement?.outerHTML}));
 await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-slot40-before.json"),JSON.stringify({urgent40:before.urgent40,sheet:before.sheets[2],slot40:before.slots.find(s=>s.slot===40),allowed:before.allowed,toggleDom},null,2));
 const toggleRequest=page.waitForResponse(r=>r.url().includes(`/api/p4/batches/${batchId}`)&&r.request().method()==="POST");
 await slot40Toggle.click();const toggleResponse=await toggleRequest;expect(toggleResponse.ok(),await toggleResponse.text()).toBe(true);
 await expect.poll(async()=>page.request.get(`/api/p4/batches/${batchId}`).then(r=>r.json()).then(x=>x.urgent40)).toBe(true);
 await expect(slot40Toggle).toBeChecked();
 // OWNER-LAB-035: the three fill forms are collapsed by default; open the urgent one first.
 const urgent=page.locator("details.task-exact-fill",{hasText:"Urgent Fill — งานด่วน"});await urgent.locator("summary").click();
 const fillUrgent=async(index:number)=>{
  await urgent.getByLabel("ค้นหา LN Halos / HIS LN / HN").fill(cases[index].ln);
  const sample=urgent.getByLabel("ตัวอย่างที่ผ่าน Gate");await expect(sample.locator(`option[value="${ids[index].id}"]`)).toHaveCount(1);await sample.selectOption(ids[index].id);
  await urgent.getByLabel("ตำแหน่งปลายทาง").selectOption("40");await urgent.getByLabel("เหตุผลงานด่วน / แทรกคิว").fill(`จำลอง T1-03 Urgent ${index+1}`);
  await urgent.getByRole("button",{name:"เพิ่มลงตำแหน่ง 40",exact:true}).click();
  await expect(page.getByRole("row",{name:/^40 /})).toContainText(cases[index].ln);
  const state=await page.request.get(`/api/p4/batches/${batchId}`).then(r=>r.json()) as {slots:{slot:number;assignment:{hisLn:string;printedSampleId:string|null}|null}[]};
  const assignment=state.slots.find(s=>s.slot===40)?.assignment;expect(assignment?.hisLn).toBe(cases[index].ln);expect(assignment?.printedSampleId).toBeTruthy();return assignment!.printedSampleId!;
 };
 const firstSampleId=await fillUrgent(0),secondSampleId=await fillUrgent(1);
 const oldPlacement=await fixtureQuery<{removed_at:string|null;removed_reason:string|null}>("SELECT removed_at::text,removed_reason FROM lab_slot_assignment WHERE batch_id=$1 AND slot_number=40 AND attempt_id=$2 ORDER BY assigned_at DESC LIMIT 1",[batchId,ids[0].id]);
 expect(oldPlacement).toEqual([{removed_at:expect.any(String),removed_reason:"จำลอง T1-03 Urgent 2"}]);
 expect(await fixtureQuery("SELECT state FROM analytical_attempt WHERE id=$1",[ids[0].id])).toEqual([{state:"Ready"}]);
 expect(await fixtureQuery("SELECT 1 FROM analytical_attempt a JOIN specimen_round r ON r.id=a.round_id JOIN case_ln l ON l.case_id=r.case_id WHERE a.id=$1 AND l.ln=$2",[ids[0].id,cases[0].ln])).toHaveLength(1);
 const ready=await page.request.get(`/api/p4/worklist?tab=READY&page=1&pageSize=50&q=${encodeURIComponent(cases[0].ln)}`).then(r=>r.json()) as {attempts:{attemptId:string;attemptState:string}[]};
 expect(ready.attempts).toContainEqual(expect.objectContaining({attemptId:ids[0].id,attemptState:"Ready"}));

 await api(page,batchId,"updatePlan",{sheetNumber:3,plannedWorkDate:"2026-10-24",plannedOperator:"SYNTHETIC T1 CLOSEOUT",plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
 await api(page,batchId,"planCheck",{sheetNumber:3,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});
 await api(page,batchId,"finalize",{sheetNumber:3});await page.goto(`/lab/batches/${batchId}?task=3`);
 await expect(page.getByRole("button",{name:"ดาวน์โหลด PDF Task List 3",exact:true})).toBeVisible();
 const [download]=await Promise.all([page.waitForEvent("download",{timeout:300000}),page.getByRole("button",{name:"ดาวน์โหลด PDF Task List 3",exact:true}).click()]);
 const out=path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-urgent-slot40.pdf");await download.saveAs(out);
 const read=await pdfText(out);expect(read.pages).toBe(2);expect(read.text).toContain(secondSampleId);expect(read.text).not.toContain(firstSampleId);
 await page.goto(`/lab/batches/${batchId}/bench`);await expect(page.getByRole("button",{name:"QC Measurements",exact:true})).toBeVisible();
 await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-urgent-displacement.json"),JSON.stringify({batchId,slot:40,displaced:{attemptId:ids[0].id,state:"Ready",hisLn:cases[0].ln,sampleId:firstSampleId},replacement:{attemptId:ids[1].id,hisLn:cases[1].ln,printedSampleId:secondSampleId},pdfPages:read.pages,pdfPath:out,finalizedTask:3},null,2));
});

test("T1-26: authenticated QC page maps all 48 positions and persists synthetic measurements",async({page})=>{
 test.setTimeout(240000);
 const cases=await readyCases(3);await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 const batchId=await freshBatch(page);
 const attempts=(await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)])).map(r=>r.id);
 await api(page,batchId,"assign",{attemptIds:attempts,queueOverrideReason:"จำลอง T1-26 QC mapping"});
 await api(page,batchId,"updatePlan",{sheetNumber:1,plannedWorkDate:"2026-10-24",plannedOperator:"SYNTHETIC T1-26",plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
 await api(page,batchId,"planCheck",{sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});
 await api(page,batchId,"finalize",{sheetNumber:1});
 await page.goto(`/lab/batches/${batchId}/bench`);await expect(page.getByRole("heading",{name:"QC Measurements",exact:true})).toBeVisible();
 const region=page.getByRole("region",{name:"QC 48 ตำแหน่ง"}),rows=region.getByRole("row");await expect(rows).toHaveCount(49);
 const mapping=await fixtureQuery<{slot_number:number;control_type:string|null;attempt_id:string|null;ln:string|null}>("SELECT b.slot_number,b.control_type,s.attempt_id,l.ln FROM lab_batch_slot b LEFT JOIN lab_slot_assignment s ON s.batch_id=b.batch_id AND s.slot_number=b.slot_number AND s.removed_at IS NULL LEFT JOIN analytical_attempt a ON a.id=s.attempt_id LEFT JOIN specimen_round r ON r.id=a.round_id LEFT JOIN case_ln l ON l.case_id=r.case_id WHERE b.batch_id=$1 AND (b.control_type IS NOT NULL OR s.attempt_id IS NOT NULL) ORDER BY b.slot_number",[batchId]);
 expect(mapping.map(x=>x.slot_number)).toEqual([1,2,3,4,25,40]);
 for(const position of Array.from({length:48},(_,i)=>i+1))await expect(rows.filter({has:page.getByRole("rowheader",{name:String(position),exact:true})})).toHaveCount(1);
 for(let i=0;i<cases.length;i++)await expect(rows.filter({hasText:cases[i].ln})).toContainText(`LN ${cases[i].ln}`);
 const measurements:Record<string,number>={"slot.1.libraryQc":20,"slot.2.libraryQc":20,"slot.3.libraryQc":20,"slot.4.libraryQc":20,"slot.25.libraryQc":20,"slot.40.libraryQc":0.5};
 for(let strip=1;strip<=3;strip++)for(const field of ["Standard 1","Standard 2","Standard 2 Conc."])await page.getByLabel(`Strip ${strip}/3 ${field}`,{exact:true}).fill("20");
 for(const [key,value] of Object.entries(measurements))await page.getByLabel(`ตำแหน่ง ${key.split(".")[1]} Concentration ng/µL`,{exact:true}).fill(String(value));
 await page.getByRole("button",{name:"บันทึกใบงาน",exact:true}).click();await expect(page.locator("footer").getByRole("status")).toContainText("บันทึกแล้ว กลับมาเปิดและทำงานต่อได้");
 await page.reload();
 const saved=await page.request.get(`/api/workbook/batches/${batchId}`).then(r=>r.json()) as {draft:{revision:number;values:Record<string,unknown>};values:Record<string,unknown>};
 for(const [key,value] of Object.entries(measurements))expect(saved.values[key],key).toBe(value);
 await mkdir(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence",{recursive:true});
 await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-qc-48-readback.json"),JSON.stringify({scope:"authenticated browser and isolated synthetic PostgreSQL",batchId,totalPositions:48,occupied:mapping,measurements,savedRevision:saved.draft.revision,readbackMatches:true},null,2));
});

test("T1-31: authenticated Seq Task-G50 save exports, downloads and reads back both same-revision XLSX files",async({page})=>{
 test.setTimeout(300000);
 const cases=await readyExportCases(3);await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");const batchId=await freshBatch(page);
 const attempts=(await fixtureQuery<{id:string}>("SELECT id FROM analytical_attempt WHERE round_id=ANY($1::uuid[]) ORDER BY (SELECT received_at FROM specimen_round r WHERE r.id=round_id)",[cases.map(c=>c.roundId)])).map(r=>r.id);
 await api(page,batchId,"assign",{attemptIds:attempts,queueOverrideReason:"จำลอง T1-31 Sequencing export"});
 await api(page,batchId,"move",{fromSlot:3,toSlot:18});await api(page,batchId,"move",{fromSlot:4,toSlot:34});
 for(const n of [1,2,3]){await api(page,batchId,"updatePlan",{sheetNumber:n,plannedWorkDate:"2026-10-24",plannedOperator:`SYNTHETIC T1-31 TL${n}`,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});await api(page,batchId,"planCheck",{sheetNumber:n,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});await api(page,batchId,"finalize",{sheetNumber:n});}
 const bench=`/api/lab-bench/batches/${batchId}`;
 const beforeQc=await page.request.get(bench).then(r=>r.json()) as {finalized:boolean;slots:unknown[]};expect(beforeQc.finalized,`expected all Task placements final; received ${beforeQc.slots.length} snapshot slots`).toBe(true);expect(beforeQc.slots).toHaveLength(48);
 await page.goto(`/lab/batches/${batchId}/bench`);await expect(page.getByRole("heading",{name:"QC Measurements",exact:true})).toBeVisible();
 const measurements:Record<string,number>={"slot.1.libraryQc":20,"slot.2.libraryQc":20,"slot.18.libraryQc":20,"slot.25.libraryQc":20,"slot.34.libraryQc":20,"slot.40.libraryQc":0.5};
 for(let strip=1;strip<=3;strip++)for(const field of ["Standard 1","Standard 2","Standard 2 Conc."])await page.getByLabel(`Strip ${strip}/3 ${field}`,{exact:true}).fill("20");
 for(const [key,value] of Object.entries(measurements))await page.getByLabel(`ตำแหน่ง ${key.split(".")[1]} Concentration ng/µL`,{exact:true}).fill(String(value));
 await page.getByRole("button",{name:"บันทึกใบงาน",exact:true}).click();await expect(page.locator("footer").getByRole("status")).toContainText("บันทึกแล้ว กลับมาเปิดและทำงานต่อได้");
 const stageButtons=page.locator('[role="group"][aria-label="เลือกใบงาน"] button');await expect(stageButtons).toHaveCount(3,{timeout:5000});await stageButtons.nth(1).click({timeout:5000});
 const calculate=page.getByRole("button",{name:"คำนวณ / โหลดค่าที่บันทึก",exact:true});await expect(calculate).toBeVisible({timeout:5000});await expect(calculate).toBeEnabled({timeout:5000});await calculate.click({timeout:5000});await expect(page.getByRole("region",{name:"ปริมาตร Pooling"})).toBeVisible();
 await page.getByLabel("Ref.Std dsDNA Standard 1",{exact:true}).fill("20");await page.getByLabel("Ref.Std dsDNA Standard 2",{exact:true}).fill("20");
 await page.getByLabel("Standard 2 Conc.",{exact:true}).fill("20");await page.getByLabel("Pool Library concentration (ng/µL)",{exact:true}).fill("3.33");
 for(const slot of [1,2,18,25,34]){const checkbox=page.locator(`input[aria-label="Pooling จริง ตำแหน่ง ${slot}"]`);await expect(checkbox).toBeVisible({timeout:5000});await checkbox.check({timeout:5000});}
 await page.getByRole("button",{name:"บันทึก Pooling จริง",exact:true}).click();await expect(page.locator("footer").getByRole("status")).toContainText("บันทึก Pooling จริงแล้ว");
 await stageButtons.nth(2).click();await expect(page.getByRole("heading",{name:"Seq Task-G50",exact:true})).toBeVisible();
 await page.getByLabel("ผู้ปฏิบัติงาน",{exact:true}).fill("SYNTHETIC T1-31 OPERATOR");await page.getByRole("button",{name:"บันทึกใบงาน",exact:true}).click();await expect(page.locator("footer").getByRole("status")).toContainText("บันทึกแล้ว กลับมาเปิดและทำงานต่อได้");
 const current=await page.request.get(bench).then(r=>r.json()) as {revision:number;values:Record<string,unknown>;slots:{slot:number;sampleId:string;hisLn:string|null;kind:string}[]};
 expect(current.values["seq.operator"]).toBe("SYNTHETIC T1-31 OPERATOR");
 const pairResponse=page.waitForResponse(r=>r.url()===new URL(bench,process.env.E2E_BASE_URL??"http://127.0.0.1:3000").href&&r.request().method()==="POST");
 await page.getByRole("button",{name:"ส่งออก XLSX 2 ไฟล์",exact:true}).click();const pairResponseResult=await pairResponse;expect(pairResponseResult.status()).toBe(200);
 const pair=await pairResponseResult.json() as {revision:number;files:{id:string;kind:string;sha256:string;filename:string}[]};expect(pair.revision).toBe(current.revision);expect(pair.files).toHaveLength(2);
 const panel=page.getByRole("region",{name:"ไฟล์ XLSX จากฉบับเดียวกัน"});await expect(panel).toBeVisible();await expect(panel).toContainText(`ใบงานฉบับ ${current.revision}`);
 const evidenceDir=process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence";await mkdir(evidenceDir,{recursive:true});
 const outputs=[] as {kind:string;filename:string;path:string;sha256:string;revision:number;sampleCheck:string}[];
 for(const kind of ["NIFTY Test Request XLSX","HALOS Task Import XLSX"]){
  const link=panel.getByRole("link",{name:new RegExp(kind)}),downloadPromise=page.waitForEvent("download");await link.click();const download=await downloadPromise,out=path.join(evidenceDir,`task1-${kind.startsWith("NIFTY")?"nifty":"halos"}-revision-${current.revision}.xlsx`);await download.saveAs(out);
  const bytes=await readFileSync(out),archive=readArchive(bytes),xml=[...archive.values()].map(x=>x.toString("utf8")).join("\n");expect(archive.has("xl/workbook.xml")).toBe(true);
  const checked=kind.startsWith("NIFTY")?current.slots.find(s=>s.kind==="PATIENT")!.hisLn!:current.slots.find(s=>s.kind==="PATIENT")!.sampleId;expect(xml).toContain(checked);
  const file=pair.files.find(f=>kind.startsWith("NIFTY")?f.kind==="NIFTY_XLSX":f.kind==="HALOS_TASK_XLSX");expect(file).toBeTruthy();expect(sha256(bytes)).toBe(file!.sha256);
  outputs.push({kind,filename:download.suggestedFilename(),path:out,sha256:sha256(bytes),revision:current.revision,sampleCheck:checked});
 }
 const readback=await page.request.get(bench).then(r=>r.json()) as {exports:{kind:string;sourceSha256?:string;current?:boolean}[]};
 expect(readback.exports.length).toBeGreaterThanOrEqual(2);
 await writeFile(path.join(evidenceDir,"task1-seq-task-g50-pair.json"),JSON.stringify({scope:"authenticated browser and isolated synthetic PostgreSQL",batchId,revision:current.revision,operator:current.values["seq.operator"],files:outputs,allSameRevision:outputs.every(f=>f.revision===current.revision),nativeXlsxReadback:true},null,2));
});

test("T1-50: Manual, Urgent and Repeat fills fit at all required viewports and the lightning icon stays on its title line",async({page})=>{
 test.setTimeout(120000);
 await login(page,"synthetic.lab");const batchId=await freshBatch(page);
 await mkdir(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence",{recursive:true});
 const measurements=[];
 for(const width of [1440,1280,768,375]){
  await page.setViewportSize({width,height:1000});await page.goto(`/lab/batches/${batchId}?task=3`);
  const regions=page.locator(".task-exact-fill");await expect(regions).toHaveCount(3);for(const region of await regions.all())await expect(region).toBeVisible();for(const region of await regions.all())await region.locator("summary").click(); // collapsed by default (OWNER-LAB-035)
  if(width===1440)await page.screenshot({path:path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-responsive-1440.png"),fullPage:false});
  const sample=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,areas:[...document.querySelectorAll<HTMLElement>(".task-exact-fill")].map(area=>{
   const b=area.getBoundingClientRect(),grid=area.querySelector<HTMLElement>(".form-grid")!,h=area.querySelector<HTMLElement>("summary")!,svg=h.querySelector("svg"),icon=svg?.getBoundingClientRect(),cs=getComputedStyle(h),fontSize=parseFloat(cs.fontSize),specifiedLineHeight=parseFloat(cs.lineHeight),lineHeight=Number.isFinite(specifiedLineHeight)?specifiedLineHeight:fontSize*1.5,heading=h.getBoundingClientRect(),headingHeight=heading.height;
   return {title:h.innerText,x:b.x,right:b.right,clientWidth:area.clientWidth,scrollWidth:area.scrollWidth,gridClientWidth:grid.clientWidth,gridScrollWidth:grid.scrollWidth,controls:[...area.querySelectorAll<HTMLElement>("input,select,button")].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,tag:e.tagName,label:e.getAttribute("aria-label")??e.getAttribute("id")}}),icon:icon?{x:icon.x,y:icon.y,right:icon.right,bottom:icon.bottom}:null,headingY:heading.y,headingHeight,lineHeight,titleLineCount:Math.ceil(headingHeight/lineHeight)};})}));
  await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence",`task1-responsive-${width}-debug.json`),JSON.stringify(sample,null,2));
  expect(sample.document,width+"px document overflow").toBeLessThanOrEqual(width);
  expect(sample.areas.map(a=>a.title)).toEqual(["เพิ่มตัวอย่าง — เลือกตำแหน่ง","Urgent Fill — งานด่วน","Repeat / Re-Sampling Fill"]);
  for(const a of sample.areas){expect(a.x,width+"px area left").toBeGreaterThanOrEqual(0);expect(a.right,width+"px area right").toBeLessThanOrEqual(width);expect(a.scrollWidth,width+"px area overflow").toBeLessThanOrEqual(a.clientWidth);expect(a.gridScrollWidth,width+"px grid overflow").toBeLessThanOrEqual(a.gridClientWidth);for(const c of a.controls){expect(c.x,width+"px control left").toBeGreaterThanOrEqual(a.x);expect(c.right,width+"px control right").toBeLessThanOrEqual(a.right);}}
  const urgent=sample.areas[1];expect(urgent.icon).not.toBeNull();expect(urgent.titleLineCount,width+"px urgent title lines").toBe(1);const iconCenter=(urgent.icon!.y+urgent.icon!.bottom)/2,headingCenter=urgent.headingY+urgent.headingHeight/2;expect(Math.abs(iconCenter-headingCenter),width+"px lightning/heading alignment").toBeLessThanOrEqual(4);
  measurements.push({width,documentWidth:sample.document,areas:sample.areas});
 }
 await writeFile(path.join(process.env.NIPT_E2E_P4_EVIDENCE_DIR??".local/p0-e2e/evidence","task1-responsive.json"),JSON.stringify({scope:"authenticated browser on real Task page; isolated synthetic backend/database",measurements},null,2));
});
test("P0-3: choosing a sample out of FIFO order shows the reason requirement before submitting; the user-chosen insertion is recorded",async({page})=>{
 test.setTimeout(150000);
 const cases=await readyCases(2);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");
 await fixtureQuery("UPDATE lab_batch SET state='Cancelled',cancelled_by=(SELECT id FROM app_user WHERE username='synthetic.lab'),cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'");
 await page.goto("/lab");
 // Earlier pagination fixtures can leave >50 synthetic Ready rows in this shared disposable DB.
 await page.getByLabel("ค้นหา LN / HN / LN Halos / Sample ID / Run").fill(cases[1].ln);
 const newest=page.getByRole("row",{name:new RegExp(cases[1].ln)});await expect(newest).toBeVisible({timeout:15000});
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
 // Owner Task1: a single manual addition must name an exact available slot.
 await dialog.getByLabel("ตำแหน่งที่ต้องการ").selectOption("2");
 await dialog.getByLabel("เหตุผลที่แซงลำดับ FIFO (จำเป็น)").fill("จำลอง ผู้ใช้เลือกแทรกคิว");
 await dialog.getByRole("button",{name:"ยืนยันเพิ่มเข้า Batch"}).click();
 await expect(dialog.locator('[role="status"]:not([popover])')).toContainText("จัดเข้า Batch แล้ว 1 รายการ");
 expect(await fixtureQuery("SELECT e.reason FROM attempt_event e JOIN analytical_attempt a ON a.id=e.attempt_id WHERE a.round_id=$1 AND e.event_type='QUEUE_OVERRIDE'",[cases[1].roundId])).toEqual([{reason:"จำลอง ผู้ใช้เลือกแทรกคิว"}]);
 await axe(page);
});
test("G07 + OD-B: 'เติมตัวอย่างจากคิว' previews then fills the selected Task from FIFO; DRAFT preview PDF before Finalize",async({page})=>{
 test.setTimeout(180000);
 await readyCases(3);
 await page.setViewportSize({width:1440,height:1000});await login(page,"synthetic.lab");await page.goto("/lab");
 const batchId=await freshBatch(page);
 await page.goto(`/lab/batches/${batchId}?task=2`);
 await expect(page.getByRole("tab",{name:/Task List 2/})).toHaveAttribute("aria-selected","true");
 await page.getByRole("button",{name:"เติมตัวอย่างจากคิว"}).click();
 const dialog=page.getByRole("dialog",{name:"เติมตัวอย่างจากคิว — Task List 2"});
 const summary=dialog.locator('[role="status"]:not([popover])').filter({hasText:"จะเติม"});await expect(summary).toBeVisible();
 const n=Number((await summary.innerText()).match(/จะเติม (\d+) รายการ/)![1]);expect(n).toBeGreaterThanOrEqual(3);expect(n).toBeLessThanOrEqual(15);
 const listed=await dialog.getByRole("row").count();expect(listed).toBe(n+1);
 await axe(page);
 await dialog.getByRole("button",{name:`ยืนยันเติม ${n} รายการ`}).click();
 await expect(page.locator('[role="status"]:not([popover])').filter({hasText:`เติมตัวอย่างจากคิวลง Task List 2 แล้ว ${n} รายการ`})).toBeVisible();
 // Placed only into Task 2 patient slots, never the NC control (25), in receive-time order; Task 1/3 untouched.
 const placed=await fixtureQuery<{slot_number:number;received_at:Date}>("SELECT s.slot_number,r.received_at FROM lab_slot_assignment s JOIN analytical_attempt a ON a.id=s.attempt_id JOIN specimen_round r ON r.id=a.round_id WHERE s.batch_id=$1 AND s.removed_at IS NULL ORDER BY s.slot_number",[batchId]);
 expect(placed).toHaveLength(n);expect(placed.every(p=>p.slot_number>=17&&p.slot_number<=32&&p.slot_number!==25)).toBe(true);
 expect(placed.map(p=>p.received_at.getTime())).toEqual([...placed.map(p=>p.received_at.getTime())].sort((a,b)=>a-b));
 await expect(page.getByRole("tab",{name:/Task List 2/})).toContainText(`ตัวอย่าง ${n}/15`);
 // OD-B: uncontrolled DRAFT preview of the not-yet-finalized Task.
  // labPdf opens the PDF with `noopener`, so it is intentionally not an opener-linked popup.
  const previewPage=page.context().waitForEvent("page");
 await page.getByRole("button",{name:"ดูตัวอย่าง PDF ฉบับร่าง (DRAFT)"}).click();
  await (await previewPage).close();
 const r=await labPost(page,`/api/p4/batches/${batchId}/draft-pdf`,{sheetNumber:2});
 expect(r.ok(),await r.text().catch(()=>"")).toBe(true);expect(r.headers()["content-type"]).toBe("application/pdf");expect(r.headers()["x-document-status"]).toBe("DRAFT_PREVIEW");
 expect((await r.body()).subarray(0,5).toString()).toBe("%PDF-");
 expect(await fixtureQuery("SELECT 1 FROM lab_document WHERE batch_id=$1",[batchId])).toEqual([]);
});
