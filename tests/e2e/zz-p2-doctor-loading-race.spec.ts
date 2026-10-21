// Regression: creating a doctor must wait for /api/p2/doctors to load its authorized unit list.
import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-race-"+randomUUID()});});
async function draw(page:Page){await page.locator("canvas").scrollIntoViewIfNeeded();const b=(await page.locator("canvas").boundingBox())!;await page.mouse.move(b.x+b.width*.15,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.4,b.y+b.height*.25,{steps:8});await page.mouse.move(b.x+b.width*.65,b.y+b.height*.65,{steps:8});await page.mouse.up();}
test("doctor registration waits for the authorized unit list before opening",async({page})=>{
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill("synthetic.admin");await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
 await page.route("**/api/p2/doctors",async route=>{if(route.request().method()==="GET")await new Promise(r=>setTimeout(r,1500));await route.continue();});
 const ready=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/p2/doctors"&&r.request().method()==="GET");
 await page.goto("/doctors");const add=page.getByRole("button",{name:"เพิ่มแพทย์",exact:true});await expect(add).toBeDisabled();
 const response=await ready;expect(response.ok()).toBe(true);await expect(add).toBeEnabled();await add.click();
 const key="SYNTHETIC-RACE-"+Date.now();await page.getByLabel("รหัสแพทย์",{exact:false}).fill(key);await page.getByRole("textbox",{name:"ชื่อแพทย์ จำเป็น",exact:true}).fill("จำลอง: แพทย์ race");
 const unit=page.getByLabel("หน่วยงานแพทย์",{exact:false});await expect(unit.locator("option").filter({hasNotText:"เลือกหน่วยงาน"})).not.toHaveCount(0);await unit.selectOption({index:1});
 await page.getByLabel("วิธีนำเข้าลายเซ็นแพทย์",{exact:false}).selectOption("draw");await draw(page);
 await page.getByRole("button",{name:"บันทึกแพทย์",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByRole("status").filter({hasText:"บันทึกแล้ว"})).toContainText("บันทึกแล้ว");
 const registry=await page.request.get("/api/p2/doctors").then(r=>r.json());expect(registry.doctors.some((d:{doctor_key:string})=>d.doctor_key===key)).toBe(true);
});
