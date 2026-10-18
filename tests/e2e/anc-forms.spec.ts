import {test,expect,type Page,type BrowserContext} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {rasterizePdf} from "../../tools/forms/rasterize";

// ANC fills the request once; "ดูตัวอย่างใบขอส่งตรวจ / ใบยินยอม / เอกสารรวม 2 หน้า" show it on the DCC Fm-WI-T-BM17/01 and /02 pages.
test.skip(!process.env.NIPT_ANC_FORM_REGISTRY,"ANC form registry (Owner DCC reference PDFs) not installed in this runner");
test.describe.configure({mode:"serial"});
const origin=process.env.E2E_BASE_URL??"http://127.0.0.1:3000",AA=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];
const evidence=process.env.NIPT_E2E_EVIDENCE_DIR??path.resolve(".local/p0-e2e/anc-forms-evidence");
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??"data/secrets/seed-password","utf8").trim();
async function login(page:Page,user:string){await page.goto("/login");await page.getByLabel("ชื่อผู้ใช้",{exact:true}).fill(user);await page.getByLabel("รหัสผ่าน",{exact:true}).fill(password());await page.getByRole("button",{name:"เข้าสู่ระบบ",exact:true}).click();await expect(page).toHaveURL(/\/$/);}
async function post(context:BrowserContext,url:string,data:unknown){const csrf=(await context.cookies()).find(c=>c.name==="nipt_csrf")?.value??"";return context.request.post(url,{headers:{origin,"x-csrf-token":csrf},data});}
async function as(browser:import("@playwright/test").Browser,user:string){const c=await browser.newContext({baseURL:origin,extraHTTPHeaders:{"x-real-ip":"synthetic-forms-"+randomUUID()}});const page=await c.newPage();await login(page,user);return {c,page};}
async function pdfLines(bytes:Buffer){const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");const doc=await getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;const out:{w:number;h:number;text:string}[]=[];
 for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),vp=p.getViewport({scale:1}),c=await p.getTextContent();const items=c.items.filter((i):i is typeof i&{str:string;transform:number[]}=>"str" in i&&!!i.str);
  out.push({w:vp.width,h:vp.height,text:items.sort((a,b)=>Math.round(b.transform[5])-Math.round(a.transform[5])||a.transform[4]-b.transform[4]).map(i=>i.str).join("").replace(/[\s\u0000่-๋]+/g,"")});}
 return out;}
const norm=(s:string)=>s.replace(/[\s่-๋]+/g,"");
let unitId="",doctorA="",doctorB="",caseId="";
const NAME_A="SYNTHETIC นพ.ทะเบียนแพทย์ หนึ่ง",NAME_B="SYNTHETIC พญ.ทะเบียนแพทย์ สอง",HN="00990"+String(Date.now()).slice(-6);

test.beforeAll(async({browser})=>{
 const admin=await as(browser,"synthetic.admin"),approver=await as(browser,"synthetic.approver");
 try{unitId=(await admin.c.request.get("/api/p2/doctors").then(r=>r.json())).units[0].id;
  const make=async(name:string)=>{const r=await post(admin.c,"/api/p2/doctors",{action:"propose",doctorKey:"SYNTHETIC-FORMS-"+String(Date.now()).slice(-8)+String(Math.floor(Math.random()*90+10)),name,unitId,effectiveFrom:"2026-01-01T00:00:00.000Z",authorization:"SYNTHETIC forms fixture",vector:{width:600,height:200,strokes:[[[20,20],[80,80],[150,40]]]}});expect(r.ok(),await r.text()).toBe(true);const id=(await r.json()).id;
   const ok=await post(approver.c,"/api/p2/doctors",{action:"approve",id,reason:"จำลอง: อนุมัติแพทย์สำหรับแบบฟอร์ม"});expect(ok.ok(),await ok.text()).toBe(true);return id as string;};
  doctorA=await make(NAME_A);doctorB=await make(NAME_B);
 }finally{await admin.c.close();await approver.c.close();}
});

test("ANC fills the request once; the three previews show it on the DCC pages with the registry doctor; nothing is invented or signed",async({page,browser})=>{
 test.setTimeout(240000);await mkdir(evidence,{recursive:true});
 await page.setViewportSize({width:1280,height:900});await login(page,"synthetic.anc");
 const reg=await post(page.context(),"/api/p2/register",{ln:"00990"+String(Date.now()).slice(-7),hn:HN,unitId,origin:"ANC",idempotencyKey:randomUUID()});expect(reg.ok()).toBe(true);caseId=(await reg.json()).caseId;
 await page.goto(`/cases/${caseId}`);
 const preview=async(kind:"request"|"consent"|"both")=>{const r=await page.request.get(`/api/p2/cases/${caseId}/forms?kind=${kind}`);expect(r.status()).toBe(200);expect(r.headers()["content-type"]).toBe("application/pdf");expect(r.headers()["x-document-status"]).toBe("DRAFT_PREVIEW");return {r,bytes:Buffer.from(await r.body())};};
 // 7. Before anything is entered: blank fields, missing count reported, no ticks/signatures (checked on the page image as evidence).
 const empty=await preview("request");expect(Number(empty.r.headers()["x-missing-fields"])).toBeGreaterThan(5);
 // 1–2. Fill once in the existing ANC request form, choosing the doctor from the Doctor Registry list.
 await page.getByRole("button",{name:"เปิดแบบขอส่งตรวจ 5 หมวด"}).click();
 await page.getByLabel("ชื่อผู้รับบริการจำลอง",{exact:false}).fill("จำลอง นางสาวพรรณรายสุดาวดีศรีสวัสดิ์ ณ อยุธยาวงศ์ไพบูลย์ทดสอบชื่อยาว");
 await page.getByLabel("วันเกิด",{exact:true}).fill("31/03/2539");await page.getByLabel("น้ำหนัก (กก.)",{exact:false}).fill("62.5");await page.getByLabel("ส่วนสูง (ซม.)",{exact:false}).fill("158");
 await page.getByLabel("แพทย์ผู้สั่งตรวจ",{exact:false}).selectOption(doctorA);
 await page.getByRole("button",{name:/^2\. การตั้งครรภ์/}).click();await page.getByLabel("กำหนดคลอด EDD",{exact:false}).fill("22/04/2570");await page.getByLabel("วันที่เจาะเลือด S1",{exact:false}).fill("10/10/2569");
 await page.getByRole("radiogroup",{name:"ที่มาวันเจาะ",exact:false}).locator('input[value="ANC"]').check();await page.getByRole("radiogroup",{name:"ประเภทครรภ์",exact:false}).locator('input[value="Singleton"]').check();
 await page.getByRole("radiogroup",{name:"Vanishing twin",exact:false}).locator('input[value="No"]').check();
 await page.getByRole("button",{name:"บันทึกร่าง / ลองใหม่"}).click();await expect(page.locator(".save-status")).toContainText("บันทึกแล้ว");await page.keyboard.press("Escape");
 // 3–4, 8–9. Buttons on the ANC page; PDF content matches the ANC record; same doctor on both forms; A4 1 + 1 = 2 pages.
 for(const name of ["ดูตัวอย่างใบขอส่งตรวจ","ดูตัวอย่างใบยินยอม","ดูเอกสารรวม 2 หน้า"])await expect(page.getByRole("link",{name})).toHaveAttribute("href",new RegExp(`/api/p2/cases/${caseId}/forms\\?kind=`));
 const [popup]=await Promise.all([page.waitForEvent("popup"),page.getByRole("link",{name:"ดูเอกสารรวม 2 หน้า"}).click()]);await popup.close();
 const both=await preview("both"),pages=await pdfLines(both.bytes);
 expect(pages.map(p=>[Math.round(p.w),Math.round(p.h)])).toEqual([[595,842],[595,842]]);
 for(const t of [HN,"62.5","158","25.0","Fm-WI-T-BM17/01",NAME_A])expect(pages[0].text,t).toContain(norm(t));
 for(const t of ["Fm-WI-T-BM17/02",NAME_A,"ยังไม่ได้ลงนาม"])expect(pages[1].text,t).toContain(norm(t));
 expect(both.r.headers()["x-consent-status"]).toBe("UNSIGNED");expect(both.r.headers()["x-dcc-status"]).toBe("REFERENCE_NOT_DCC_APPROVED");
 expect(pages[0].text).not.toContain(norm("ผู้ใช้จำลอง anc")); // the ANC user is never printed as the doctor
 const png=await rasterizePdf(both.bytes,1.6);await writeFile(path.join(evidence,"both-doctor-a-1.png"),png[0]);await writeFile(path.join(evidence,"both-doctor-a-2.png"),png[1]);
 // 5. Change the doctor on the request → both previews follow.
 await page.getByRole("button",{name:"เปิดแบบขอส่งตรวจ 5 หมวด"}).click();await page.getByLabel("แพทย์ผู้สั่งตรวจ",{exact:false}).selectOption(doctorB);
 await page.getByRole("button",{name:"บันทึกร่าง / ลองใหม่"}).click();await expect(page.locator(".save-status")).toContainText("บันทึกแล้ว");await page.keyboard.press("Escape");
 const changed=await pdfLines((await preview("both")).bytes);for(const p of changed){expect(p.text).toContain(norm(NAME_B));expect(p.text).not.toContain(norm(NAME_A));}
 // 6. Opening previews never changes the consent: still unsigned, no consent evidence created.
 const c=await page.request.get(`/api/p2/cases/${caseId}`).then(r=>r.json());expect(c.signatures).toEqual([]);expect(c.finalConsents).toEqual([]);
 const single=[await preview("request"),await preview("consent")];expect((await pdfLines(single[0].bytes)).length).toBe(1);expect((await pdfLines(single[1].bytes)).length).toBe(1);
 const pngs=[...await rasterizePdf(single[0].bytes,1.6),...await rasterizePdf(single[1].bytes,1.6)];await writeFile(path.join(evidence,"request-doctor-b.png"),pngs[0]);await writeFile(path.join(evidence,"consent-doctor-b-unsigned.png"),pngs[1]);
 await writeFile(path.join(evidence,"empty-request.png"),(await rasterizePdf(empty.bytes,1.6))[0]);
 expect((await new AxeBuilder({page}).withTags(AA).analyze()).violations).toEqual([]);
 // 11. Permissions: other roles follow document.request.read (the auditor cannot open case documents).
 const aud=await as(browser,"synthetic.auditor");try{expect((await aud.page.request.get(`/api/p2/cases/${caseId}/forms?kind=both`)).status()).toBe(403);}finally{await aud.c.close();}
 const lab=await as(browser,"synthetic.lab");try{expect((await lab.page.request.get(`/api/p2/cases/${caseId}/forms?kind=request`)).status()).toBe(200);}finally{await lab.c.close();}
});

test("Settings: the active template set chosen in Settings is the one the preview renders; an uninstalled set cannot be approved",async({browser})=>{
 test.setTimeout(180000);
 const cert=await as(browser,"synthetic.certifier"),approver=await as(browser,"synthetic.approver"),anc=await as(browser,"synthetic.anc");
 try{
  const choose=async(id:string)=>{await cert.page.goto("/settings?key=request_consent");await cert.page.getByLabel("ชุดแบบฟอร์มที่ใช้งาน (Request + Consent)").fill(id);
   await cert.page.getByLabel("เหตุผลที่เปลี่ยน").fill("จำลอง: เปลี่ยนชุดแบบฟอร์ม");await cert.page.getByRole("button",{name:"บันทึกร่าง",exact:true}).click();await expect(cert.page.getByRole("status").filter({hasText:"บันทึกร่างแล้ว"})).toBeVisible();
   await cert.page.getByRole("button",{name:"ทดสอบร่าง",exact:true}).first().click();await expect(cert.page.getByRole("status").filter({hasText:"ทดสอบร่างแล้ว"})).toBeVisible();};
  await choose("CBH-BM17-SECOND-SET");
  await approver.page.goto("/settings?key=request_consent");await approver.page.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"}).first().click();await approver.page.getByRole("button",{name:"เปิดใช้รุ่นที่อนุมัติแล้ว"}).first().click();
  await expect(approver.page.getByRole("status").filter({hasText:"บันทึกการเปลี่ยนแปลงแล้ว"})).toBeVisible();
  const r=await anc.page.request.get(`/api/p2/cases/${caseId}/forms?kind=request`);expect(r.headers()["x-template-set"]).toBe("CBH-BM17-SECOND-SET");
  expect((await pdfLines(Buffer.from(await r.body())))[0].text).toContain(norm("CBH-BM17-SECOND-SET"));
  // A set that is not installed fails the test, so nothing can be approved.
  await choose("CBH-NOT-INSTALLED");await expect(cert.page.getByText("ยังไม่ผ่านการทดสอบ").first()).toBeVisible();
  await approver.page.goto("/settings?key=request_consent");await expect(approver.page.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"})).toHaveCount(0);
  // Back to the reference set.
  await choose("CBH-BM17-REF-2026-10-18");await approver.page.goto("/settings?key=request_consent");await approver.page.getByRole("button",{name:"อนุมัติ (ผู้ตรวจอีกคน)"}).first().click();await approver.page.getByRole("button",{name:"เปิดใช้รุ่นที่อนุมัติแล้ว"}).first().click();
  await expect(approver.page.getByRole("status").filter({hasText:"บันทึกการเปลี่ยนแปลงแล้ว"})).toBeVisible();
  expect((await anc.page.request.get(`/api/p2/cases/${caseId}/forms?kind=request`)).headers()["x-template-set"]).toBe("CBH-BM17-REF-2026-10-18");
 }finally{await cert.c.close();await approver.c.close();await anc.c.close();}
});
