import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username="synthetic.lab"){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await expect(page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true})).toBeEnabled();await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
for(const width of [375,768,1280,1440])test(`responsive Thai foundation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page);
 for(const route of ["/","/cases","/health","/settings"]){await page.goto(route);await expect(page.locator("h1")).toBeVisible();if(route==="/settings")await expect(page.getByRole("navigation",{name:"หมวดการตั้งค่า"})).toContainText("ทั่วไป");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const results=await new AxeBuilder({page}).withTags(AA_TAGS).analyze();expect(results.violations).toEqual([]);
 }
 // Other specs register cases in the shared database before this one, so look only at the three seeded cases (LN 99000000000N) instead of assuming a pristine registry.
 await page.goto("/cases");await expect(page.getByRole("heading",{name:"ทะเบียนกลาง",exact:true})).toBeVisible();await page.getByLabel("ค้นหา LN หรือ HN",{exact:true}).fill("99000000000");await page.getByRole("button",{name:"ค้นหา",exact:true}).click();await expect(page.locator(".registry-row")).toHaveCount(3);if(process.env.E2E_SKIP_VISUAL!=="1")await expect(page).toHaveScreenshot(`registry-${width}.png`,{fullPage:true,animations:"disabled"});
});
test("authentication, protected APIs, origin CSRF and admin has no clinical access",async({page,request})=>{
 expect((await request.get("/api/me")).status()).toBe(401);
 expect((await request.post("/api/auth/login",{data:{username:"synthetic.admin",password:password(),csrf:"invalid"}})).status()).toBe(403);
 await login(page,"synthetic.admin");await page.goto("/cases");await expect(page.getByText("ยังไม่มีข้อมูลในขอบเขตสิทธิ์ของคุณ")).toBeVisible();
 const me=await page.request.get("/api/me").then(r=>r.json());expect((await page.request.post("/api/settings",{headers:{origin:"https://evil.invalid","x-csrf-token":me.csrf},data:{operation:"propose",key:"general",value:{systemName:"Bad",timezone:"Asia/Bangkok"},reason:"SYNTHETIC"}})).status()).toBe(403);
 expect(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length)).toBe(0);
 await page.getByRole("button",{name:"ออกจากระบบ"}).click();await expect(page).toHaveURL(/\/login$/);expect((await page.request.get("/api/me")).status()).toBe(401);
});
test("login keyboard, password manager, error and recovery",async({page})=>{
 await page.goto("/login");await page.keyboard.press("Tab");await expect(page.getByText("ข้ามไปเนื้อหาหลัก")).toBeFocused();
 const result=await new AxeBuilder({page}).withTags(AA_TAGS).analyze();expect(result.violations).toEqual([]);
 await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill("synthetic.unknown");await page.getByLabel("รหัสผ่าน",{exact:true}).fill("incorrect");await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page.locator("p[role=alert]")).toContainText("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
 await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill("synthetic.lab");await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
});
test("case round details and session-bound PDF byte reuse",async({page,browser})=>{
 await login(page);await page.goto("/cases");await page.getByRole("link",{name:/ดูรายละเอียด/}).first().click();await expect(page.getByRole("heading",{name:"ประวัติรอบตัวอย่าง"})).toBeVisible();
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
 // The /health page no longer carries the P1 "สร้าง PDF ทดสอบ" button (replaced by the governed health console in 0fd4a89); the session-bound preview API behind it is unchanged, so it is exercised directly.
 await page.goto("/health");const me=await page.request.get("/api/me").then(r=>r.json());
 const created=await page.request.post("/api/pdf/preview",{headers:{"x-csrf-token":me.csrf,origin:process.env.E2E_BASE_URL??"http://127.0.0.1:3000"},data:{synthetic:true,reference:"SYNTHETIC-FOUNDATION",label:"ตัวอย่างเอกสารภาษาไทยสำหรับทดสอบระบบ"}});expect(created.ok()).toBe(true);const href=`/api/pdf/preview/${(await created.json()).id}`;
 const a=await page.request.get(href),b=await page.request.get(href);expect(a.ok()).toBe(true);expect((await a.body()).equals(await b.body())).toBe(true);
 const other=await browser.newContext({ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});const otherPage=await other.newPage();await login(otherPage,"synthetic.anc");expect((await other.request.get(new URL(href,process.env.E2E_BASE_URL??"http://127.0.0.1:3000").href)).status()).toBe(403);await other.close();
});
test("axe gate rejects real minor and moderate A/AA violations",async({page})=>{
 await page.goto("/login");
 // WCAG 1.4.4 moderate and 4.1.2 minor. No impact filter is allowed in CI.
 await page.evaluate(()=>{document.querySelector('meta[name="viewport"]')?.setAttribute("content","width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");const el=document.createElement("div");el.setAttribute("role","directory");el.textContent="Injected accessibility negative fixture";document.body.append(el);});
 const result=await new AxeBuilder({page}).withTags(AA_TAGS).analyze();expect(result.violations.some(v=>v.id==="meta-viewport"&&v.impact==="moderate")).toBe(true);expect(result.violations.some(v=>v.id==="aria-deprecated-role"&&v.impact==="minor")).toBe(true);
 expect(result.violations.length).toBeGreaterThan(0);
});
