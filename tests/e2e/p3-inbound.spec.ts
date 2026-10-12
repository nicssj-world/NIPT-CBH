import {test,expect,type Page} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-e2e-"+randomUUID()});});
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,username="synthetic.lab"){
 await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(username);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
const AA_TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
for(const width of [375,768,1280])test(`P3 inbound queue is accessible and responsive at ${width}px (Lab)`,async({page})=>{
 await page.setViewportSize({width,height:900});await login(page);
 await page.goto("/health");await page.getByRole("link",{name:"เปิดหน้ารับใบสั่งจาก HIS"}).click();
 await expect(page.getByRole("heading",{level:1,name:"รับใบสั่งจาก HIS"})).toBeVisible();
 for(const name of ["สถานะการเชื่อมต่อ","ไฟล์ล่าสุด","ประวัติการสแกน"])await expect(page.getByRole("heading",{name})).toBeVisible();
 await expect(page.getByRole("heading",{name:/รายการที่ต้องตรวจ/})).toBeVisible();
 await expect(page.getByRole("button",{name:"สแกนไฟล์จำลอง"})).toBeVisible();await expect(page.getByLabel("สแกนย้อนหลัง (Deep scan) จำนวนวัน")).toBeVisible();
 await expect(page.getByRole("button",{name:"ทดสอบการเชื่อมต่อตัวจำลอง"})).toHaveCount(0); // integration.configure is Admin/IT only
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
});
test("P3 inbound: Admin gets Test Connection but no LN-level PHI; ANC is denied",async({page,browser})=>{
 await login(page,"synthetic.admin");await page.goto("/inbound");
 await expect(page.getByRole("button",{name:"ทดสอบการเชื่อมต่อตัวจำลอง"})).toBeVisible();
 expect((await new AxeBuilder({page}).withTags(AA_TAGS).analyze()).violations).toEqual([]);
 const other=await browser.newContext({baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",extraHTTPHeaders:{"x-real-ip":"synthetic-e2e-"+randomUUID()}});
 const anc=await other.newPage();await login(anc,"synthetic.anc");await anc.goto("/inbound");await expect(anc.getByRole("heading",{level:1,name:"รับใบสั่งจาก HIS"})).toHaveCount(0);
 const me=await anc.request.get("/api/me").then(r=>r.json());
 expect((await anc.request.post("/api/p3/inbound/deep-scan",{headers:{"x-csrf-token":me.csrf,"content-type":"application/json"},data:{lookbackDays:5}})).status()).toBe(403);
 await other.close();
});
