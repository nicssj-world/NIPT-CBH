import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync,existsSync} from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import iconv from "iconv-lite";

// Settings operational acceptance in the browser: Settings UI → Save → Worker test → second-person approval → Activate → the
// running Worker → an observable result. PET fixtures are the NIPTY_handover.zip request_pet samples, de-identified on the fly into
// the synthetic ranges (LN 99000+LN, HN 990+HN, surname SYNTHETIC+surname, ID SYNTHETIC-ID-n), keeping CP874, CRLF and field layout.
const FIX=process.env.NIPT_LEGACY_HANDOVER_FIXTURES_DIR,SHARE=process.env.NIPT_E2E_HIS_SHARE_ROOT;
test.skip(!FIX||!SHARE||!existsSync(path.join(FIX??"","MANIFEST.json")),"Needs the read-only ZIP fixture extraction and the runner's loopback test share");
test.describe.configure({mode:"serial"});
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({"x-real-ip":"synthetic-settings-"+randomUUID()});});
const AA=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,user:string){await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(user);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);}
async function post(context:BrowserContext,url:string,data:unknown){const csrf=(await context.cookies()).find(c=>c.name==="nipt_csrf")?.value??"";return context.request.post(url,{headers:{origin:process.env.E2E_BASE_URL??"http://127.0.0.1:3000","x-csrf-token":csrf},data});}
const manifest=()=>JSON.parse(readFileSync(path.join(FIX!,"MANIFEST.json"),"utf8")) as {archiveSha256:string;files:Record<string,{sha256:string}>};
function zipFile(rel:string){const b=readFileSync(path.join(FIX!,rel));if(createHash("sha256").update(b).digest("hex")!==manifest().files[rel]?.sha256)throw Error("FIXTURE_NOT_FROM_ZIP "+rel);return b;}
/** De-identified copy of ZIP case n (1-based); returns the synthetic identifiers so the test can register the matching case. */
function deidentifiedPet(n:number){
 const ln0=`26222700${String(n).padStart(2,"0")}`,rel=`samples/request_pet/${ln0}-7.pet`,lines=iconv.decode(zipFile(rel),"windows-874").split("\r\n");
 const p=lines[1].split("|"),o=lines[2].split("|"),ln="99000"+p[2],hn="990"+p[3];
 const [surname,rest]=p[5].split("^^");p[2]=ln;p[3]=hn;p[5]=`SYNTHETIC${surname}^^${rest}`;p[33]=`${p[33].split("^")[0]}^SYNTHETIC-ID-ZIP${n}`;o[2]=ln;lines[1]=p.join("|");lines[2]=o.join("|");
 return {ln,hn,filename:`${ln}-7.pet`,bytes:iconv.encode(lines.join("\r\n"),"windows-874"),ok:zipFile(rel.replace(".pet",".ok")),receivedAt:p[21]};
}
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}).replace(/-/g,"");
async function drop(folder:string,pet:ReturnType<typeof deidentifiedPet>){const dir=path.join(SHARE!,folder,today());await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,pet.filename),pet.bytes);await fs.writeFile(path.join(dir,pet.filename.replace(".pet",".ok")),pet.ok);}
// The revision list re-renders right after a save; a click that lands in that re-render is swallowed and queues nothing, so click inside the
// newest untested draft row and retry until the request to start the Worker test was actually sent.
async function testDraft(page:Page){await expect(async()=>{const button=page.getByRole("listitem").filter({hasText:"ยังไม่ผ่านการทดสอบ"}).first().getByRole("button",{name:"ทดสอบร่าง",exact:true});await expect(button).toBeVisible({timeout:5000});
 await Promise.all([page.waitForResponse(r=>r.url().includes("/api/settings")&&r.request().method()==="POST"&&r.ok(),{timeout:5000}),button.click({timeout:5000})]);}).toPass({timeout:30000});}
async function saveDraft(page:Page,reason:string){await page.getByLabel("เหตุผลที่เปลี่ยน").fill(reason);await page.getByRole("button",{name:"บันทึกร่าง",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"บันทึกร่างแล้ว"})).toBeVisible();}
/** Maker: Worker test of the newest draft, then record the pass. Checker: approve, then activate. */
async function workerTestAndRecord(page:Page,report?:RegExp){
 await testDraft(page);
 await expect(page.getByRole("status").filter({hasText:"เข้าคิวทดสอบที่ Worker แล้ว"})).toBeVisible();
 const record=page.getByRole("button",{name:"บันทึกผลทดสอบผ่านของร่างนี้"});await expect(record).toBeVisible({timeout:60000});
 if(report)await expect(page.getByText(report)).toBeVisible(); // the Worker's own report of what it read
 await record.click();
 await expect(page.getByText("ทดสอบผ่าน",{exact:true}).first()).toBeVisible();
}
async function approveAndActivate(checker:Page,key:string){
 await checker.goto(`/settings?key=${key}`);await checker.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"}).first().click();
 await checker.getByRole("button",{name:"เปิดใช้รุ่นที่อนุมัติแล้ว"}).first().click();await expect(checker.getByRole("status").filter({hasText:"บันทึกการเปลี่ยนแปลงแล้ว"})).toBeVisible();
}
let unitId="";
async function registerCase(context:BrowserContext,ln:string,hn:string){const r=await post(context,"/api/p2/register",{ln,hn,unitId,origin:"ANC",idempotencyKey:randomUUID()});expect(r.ok(),await r.text()).toBe(true);return (await r.json()).caseId as string;}
async function waitReceived(context:BrowserContext,ln:string,present=true){
 await expect.poll(async()=>{const w=await context.request.get("/api/p4/worklist").then(r=>r.json()) as {attempts:{hisLn:string;receivedAt:string|null}[]};return w.attempts.some(a=>a.hisLn===ln&&!!a.receivedAt);},{timeout:90000,intervals:[1000]}).toBe(present);
}

test("General: a name saved and activated in Settings is what every page shows after reload; invalid values say which field",async({page})=>{
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.admin");
 await page.goto("/settings?key=general");const name="NIPT CBH ทดสอบ "+String(Date.now()).slice(-5);
 await page.getByLabel("ชื่อระบบ").fill(name);await saveDraft(page,"Settings acceptance: system name");
 await testDraft(page);await page.getByRole("button",{name:"เปิดใช้",exact:true}).first().click();
 await expect(page.getByRole("status").filter({hasText:"บันทึกการเปลี่ยนแปลงแล้ว"})).toBeVisible();
 await page.goto("/");await expect(page.getByText(name).first()).toBeVisible();await page.reload();await expect(page.getByText(name).first()).toBeVisible();
 // Out-of-range value (Notifications): the refusal names the field, it is not a generic failure.
 await page.goto("/settings?key=notifications");const stale=page.getByLabel(/ถือว่า Worker ขาดการติดต่อเมื่อเกิน/);
 // Bypass the browser min check on purpose: the server still refuses and the page names the field.
 await stale.evaluate(e=>e.removeAttribute("min"));await stale.fill("30");
 await page.getByLabel("เหตุผลที่เปลี่ยน").fill("Out of range probe");await page.getByRole("button",{name:"บันทึกร่าง",exact:true}).click();
 await expect(page.getByRole("alert").filter({hasText:"ค่าที่กรอกไม่ถูกต้อง"})).toContainText("ถือว่า Worker ขาดการติดต่อเมื่อเกิน");
 expect((await new AxeBuilder({page}).withTags(AA).analyze()).violations).toEqual([]);
});

test("HIS inbound: path A → Worker reads the ZIP PET and the case is received; switch to path B; old path ignored; invalid path refused",async({page,browser})=>{
 test.setTimeout(300000);
 expect(manifest().archiveSha256).toBe("332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c");
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.admin");
 unitId=(await page.context().request.get("/api/p2/doctors").then(r=>r.json())).units[0].id;
 const ancContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{"x-real-ip":"synthetic-settings-anc-"+randomUUID()}});const anc=await ancContext.newPage();await login(anc,"synthetic.anc");
 const checkerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{"x-real-ip":"synthetic-settings-checker-"+randomUUID()}});const checker=await checkerContext.newPage();await login(checker,"synthetic.approver");
 const labContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{"x-real-ip":"synthetic-settings-lab-"+randomUUID()}});const lab=await labContext.newPage();await login(lab,"synthetic.lab");
 try{
  const [a,b,c]=[deidentifiedPet(1),deidentifiedPet(2),deidentifiedPet(3)];
  for(const p of [a,b,c])await registerCase(ancContext,p.ln,p.hn);
  await drop("in-a",a);
  // Path A through the Settings UI.
  await page.goto("/settings?key=his_inbound");
  await page.getByLabel("เปิดการสแกนอัตโนมัติ").check();await page.getByLabel("โฟลเดอร์ขาเข้า").fill(path.join(SHARE!,"in-a"));
  await page.getByLabel(/รอบการสแกน/).fill("5");await page.getByLabel(/สแกนย้อนหลัง/).fill("2");
  await saveDraft(page,"Settings acceptance: inbound folder A");await workerTestAndRecord(page,/Daily Folder: 1 · PET\/OK: 1/);
  await approveAndActivate(checker,"his_inbound");
  await waitReceived(labContext,a.ln);
  await page.reload();await expect(page.getByRole("region",{name:"Worker ขาเข้าที่กำลังทำงาน"})).toContainText(/Worker ใช้รุ่น \d+/,{timeout:20000});
  // Path B: a PET dropped into A afterwards is no longer read; B's PET is received.
  await drop("in-b",b);
  await page.getByLabel("โฟลเดอร์ขาเข้า").fill(path.join(SHARE!,"in-b"));await saveDraft(page,"Settings acceptance: inbound folder B");await workerTestAndRecord(page);
  await approveAndActivate(checker,"his_inbound");await drop("in-a",c);
  await waitReceived(labContext,b.ln);await lab.waitForTimeout(12000);await waitReceived(labContext,c.ln,false);
  await page.reload();await expect(page.getByRole("region",{name:"Worker ขาเข้าที่กำลังทำงาน"})).not.toContainText("ยังไม่ได้ใช้รุ่นที่เปิดใช้ล่าสุด",{timeout:20000});
  // Invalid path: the Worker test fails with a readable reason and there is nothing to approve.
  await page.getByLabel("โฟลเดอร์ขาเข้า").fill(path.join(SHARE!,"missing"));await saveDraft(page,"Settings acceptance: missing folder");
  await testDraft(page);
  await expect(page.getByText("ไม่พบ Path หรือไฟล์").first()).toBeVisible({timeout:60000});
  await expect(page.getByRole("button",{name:"บันทึกผลทดสอบผ่านของร่างนี้"})).toHaveCount(0);
  await checker.goto("/settings?key=his_inbound");await expect(checker.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"})).toHaveCount(0);
  // The receive time shown to the lab is the HIS receipt time from the PET (P[21]).
  const w=await labContext.request.get("/api/p4/worklist").then(r=>r.json()) as {attempts:{hisLn:string;receivedAt:string}[]};
  const at=a.receivedAt;expect(new Date(w.attempts.find(x=>x.hisLn===a.ln)!.receivedAt).toISOString()).toBe(new Date(`${at.slice(0,4)}-${at.slice(4,6)}-${at.slice(6,8)}T${at.slice(8,10)}:${at.slice(10,12)}:${at.slice(12,14)}+07:00`).toISOString());
  expect((await new AxeBuilder({page}).withTags(AA).analyze()).violations).toEqual([]);
 }finally{await ancContext.close();await checkerContext.close();await labContext.close();}
});

test("HIS outbound: destinations saved in Settings receive the Worker's synthetic RES/PDF/OK and backup; never reported as HIS confirmed",async({page,browser})=>{
 test.setTimeout(180000);
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.admin");
 await page.goto("/settings?key=his_outbound");
 await page.getByLabel("ปลายทาง RES / OK").fill(path.join(SHARE!,"res"));await page.getByLabel("ปลายทาง PDF / CFS").fill(path.join(SHARE!,"pdf"));await page.getByLabel("โฟลเดอร์สำรองไฟล์ส่ง").fill(path.join(SHARE!,"backup"));
 await page.getByLabel("เปิดการส่งผล").check();
 await saveDraft(page,"Settings acceptance: outbound destinations");
 await testDraft(page);
 await expect(page.getByText("RES / PDF / OK และ Backup ตรวจสอบแล้ว · HIS Confirmed: false")).toBeVisible({timeout:60000});
 const res=(await fs.readdir(path.join(SHARE!,"res"))).filter(f=>/\.res$/.test(f)),ok=(await fs.readdir(path.join(SHARE!,"res"))).filter(f=>/\.ok$/.test(f));
 expect(res.length).toBeGreaterThan(0);expect(ok.length).toBe(res.length);
 const bytes=await fs.readFile(path.join(SHARE!,"res",res[0]));expect(bytes.subarray(0,2)).toEqual(Buffer.from([0xff,0xfe]));
 expect(await fs.readFile(path.join(SHARE!,"res",ok[0]))).toEqual(zipFile("samples/result_res/2622270001105.ok")); // .ok = ff fe, as in the ZIP
 expect((await fs.readdir(path.join(SHARE!,"pdf"))).some(f=>f.endsWith(".pdf"))).toBe(true);
 // A destination outside the authorised root fails its Worker test, with the reason on screen.
 await page.getByLabel("ปลายทาง PDF / CFS").fill(path.join(path.dirname(SHARE!),"not-authorised-cfs"));await saveDraft(page,"Settings acceptance: wrong destination");
 await testDraft(page);
 await expect(page.getByText("Path อยู่นอก Allowed Root หรืออนุญาตซ้ำกัน").first()).toBeVisible({timeout:60000});
 const checkerContext=await browser.newContext({baseURL:process.env.E2E_BASE_URL,extraHTTPHeaders:{"x-real-ip":"synthetic-settings-checker2-"+randomUUID()}});
 try{const checker=await checkerContext.newPage();await login(checker,"synthetic.approver");await checker.goto("/settings?key=his_outbound");await expect(checker.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"})).toHaveCount(0);}finally{await checkerContext.close();}
 expect((await new AxeBuilder({page}).withTags(AA).analyze()).violations).toEqual([]);
});
