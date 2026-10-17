import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";

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
/** Planned work date for Task n (the save button requires it). Day offset keeps the three Tasks distinct. */
async function fillPlannedDate(page:Page,n:number){await page.getByLabel(/วันที่.*วางแผน/).fill(`2026-10-${String(16+n).padStart(2,"0")}`);}

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
