import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseReport} from '../../packages/results/parser';
import {extract} from '../../packages/results/extract';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';

const password=()=>readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim();
async function login(page:Page){
 await page.setExtraHTTPHeaders({'x-real-ip':'synthetic-task1-'+randomUUID()});
 // Authenticate through the real CSRF/login API; Login UI is outside Task1.
 const csrfResponse=await page.request.get('/api/auth/csrf');expect(csrfResponse.ok()).toBe(true);const csrf=(await csrfResponse.json()).csrf;
 const response=await page.request.post('/api/auth/login',{headers:{origin:new URL(process.env.E2E_BASE_URL??'http://127.0.0.1:3000').origin},data:{username:'synthetic.lab',password:password(),csrf}});expect(response.ok()).toBe(true);await page.goto('/');
}
async function freshBatch(page:Page){const token=(await page.context().cookies()).find(c=>c.name==='nipt_csrf')?.value??'';const r=await page.request.post('/api/p4/batches',{headers:{origin:new URL(page.url()).origin,'x-csrf-token':token},data:{}});expect(r.ok(),await r.text()).toBe(true);return (await r.json()).batchId as string;}
const evidence=path.resolve(process.env.NIPT_TASK1_UI_EVIDENCE_DIR??'.local/task1-ui-evidence');

test('Task1 external No Call displays actual parsed Result and failed QC with existing confirmations',async({page})=>{
 await login(page);const id=randomUUID(),pdf=syntheticReportPdf({kind:'SINGLETON',labNumber:'26B261023001R-1',hn:'990000001',collection:'23-Oct-2026',result:'No Call',qc:'FAIL',sex:null}),read=await extract(pdf);
 if(read.container==='ZIP_BATCH')throw Error('PDF_REQUIRED');const parsed=parseReport(read.text);
 // Render real extracted PDF facts through the actual component; clinical release is independently DB-tested.
 let submitted:Record<string,unknown>|null=null;
 const detail={operational:true,nameConflicts:[],version:{id,kind:'RESULT',templateKind:'SINGLETON',templateVersion:parsed.templateVersion,parserVersion:parsed.parserVersion,state:'ValidationBlocked',rowVersion:1,sha256:'a'.repeat(64),importedAt:'2026-10-24T00:00:00Z',roundId:randomUUID(),supersedesId:null},parsed,intake:{source:'UPLOAD',relative_path:null,original_name:'synthetic-no-call.pdf',member_name:null,size:pdf.length,container:'PDF'},target:null,proposal:null,candidates:[],gate:null,events:[],links:[],gates:[],reviews:[],autoMatch:null,can:{propose:false,decide:false,unlink:false,review:false,certify:false,void:false,acceptRelease:true},benchEvidence:{batchId:randomUUID(),runLabel:'SYNTHETIC',slot:2,revision:1,current:true,concentration:1,qcStandardCount:0,poolConcentration:null,sourceSha256:'b'.repeat(64),ownerPaperRoute:true}};
 await page.route(`**/api/p5/results/${id}`,async r=>{if(r.request().method()==='GET')await r.fulfill({json:detail});else {submitted=r.request().postDataJSON();await r.fulfill({json:{outcome:'BLOCKED',failed:['RG-06:NO_CALL_CURRENT_FAILED_ATTEMPT_AND_REVIEW_REQUIRED'],pending:[]}});}});
 await page.goto(`/results/${id}`);await expect(page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Result',exact:true})})).toContainText('No Call');
 await expect(page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'RESULTS QC',exact:true})})).toContainText('FAIL');
 await expect(page.getByLabel(/ตรวจทานค่าจริง QC1/)).toHaveCount(0);
 const send=page.getByRole('button',{name:'ตรวจรับและยืนยันส่งผล',exact:true});await expect(send).toBeDisabled();
 await page.getByLabel('รายงานฉบับนี้เป็น Final ที่ผ่านการรับรองจากระบบวิเคราะห์ภายนอกแล้ว').check();await expect(send).toBeDisabled();
 await page.getByLabel('ตรวจตัวตนผู้ป่วย (LN/HN/ชื่อ/วันเกิด) และค่าทุกค่าตรงกับ PDF ต้นฉบับแล้ว').check();await expect(send).toBeDisabled();
 await page.getByLabel('ตรวจความยินยอมและข้อมูลที่เปิดเผยในรายงานแล้ว').check();await expect(send).toBeEnabled();
 await send.click();await expect(page.getByText('ยังส่งผลไม่ได้',{exact:true})).toBeVisible();
 expect(submitted).toMatchObject({externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true});expect(submitted).not.toHaveProperty('benchMeasurementsReviewed');
 await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'no-call-review.png'),fullPage:true});
});

test('Task1 QC2 actual component aligns inputs and keeps warning below on desktop/mobile',async({page})=>{
 await login(page);const id=await freshBatch(page);
 // Synthetic API fixture isolates the rendered component; it does not claim execution/QC acceptance.
 await page.route(`**/api/lab-bench/batches/${id}`,async route=>route.fulfill({json:{batchId:id,runLabel:'Run001/2569',version:1,revision:1,values:{'pool.standard2Concentration':10,'pool.concentration':3.2},automaticKeys:[],sourceStale:false,finalized:true,actualPooling:null,canRepeat:true,canRedraw:true,canNoCall:true,slots:[],seqFields:[],exports:[]}}));
 await page.goto(`/lab/batches/${id}/bench`);await page.getByRole('button',{name:'Pooling / QC2 / F4',exact:true}).click();await expect(page.getByRole('heading',{name:'QC2 หลัง Pooling'})).toBeVisible();
 const grid=page.locator('.lab-bench-qc2');const warning=grid.locator('.lab-bench-qc2-help');await expect(warning).toHaveText('เกณฑ์ของความเข้มข้น Pooling DNA Library คือ 3.00-3.60 ng/ul');
 const results=[];
 for(const width of [1440,1280,768,375]){
  await page.setViewportSize({width,height:1000});await grid.evaluate(el=>el.scrollIntoView({block:'start'}));
  const first=grid.getByRole('spinbutton',{name:'Standard 2 Conc.',exact:true}),second=grid.getByRole('spinbutton',{name:'Pool Library concentration (ng/µL)',exact:true});
  const a=(await first.boundingBox())!,b=(await second.boundingBox())!,helper=(await warning.boundingBox())!;
  expect(a.height).toBe(b.height);expect(helper.y).toBeGreaterThanOrEqual(b.y+b.height);
  if(width>600)expect(a.y).toBe(b.y);else expect(b.y).toBeGreaterThan(a.y+a.height);
  expect(await grid.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await mkdir(evidence,{recursive:true});await grid.screenshot({path:path.join(evidence,`qc2-${width}.png`)});results.push({width,standard2:a,pool:b,helper});
 }
 // Label row grows with long Thai text while both numeric boxes retain one shared input row.
 await page.setViewportSize({width:1280,height:1000});await grid.locator('.lab-bench-qc2-field').nth(3).locator('span').first().evaluate(el=>el.textContent='ความเข้มข้นของ Pool Library หลังการรวมตัวอย่าง สำหรับการบันทึกการปฏิบัติงาน (ng/µL)');
 const longLabel=await grid.locator('.lab-bench-qc2-field > input').evaluateAll(nodes=>nodes.slice(2).map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
 expect(longLabel[0]).toEqual(longLabel[1]);await writeFile(path.join(evidence,'qc2-dom.json'),JSON.stringify({scope:'Actual LabBench UI with synthetic API fixture; not clinical execution evidence',results,longLabel},null,2));
});

test('Task1 draft displays separate exact-slot manual, urgent and repeat areas with protected controls',async({page})=>{
 await login(page);const id=await freshBatch(page);await page.goto(`/lab/batches/${id}`);
 await expect(page.getByRole('region',{name:'เพิ่มตัวอย่าง — เลือกตำแหน่ง'})).toBeVisible();await expect(page.getByRole('region',{name:'Urgent Fill — งานด่วน'})).toBeVisible();await expect(page.getByRole('region',{name:'Repeat / Re-Sampling Fill'})).toBeVisible();
 const manual=page.getByRole('region',{name:'เพิ่มตัวอย่าง — เลือกตำแหน่ง'});await expect(manual.getByLabel('ตำแหน่งปลายทาง')).toHaveValue('');await expect(manual.getByRole('button',{name:'เพิ่มลงตำแหน่ง ที่เลือก'})).toBeDisabled();
 const targets=await manual.getByLabel('ตำแหน่งปลายทาง').locator('option').evaluateAll(nodes=>nodes.map(el=>(el as HTMLOptionElement).value));expect(targets).not.toContain('1');expect(targets).not.toContain('25');expect(targets).not.toContain('40');
});

test('Task1 QC patient actions are independent and external No Call waiting removes repeat/redraw actions',async({page})=>{
 await login(page);const id=await freshBatch(page);let waiting=false;
 const fixture=()=>({batchId:id,runLabel:'Run001/2569',version:1,revision:1,values:{},automaticKeys:[],sourceStale:false,finalized:true,actualPooling:null,canRepeat:true,canRedraw:true,canNoCall:true,slots:[{slot:2,sheet:1,kind:'PATIENT',attemptId:'11111111-1111-4111-8111-111111111111',caseId:'22222222-2222-4222-8222-222222222222',roundId:'33333333-3333-4333-8333-333333333333',roundNumber:2,hisLn:'990001000001',hn:'9900000001',sampleId:'26B261023001R-2',attemptState:'QcFailed',overallOrdinal:4,exceptional:false,outcomeStatus:waiting?'รอรับ PDF No Call':'รอพิจารณาหลังครบ 4 ครั้ง'}],seqFields:[],exports:[]});
 await page.route(`**/api/lab-bench/batches/${id}`,async route=>route.fulfill({json:fixture()}));
 await page.goto(`/lab/batches/${id}/bench`);
 for(const name of ['Re-Library','Re-Extraction','Re-Sampling','No Call'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Re-Extraction',exact:true}).click();await expect(page.getByRole('radio',{name:'Re-Extraction',exact:true})).toBeChecked();await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
 let submitted:Record<string,unknown>|null=null;
 await page.route('**/api/p4/worklist',async route=>{submitted=route.request().postDataJSON() as Record<string,unknown>;waiting=true;await route.fulfill({json:{status:'รอรับ PDF No Call'}});});
 await page.getByRole('button',{name:'No Call',exact:true}).click();await expect(page.getByRole('dialog').locator('textarea')).toHaveCount(0);await expect(page.getByRole('button',{name:'ยืนยัน',exact:true})).toBeEnabled();await page.getByRole('button',{name:'ยืนยัน',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(submitted).toEqual({action:'noCall',attemptId:'11111111-1111-4111-8111-111111111111'});
 await expect(page.getByRole('status').filter({hasText:'รอรับ PDF No Call'})).toBeVisible();
 for(const name of ['Re-Library','Re-Extraction','Re-Sampling','No Call'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
});
