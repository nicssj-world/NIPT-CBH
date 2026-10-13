// Regression: the propose button must not be usable before /api/p2/doctors (units) has loaded; the API is delayed to make the race deterministic.
// Named zz- so the pending proposal it leaves does not precede other doctor assertions.
import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-race-"+randomUUID()});});
async function draw(page:Page){await page.locator("canvas").scrollIntoViewIfNeeded();const b=(await page.locator("canvas").boundingBox())!;await page.mouse.move(b.x+b.width*.15,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.4,b.y+b.height*.25,{steps:8});await page.mouse.move(b.x+b.width*.65,b.y+b.height*.65,{steps:8});await page.mouse.up();}
test("propose doctor while the doctor list is still loading",async({page})=>{
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill("synthetic.admin");await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
 await page.route("**/api/p2/doctors",async route=>{if(route.request().method()==="GET")await new Promise(r=>setTimeout(r,1500));await route.continue();});
 await page.goto("/doctors");await page.getByRole("button",{name:"เสนอแพทย์ / รุ่นลายเซ็นใหม่",exact:true}).click();
 await page.getByLabel("รหัสแพทย์จำลอง",{exact:false}).fill("SYNTHETIC-RACE-"+Date.now());await page.getByLabel("ชื่อแพทย์จำลอง",{exact:false}).fill("จำลอง: แพทย์ race");await page.getByLabel("วันเวลามีผล",{exact:false}).fill("2026-01-01T00:00");await page.getByLabel("หลักฐานการอนุญาตจำลอง",{exact:false}).fill("SYNTHETIC race authorization");await draw(page);
 await page.getByRole("button",{name:"เสนอเพื่อให้คนที่สองอนุมัติ",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
});
