import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {signInSyntheticBrowser} from '../helpers/browser-auth';

type Fixture={ln:string;roundId:string;overwriteRoundId:string;boxUuid:string;boxId:string;storageLabel:string;slot:number;position:string;retentionDueAt:string};
const fixturePath=process.env.NIPT_SAMPLE_STORAGE_FIXTURE;
if(!fixturePath)throw new Error('SAMPLE_STORAGE_E2E_FIXTURE_REQUIRED');
const fixture=JSON.parse(await readFile(fixturePath,'utf8')) as Fixture;
const evidence=process.env.NIPT_E2E_EVIDENCE_DIR??path.resolve('.local/sample-storage-e2e/screenshots');
const displayDate=(value:string)=>new Intl.DateTimeFormat('th-TH-u-ca-buddhist',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));

for(const width of [1440,1280,768,375])test(`Sample Storage exact search and keyboard navigation at ${width}px`,async({page})=>{
 await mkdir(evidence,{recursive:true});
 await page.setViewportSize({width,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 await expect(page.getByRole('heading',{level:1,name:'จัดเก็บตัวอย่าง'})).toBeVisible();
 await page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID').fill(fixture.ln);
 const sample=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.ln}).filter({hasText:'Backup'});
 await expect(sample).toHaveCount(1);
 const locate=sample.getByRole('button',{name:`${fixture.boxId} · ${fixture.position}`});
 await locate.focus();await page.keyboard.press('Enter');
 const slot=page.locator(`[data-storage-slot="${fixture.slot}"]`);
 await expect(slot).toHaveAttribute('aria-selected','true');
 await expect(slot).toBeFocused();
 await expect(slot).toContainText(fixture.storageLabel);
 await expect(page.getByRole('heading',{level:2,name:fixture.boxId})).toBeVisible();
 const retention=page.getByRole('region',{name:'รายละเอียดตัวอย่างและกำหนดเก็บรักษา'});
 await expect(retention).toContainText(fixture.storageLabel);
 await expect(retention).toContainText(`รับจาก HIS (PET): ${displayDate('2024-02-29T15:45:00.000Z')}`);
 await expect(retention).toContainText(`ครบกำหนดเก็บรักษา: ${displayDate(fixture.retentionDueAt)}`);
 if(width>=1280){
  const grid=await page.getByRole('region',{name:'ตารางตำแหน่ง 9 คูณ 9'}).evaluate(scroller=>{
   const element=scroller.firstElementChild as HTMLElement;
   return {slots:element.querySelectorAll('[data-storage-slot]').length,gridWidth:element.scrollWidth,visibleWidth:scroller.clientWidth};
  });
  expect(grid.slots).toBe(81);
  expect(grid.gridWidth,`9×9 grid must fit at desktop width ${width}px`).toBeLessThanOrEqual(grid.visibleWidth);
 }
 const dimensions=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 expect(dimensions.scrollWidth,`horizontal page overflow at ${width}px`).toBeLessThanOrEqual(dimensions.width);
 await page.screenshot({path:path.join(evidence,`sample-storage-${width}.png`),fullPage:true,animations:'disabled'});
});

test('Sample Storage direct API denies unauthorized access and occupied overwrite',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.anc');
 const origin=new URL(process.env.E2E_BASE_URL??'http://127.0.0.1:3000').origin;
 const post=async(body:Record<string,unknown>)=>{
  const profile=await page.request.get('/api/me');expect(profile.ok()).toBe(true);
  const {csrf}=await profile.json() as {csrf:string};
  return page.request.post('/api/sample-storage',{headers:{origin,'x-csrf-token':csrf},data:body});
 };
 const denied=[
  {action:'search',q:fixture.ln},
  {action:'printLabel',boxId:fixture.boxUuid},
  {action:'printSampleLabel',roundId:fixture.roundId,storageType:'BACKUP'},
  {action:'place',roundId:fixture.roundId,storageType:'BACKUP',boxId:fixture.boxUuid,slot:fixture.slot},
  {action:'move',roundId:fixture.roundId,storageType:'BACKUP',fromBoxId:fixture.boxUuid,fromSlot:fixture.slot,toBoxId:fixture.boxUuid,toSlot:fixture.slot+1}
 ];
 for(const body of denied){
  const response=await post(body),payload=await response.json();
  expect(response.status(),`${body.action} must be denied`).toBe(403);
  expect(payload.code).toBe('FORBIDDEN');
  expect(JSON.stringify(payload)).not.toContain(fixture.ln);
  expect(JSON.stringify(payload)).not.toContain(fixture.storageLabel);
 }
 const profile=await page.request.get('/api/me');expect(profile.ok()).toBe(true);
 const {csrf}=await profile.json() as {csrf:string};
 const logout=await page.request.post('/api/auth/logout',{headers:{origin,'x-csrf-token':csrf}});expect(logout.ok()).toBe(true);
 await signInSyntheticBrowser(page,'synthetic.lab');
 const occupied=await post({action:'place',roundId:fixture.overwriteRoundId,storageType:'BACKUP',boxId:fixture.boxUuid,slot:fixture.slot});
 expect(occupied.status()).toBe(409);
 expect((await occupied.json()).code).toBe('STORAGE_POSITION_OCCUPIED');
});
