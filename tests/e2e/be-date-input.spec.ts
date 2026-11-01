import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";

// Owner decision (Plan Rev 3.4 §7): BE date input with a real BE calendar (not a CE picker relabelled), keyboard and mobile.
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page){await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill("synthetic.lab");await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).not.toHaveURL(/\/login/);}
const fixtureQuery=async(sql:string)=>{const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{await db.query(sql);}finally{await db.end();}};
async function openPlanDate(page:Page){
 await fixtureQuery("UPDATE lab_batch SET state='Cancelled',cancelled_by=(SELECT id FROM app_user WHERE username='synthetic.lab'),cancelled_at=now(),cancel_reason='SYNTHETIC e2e isolation' WHERE state='Draft'");
 const token=(await page.context().cookies()).find(c=>c.name==="nipt_csrf")?.value??"";
 const r=await page.request.post("/api/p4/batches",{headers:{origin:new URL(page.url()).origin,"x-csrf-token":token,"content-type":"application/json"},data:{}});expect(r.ok()).toBe(true);
 await page.goto(`/lab/batches/${(await r.json()).batchId}?task=1`);return page.getByLabel(/วันที่.*วางแผน/);
}

test("BE calendar: BE heading/year list, keyboard grid, Enter selects, Esc closes, value round-trips; accessible",async({page})=>{
 await page.setViewportSize({width:1280,height:900});await login(page);const field=await openPlanDate(page);
 await field.fill("17/10/2569");await field.blur();await expect(field).toHaveValue("17/10/2569");
 await page.getByRole("button",{name:"เลือกวันที่จากปฏิทิน (พ.ศ.)"}).first().click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"ตุลาคม 2569"})).toBeVisible();
 await expect(dialog.getByLabel("ปี พ.ศ.")).toHaveValue("2569");
 expect(await dialog.getByLabel("ปี พ.ศ.").locator("option").allTextContents()).toContain("2570"); // a BE year list, not CE
 await expect(dialog.getByRole("button",{name:"17 ตุลาคม 2569"})).toBeFocused();
 await page.keyboard.press("ArrowRight");await expect(dialog.getByRole("button",{name:"18 ตุลาคม 2569"})).toBeFocused();
 await page.keyboard.press("PageDown");await expect(dialog.getByRole("heading",{name:"พฤศจิกายน 2569"})).toBeVisible();
 await axe(page);
 await page.keyboard.press("Enter");await expect(dialog).toHaveCount(0);await expect(field).toHaveValue("18/11/2569");
 await page.getByRole("button",{name:"เลือกวันที่จากปฏิทิน (พ.ศ.)"}).first().click();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect(field).toHaveValue("18/11/2569"); // Esc keeps the value
 // Year boundary and leap year through typing.
 await field.fill("29/02/2567");await field.blur();await expect(field).toHaveValue("29/02/2567");
 await field.fill("29/02/2569");await field.blur();await expect(page.getByText("วันที่นี้ไม่มีอยู่จริงในปฏิทิน")).toBeVisible();
});
test("BE date input on mobile (375 px): numeric keypad, no overflow, typed value saved as ISO and shown as BE after reload",async({page})=>{
 await page.setViewportSize({width:375,height:812});await login(page);const field=await openPlanDate(page);
 await expect(field).toHaveAttribute("inputmode","numeric");
 await field.fill("31/12/2569");await field.blur();
 await page.getByRole("button",{name:"บันทึกข้อมูลแผน"}).click();await expect(page.locator("[role=status]:not([popover])")).toContainText("บันทึกข้อมูลแผนแล้ว");
 await page.reload();await expect(page.getByLabel(/วันที่.*วางแผน/)).toHaveValue("31/12/2569");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await axe(page);
});
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
