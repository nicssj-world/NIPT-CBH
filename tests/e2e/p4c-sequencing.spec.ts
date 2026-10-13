import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {browserFixtureDatabaseUrl} from '../helpers/browser-database';
import {completedPool,dnbInput,issueF5Simulation} from '../helpers/sequencing';
import {docDeps,tx,version} from '../helpers/lab';
import type {Principal} from '../../packages/security/policy';
import type {Queryable} from '../../packages/db/connection';
import * as sequencing from '../../packages/sequencing/service';
import {bangkokToday} from '../../packages/lab/core';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';
test.beforeEach(async({context})=>context.setExtraHTTPHeaders({'x-real-ip':'synthetic-p4c-'+randomUUID()}));
async function login(page:Page,name='synthetic.lab'){
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim());await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
async function fixture(heldSequence=false){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const docs=await docDeps();
 try{
  const p=async(name:string,role:Principal['roles'][number]):Promise<Principal>=>({id:(await db.query<{id:string}>('SELECT id FROM app_user WHERE username=$1',[name])).rows[0].id,roles:[role],permissions:[],unitIds:[]});
  const staff=await p('synthetic.lab','LAB_STAFF'),certifier=await p('synthetic.certifier','LAB_CERTIFIER'),approver=await p('synthetic.approver','CLINICAL_APPROVER');
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  await db.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC P4c browser isolation' WHERE state='Draft'",[staff.id]);
  const f=await completedPool(db,{staff,certifier,approver,unit},docs.deps,heldSequence?45:2,heldSequence?'PATIENT_PC_NC':'PATIENT_ONLY');
  if(heldSequence){
   const created=await tx(db,async t=>sequencing.createDnb(t,staff,dnbInput(f.batchId,f.poolSnapshotId,await version(t,f.batchId),staff.id))),dnbId=created.id!;
   const call=(fn:(db:Queryable,actor:Principal,input:unknown)=>Promise<unknown>,extra:Record<string,unknown>,actor=staff)=>tx(db,async t=>fn(t,actor,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),...extra}));
   await issueF5Simulation(db,staff,f.batchId,dnbId,docs.deps);
   for(const transition of ['DNB_START','DNB_END'])await call(sequencing.transition,{transition,reason:'synthetic browser rerun preparation'});
   for(const field of ['STD1','STD2','QC3'])await call(sequencing.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
   for(const o of await sequencing.observations(db,dnbId))await call(sequencing.reviewObservation,{observationId:o.id,result:'Confirmed',note:'synthetic browser independent review'},certifier);
   await call(sequencing.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:sequencing.QC3_CRITERIA,reason:'synthetic browser QC3'},certifier);
   const source=sequencing.orderedSourceMembers((await sequencing.storedPool(db,f.batchId,f.poolSnapshotId)).snapshot);
   const members=source.map((m,i)=>({memberKey:m.memberKey,physicalPosition:m.physicalPosition,role:m.role,exportSampleId:'SYN-EXPLICIT-'+i,printedSampleId:m.printedSampleId!,lnHalos:m.lnHalos??'SYN-CONTROL-'+i,barcodeIndex:BARCODE_ORDER[i],barcodeType:'SYN-UNVERIFIED'}));
   const h=await call(sequencing.createHandoff,{mapping:{status:'synthetic-fixture-unverified',evidenceReference:'Explicit browser fixture only',members},reason:'synthetic browser handoff'}) as {id:string;fileHash:string};
   const tr=await call(sequencing.transferHandoff,{handoffId:h.id,fileHash:h.fileHash,status:'Complete',evidenceHash:'a'.repeat(64),evidenceReference:'synthetic browser transfer',purpose:'SYNTHETIC_SIMULATION'}) as {id:string};
   await call(sequencing.verifyHandoff,{handoffId:h.id,transferId:tr.id,observedRows:members,observedDnbId:'DNB'+bangkokToday().replaceAll('-',''),lane:'L01',fileHash:h.fileHash,status:'Complete',evidenceHash:'b'.repeat(64),note:'synthetic independent exact review'},certifier);
   const run=await call(sequencing.createSequencing,{purpose:'SYNTHETIC_SIMULATION',equipmentModel:'DNBSEQ-G50',equipmentId:'SYN-G50',sequencingId:'SYN-RUN1',cartridgeId:'SYN-CART',flowCellId:'SYN-FLOW',idSource:'SCAN',barcodeType:'SYN-UNVERIFIED',barcodeRange:{from:1,to:48},recipe:'SYN-RECIPE',configuration:{readMode:'SE',readCycles:35,barcodeCycles:10,assay:'SYN-NIPT'},pressureKpa:'-81',diskSpaceGb:'501',wash:{lot:'SYN-WASH',preparedOn:bangkokToday(),expiry:'2099-12-31',preWash:true},reason:'synthetic browser run1'}) as {id:string};
   await call(sequencing.transitionSequencing,{sequencingId:run.id,transition:'SEQUENCE_START',reason:'synthetic browser run1 start'});
   await call(sequencing.transitionSequencing,{sequencingId:run.id,transition:'SEQUENCE_END',firstCycle:{loadedDnb:'100',q30:'90',bic:'90',fit:'90'},postWash:true,reason:'synthetic browser run1 end'});
   const q=await call(sequencing.recordQc4,{sequencingId:run.id,scope:'LANE',lane:'L01',metrics:{totalReads:'100',uniqueReads:'90',q30:'90',gcPercent:'40'},source:'DIRECT_ENTRY',evidenceHash:'c'.repeat(64)}) as {id:string};
   await call(sequencing.reviewQc4,{qc4Id:q.id,result:'Hold',criteriaVersion:sequencing.QC4_CRITERIA,note:'synthetic held lane for UI rerun'},certifier);
  }
  return {...f,staffId:staff.id};
 }finally{await db.end();await docs.close();}
}
const accessible=async(page:Page)=>{
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
};
test('P4c browser: stored HOLD Pool → F5 preview/original → QC3 independent review → unavailable mapping remains gated; responsive accessibility',async({page,browser})=>{
 test.setTimeout(180000);const f=await fixture(),url=`/lab/batches/${f.batchId}/sequencing`;await login(page);await page.goto(url);
 await expect(page.getByRole('heading',{name:'DNB / Sequencing / F5',exact:true})).toBeVisible();await expect(page.getByText(/Acceptance: HOLD/)).toBeVisible();
 for(const width of [375,768,1280,1440]){await page.setViewportSize({width,height:1000});await accessible(page);}
 const form=page.getByRole('form',{name:'สร้าง DNB จำลอง'});
 await form.getByLabel('เครื่องมือเตรียม DNB',{exact:true}).fill('SYN-DNB-BROWSER');await form.getByLabel('ชื่อน้ำยา',{exact:true}).fill('Synthetic reagent');await form.getByLabel('Lot',{exact:true}).fill('SYN-LOT');await form.getByLabel('วันหมดอายุน้ำยา',{exact:true}).fill('2099-12-31');await form.getByLabel('เหตุผล / ที่มาของแบบจำลอง').fill('จำลอง browser DNB workflow');await form.getByLabel('บันทึก Pre-clean ในแบบจำลองแล้ว').check();await form.getByLabel('บันทึกเตรียมน้ำยา Loading ในแบบจำลองแล้ว').check();
 await form.getByRole('button').click();await expect(page.getByRole('heading',{name:/Attempt 1 · DRAFT/})).toBeVisible();
 await page.getByRole('button',{name:'Preview F5 Pre-work จำลอง',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('iframe')).toBeVisible();await dialog.getByRole('button',{name:'ปิด',exact:true}).click();
 await page.getByRole('button',{name:'ออก F5 Pre-work จำลอง',exact:true}).click();await expect(page.getByRole('heading',{name:/· PRE_WORK/})).toBeVisible();await page.getByRole('button',{name:'เริ่ม DNB จำลอง',exact:true}).click();await page.getByRole('button',{name:'จบ DNB จำลอง',exact:true}).click();
 const qc=page.getByRole('form',{name:'บันทึก QC3'});
 for(const field of ['STD1','STD2','QC3']){await qc.getByLabel('ฟิลด์ QC3').selectOption(field);await qc.getByLabel('ค่าที่วัด (ng/µL)',{exact:true}).fill('20');const response=page.waitForResponse(r=>r.url().endsWith('/api/p4c/batches/'+f.batchId)&&r.request().method()==='POST');await qc.getByRole('button',{name:'บันทึก QC3 / Standard',exact:true}).click();expect((await response).status()).toBe(200);await expect(qc.getByRole('button')).toBeEnabled();}
 for(const width of [375,768,1280,1440]){await page.setViewportSize({width,height:1000});await accessible(page);}
 await page.screenshot({path:'test-results/p4c-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'test-results/p4c-mobile.png',fullPage:true});
 const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL??'http://127.0.0.1:3000',extraHTTPHeaders:{'x-real-ip':'synthetic-p4c-review-'+randomUUID()}});
 try{const reviewer=await context.newPage();await login(reviewer,'synthetic.certifier');await reviewer.goto(url);for(const field of ['STD1','STD2','QC3']){await reviewer.getByRole('button',{name:'ยืนยัน '+field,exact:true}).click();await expect(reviewer.getByRole('button',{name:'ยืนยัน '+field,exact:true})).toHaveCount(0);}await reviewer.getByRole('button',{name:'SyntheticReviewed QC3',exact:true}).click();await expect(reviewer.getByRole('status')).toContainText('Acceptance HOLD');}finally{await context.close();}
 await page.reload();const me=await (await page.request.get('/api/me')).json(),w=await (await page.request.get(`/api/p4c/batches/${f.batchId}`)).json();
 const headers={origin:process.env.APP_ORIGIN??'http://127.0.0.1:3000','x-csrf-token':me.csrf};
 const r=await page.request.post(`/api/p4c/batches/${f.batchId}`,{headers,data:{action:'createHandoff',dnbId:w.current.id,expectedVersion:w.version,requestId:randomUUID(),reason:'จำลอง browser unmapped handoff'}});expect(r.status()).toBe(200);await page.reload();await expect(page.getByText('MAPPING_UNAVAILABLE',{exact:false}).first()).toBeVisible();
 const denied=await page.request.post(`/api/p4c/batches/${f.batchId}`,{data:{action:'createDnb'}});expect(denied.status()).toBe(403);
 const current=await (await page.request.get(`/api/p4c/batches/${f.batchId}`)).json();const operational=await page.request.post(`/api/p4c/batches/${f.batchId}`,{headers,data:{action:'accept',dnbId:current.current.id,expectedVersion:current.version}});expect(operational.status()).toBe(403);
 await accessible(page);
});
test('P4c ANC denied, auditor read-only, anonymous F5 denied',async({page})=>{
 test.setTimeout(120000);const f=await fixture();await login(page,'synthetic.auditor');await page.goto(`/lab/batches/${f.batchId}/sequencing`);await expect(page.getByRole('form',{name:'สร้าง DNB จำลอง'})).toHaveCount(0);
 const me=await (await page.request.get('/api/me')).json();expect((await page.request.post(`/api/p4c/batches/${f.batchId}`,{headers:{origin:process.env.APP_ORIGIN??'http://127.0.0.1:3000','x-csrf-token':me.csrf},data:{action:'createDnb',...dnbInput(f.batchId,f.poolSnapshotId,0,f.staffId)}})).status()).toBe(403);
 await page.context().clearCookies();expect((await page.request.get('/api/p4c/documents/'+randomUUID())).status()).toBe(401);await login(page,'synthetic.anc');expect((await page.request.get(`/api/p4c/batches/${f.batchId}`)).status()).toBe(403);
});
test('P4c held QC4 lane allows a replacement sequencing attempt from UI with current-run controls',async({page})=>{
 test.setTimeout(180000);const f=await fixture(true);await login(page);await page.goto(`/lab/batches/${f.batchId}/sequencing`);
 await expect(page.getByRole('heading',{name:/SEQUENCE_HOLD/})).toBeVisible();
 const form=page.getByRole('form',{name:'บันทึก Sequencing'});await expect(form).toBeVisible();
 const values:Record<string,string>={equipment:'SYN-G50',sequencing:'SYN-RUN2',cartridge:'SYN-CART2',flowcell:'SYN-FLOW2',barcode:'SYN-UNVERIFIED',from:'1',to:'48',recipe:'SYN-RECIPE',readCycles:'35',barcodeCycles:'10',assay:'SYN-NIPT',pressure:'-81',disk:'501',washLot:'SYN-WASH2',washPrepared:bangkokToday(),washExpiry:'2099-12-31'};
 for(const [name,value] of Object.entries(values))await form.locator(`input[name="${name}"]`).fill(value);
 await form.locator('input[name="preWash"]').check();await form.getByRole('button',{name:'บันทึก Sequencing จำลอง',exact:true}).click();
 await expect(page.getByText(/Run attempt 2 \/ SYN-G50 \/ SYN-RUN2/)).toBeVisible();await expect(page.getByRole('form',{name:'จบ Sequencing'})).toHaveCount(0);
 await page.getByRole('button',{name:'เริ่ม Sequencing จำลอง (ต้อง Verification MATCH)',exact:true}).click();await expect(page.getByRole('form',{name:'จบ Sequencing'})).toBeVisible();
 for(const width of [375,768,1280,1440]){await page.setViewportSize({width,height:1000});await accessible(page);}
 const w=await (await page.request.get(`/api/p4c/batches/${f.batchId}`)).json();expect(w.current.state).toBe('SEQUENCING');expect(w.current.sequences[0].supersedes_id).toBe(w.current.sequences[1].id);expect(w.current.qc4.observations).toEqual([]);
});
