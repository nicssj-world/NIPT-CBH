import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {signInSyntheticBrowser} from '../helpers/browser-auth';

type Fixture={ln:string;roundId:string;overwriteLn:string;overwriteRoundId:string;boxId:string;storageLabel:string;slot:number;position:string;dragLn:string;dragStorageLabel:string;manualLn:string;manualRoundId:string;manualStorageLabel:string;autoFillLn:string;autoFillRoundId:string;autoFillStorageLabel:string};
const fixturePath=process.env.NIPT_SAMPLE_STORAGE_FIXTURE;
if(!fixturePath)throw new Error('SAMPLE_STORAGE_E2E_FIXTURE_REQUIRED');
const fixture=JSON.parse(await readFile(fixturePath,'utf8')) as Fixture;
const evidence=process.env.NIPT_E2E_EVIDENCE_DIR??path.resolve('.local/sample-storage-e2e/screenshots/interactions');

test('Sample Storage handles native drag/drop events and keyboard move controls',async({page})=>{
 await mkdir(evidence,{recursive:true});
 await page.setViewportSize({width:1440,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 await expect(page.getByRole('heading',{level:1,name:'จัดเก็บตัวอย่าง'})).toBeVisible();

 const boxes=page.getByRole('list',{name:'รายการกล่อง'});
 await boxes.locator('button').filter({hasText:fixture.boxId}).click();
 await expect(page.getByRole('heading',{level:2,name:fixture.boxId})).toBeVisible();
 const slot1=page.locator('[data-storage-slot="1"]');
 await expect(slot1).toHaveAttribute('aria-label','A1, ว่าง');
 const search=page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID');
 await search.fill(fixture.dragLn);
 const waiting=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.dragStorageLabel});
 await expect(waiting).toHaveCount(1);
 await expect(waiting).toHaveAttribute('draggable','true');
 const dragResult=await waiting.evaluate((article,targetSelector)=>{
  const target=document.querySelector<HTMLElement>(targetSelector);if(!target)throw new Error('SAMPLE_STORAGE_DROP_TARGET_MISSING');
  const dataTransfer=new DataTransfer(),create=(type:string)=>new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer});
  article.dispatchEvent(create('dragstart'));
  target.dispatchEvent(create('dragenter'));
  const dragOver=create('dragover');target.dispatchEvent(dragOver);
  const drop=create('drop');target.dispatchEvent(drop);
  article.dispatchEvent(create('dragend'));
  return {dataTypes:Array.from(dataTransfer.types),dragOverAccepted:dragOver.defaultPrevented,dropAccepted:drop.defaultPrevented};
 },'[data-storage-slot="1"]');
 expect(dragResult.dataTypes).toContain('text/plain');
 expect(dragResult.dragOverAccepted).toBe(true);
 expect(dragResult.dropAccepted).toBe(true);
 await expect(slot1).toContainText(fixture.dragStorageLabel);

 await search.fill(fixture.ln);
 const stored=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.storageLabel});
 await expect(stored).toHaveCount(1);
 await stored.getByRole('button',{name:`${fixture.boxId} · ${fixture.position}`}).click();
 const controls=page.getByRole('region',{name:'จัดเก็บหรือย้ายด้วยแป้นพิมพ์'});
 await expect(controls).toBeVisible();

 const slot30=page.locator(`[data-storage-slot="${fixture.slot}"]`),slot31=page.locator('[data-storage-slot="31"]');
 await controls.getByLabel('ช่องปลายทาง').selectOption('31');
 await controls.getByRole('button',{name:'ย้ายตำแหน่ง'}).click();
 await expect(slot31).toContainText(fixture.storageLabel);
 await expect(slot30).toHaveAttribute('aria-label',/ว่าง$/);

 await slot31.click();
 await expect(controls).toBeVisible();
 await controls.getByLabel('ช่องปลายทาง').selectOption(String(fixture.slot));
 await controls.getByRole('button',{name:'ย้ายตำแหน่ง'}).click();
 await expect(slot30).toContainText(fixture.storageLabel);
 await expect(slot31).toHaveAttribute('aria-label',/ว่าง$/);
 await page.screenshot({path:path.join(evidence,'sample-storage-drag-keyboard.png'),fullPage:true,animations:'disabled'});
});

test('Sample Storage accepts a physical pointer drag into an empty slot',async({page})=>{
 test.setTimeout(20000);
 await page.setViewportSize({width:1440,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 const boxes=page.getByRole('list',{name:'รายการกล่อง'});
 await boxes.locator('button').filter({hasText:fixture.boxId}).click();
 await expect(page.getByRole('heading',{level:2,name:fixture.boxId})).toBeVisible();
 const slot2=page.locator('[data-storage-slot="2"]');
 await expect(slot2).toHaveAttribute('aria-label','B1, ว่าง');
 const search=page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID');
 await search.fill(fixture.overwriteLn);
 const waiting=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.overwriteLn}).filter({hasText:'Backup'});
 await expect(waiting).toHaveCount(1);
 const storageLabel=await waiting.locator('strong').innerText();
 await waiting.scrollIntoViewIfNeeded();
 await slot2.scrollIntoViewIfNeeded();
 await page.evaluate(()=>{
  const w=window as unknown as {__storageDragEvents:string[];__slot2TopAtDragStart:number|null};w.__storageDragEvents=[];w.__slot2TopAtDragStart=null;
  for(const type of ['dragstart','dragenter','dragover','drop','dragend'])document.addEventListener(type,event=>{
   const target=event.target instanceof Element?event.target:null,slot=target?.closest('[data-storage-slot]')?.getAttribute('data-storage-slot');
   w.__storageDragEvents.push(`${type}:${slot??(target?.closest('article')?'sample-row':'other')}`);
   if(type==='dragstart')w.__slot2TopAtDragStart=document.querySelector('[data-storage-slot="2"]')?.getBoundingClientRect().top??null;
  },true);
 });
 const placement=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string;roundId?:string};
  return body.action==='place'&&body.roundId===fixture.overwriteRoundId;
 },{timeout:10000});
 const source=await waiting.locator('strong').boundingBox(),target=await slot2.boundingBox();
 expect(source).not.toBeNull();expect(target).not.toBeNull();
 const viewport=page.viewportSize();expect(viewport).not.toBeNull();
 expect(source!.y).toBeGreaterThanOrEqual(0);expect(source!.y+source!.height).toBeLessThanOrEqual(viewport!.height);
 await Promise.race([
  (async()=>{await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:8});await page.mouse.up();})(),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('SAMPLE_STORAGE_POINTER_GESTURE_TIMEOUT')),12000))
 ]);
 const dragObservation=await page.evaluate(()=>{
  const w=window as unknown as {__storageDragEvents:string[];__slot2TopAtDragStart:number|null};
  return {events:w.__storageDragEvents,slot2TopAtDragStart:w.__slot2TopAtDragStart,slot2TopAfter:document.querySelector('[data-storage-slot="2"]')?.getBoundingClientRect().top??null};
 });
 expect(dragObservation.events).toContain('dragstart:sample-row');
 expect(dragObservation.slot2TopAfter).toBe(dragObservation.slot2TopAtDragStart);
 const response=await placement;
 expect(response.status()).toBe(200);
 expect(dragObservation.events).toContain('drop:2');
 await expect(slot2).toContainText(storageLabel);
 await page.screenshot({path:path.join(evidence,'sample-storage-pointer-drag.png'),fullPage:true,animations:'disabled'});
});

test('Sample Storage preserves stored-slot geometry during a physical pointer move',async({page})=>{
 test.setTimeout(20000);
 await page.setViewportSize({width:1440,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 const boxes=page.getByRole('list',{name:'รายการกล่อง'});
 await boxes.locator('button').filter({hasText:fixture.boxId}).click();
 await expect(page.getByRole('heading',{level:2,name:fixture.boxId})).toBeVisible();
 const sourceSlot=page.locator(`[data-storage-slot="${fixture.slot}"]`),targetSlot=page.locator('[data-storage-slot="31"]');
 await expect(sourceSlot).toContainText(fixture.storageLabel);
 await expect(targetSlot).toHaveAttribute('aria-label','D4, ว่าง');
 await sourceSlot.scrollIntoViewIfNeeded();
 await targetSlot.scrollIntoViewIfNeeded();
 await page.evaluate(()=>{
  const w=window as unknown as {__storedDragEvents:string[];__slot31TopAtDragStart:number|null};w.__storedDragEvents=[];w.__slot31TopAtDragStart=null;
  for(const type of ['dragstart','dragenter','dragover','drop','dragend'])document.addEventListener(type,event=>{
   const target=event.target instanceof Element?event.target:null,slot=target?.closest('[data-storage-slot]')?.getAttribute('data-storage-slot');
   w.__storedDragEvents.push(`${type}:${slot??'other'}`);
   if(type==='dragstart')w.__slot31TopAtDragStart=document.querySelector('[data-storage-slot="31"]')?.getBoundingClientRect().top??null;
  },true);
 });
 const movement=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string;roundId?:string};
  return body.action==='move'&&body.roundId===fixture.roundId;
 },{timeout:10000});
 const source=await sourceSlot.boundingBox(),target=await targetSlot.boundingBox();
 expect(source).not.toBeNull();expect(target).not.toBeNull();
 await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);
 await page.mouse.down();
 await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:8});
 await page.mouse.up();
 const dragObservation=await page.evaluate(()=>{
  const w=window as unknown as {__storedDragEvents:string[];__slot31TopAtDragStart:number|null};
  return {events:w.__storedDragEvents,slot31TopAtDragStart:w.__slot31TopAtDragStart,slot31TopAfter:document.querySelector('[data-storage-slot="31"]')?.getBoundingClientRect().top??null};
 });
 expect(dragObservation.events).toContain(`dragstart:${fixture.slot}`);
 expect(dragObservation.events).toContain('drop:31');
 expect(dragObservation.slot31TopAfter).toBe(dragObservation.slot31TopAtDragStart);
 expect((await movement).status()).toBe(200);
 await expect(targetSlot).toContainText(fixture.storageLabel);
 await expect(sourceSlot).toHaveAttribute('aria-label',/ว่าง$/);

 await targetSlot.click();
 const controls=page.getByRole('region',{name:'จัดเก็บหรือย้ายด้วยแป้นพิมพ์'});
 await expect(controls).toBeVisible();
 await controls.getByLabel('ช่องปลายทาง').selectOption(String(fixture.slot));
 await controls.getByRole('button',{name:'ย้ายตำแหน่ง'}).click();
 await expect(sourceSlot).toContainText(fixture.storageLabel);
 await expect(targetSlot).toHaveAttribute('aria-label',/ว่าง$/);
 await page.screenshot({path:path.join(evidence,'sample-storage-pointer-move.png'),fullPage:true,animations:'disabled'});
});

test('Sample Storage creates a Backup box and manually places a selected waiting sample',async({page})=>{
 test.setTimeout(20000);
 await page.setViewportSize({width:1440,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 const create=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string;boxType?:string};
  return body.action==='createBox'&&body.boxType==='BACKUP';
 },{timeout:10000});
 await page.getByRole('button',{name:'เปิด Backup Box ใหม่'}).click();
 expect((await create).ok()).toBe(true);
 const activeBox=page.getByRole('heading',{level:2,name:/^Box\d+$/});
 await expect(activeBox).toHaveText(/^Box\d+$/);
 const boxId=await activeBox.innerText(),search=page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID');
 await search.fill(fixture.manualLn);
 await expect(page.getByText(/รายการในผลค้นหา/)).toBeVisible();
 const waiting=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.manualLn}).filter({hasText:'Backup'});
 await expect(waiting).toHaveCount(1);
 await waiting.getByRole('button',{name:'เลือกเพื่อจัดเก็บ'}).click();
 const slot=page.locator('[data-storage-slot="1"]');
 await expect(slot).toHaveAttribute('aria-label','A1, ว่าง');
 const placement=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string;roundId?:string};
  return body.action==='place'&&body.roundId===fixture.manualRoundId;
 },{timeout:10000});
 await slot.click();
 expect((await placement).status()).toBe(200);
 await expect(slot).toContainText(fixture.manualStorageLabel);
 await expect(waiting.getByRole('button',{name:`${boxId} · A1`})).toBeVisible();
});

test('Sample Storage previews and confirms Auto-fill for a selected sample',async({page})=>{
 test.setTimeout(20000);
 await page.setViewportSize({width:1440,height:1000});
 await signInSyntheticBrowser(page,'synthetic.lab');
 await page.goto('/sample-storage');
 const search=page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID');
 await search.fill(fixture.autoFillLn);
 await expect(page.getByText(/รายการในผลค้นหา/)).toBeVisible();
 const waiting=page.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:fixture.autoFillLn}).filter({hasText:'Backup'});
 await expect(waiting).toHaveCount(1);
 await waiting.getByRole('checkbox',{name:`เลือก ${fixture.autoFillStorageLabel}`}).check();
 const previewResponse=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string};
  return body.action==='autoFillPreview';
 },{timeout:10000});
 await page.getByRole('button',{name:/Auto-fill 1 ตัวอย่างที่เลือก/}).click();
 expect((await previewResponse).status()).toBe(200);
 const dialog=page.getByRole('dialog',{name:'Preview Auto-fill'});
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText(fixture.autoFillStorageLabel);
 const confirmButton=dialog.getByRole('button',{name:'ยืนยันจัดเก็บ 1 ตัวอย่าง'});
 await expect(confirmButton).toBeEnabled();
 await expect(waiting.getByRole('button',{name:'เลือกเพื่อจัดเก็บ'})).toBeVisible();
 await page.screenshot({path:path.join(evidence,'sample-storage-autofill-preview.png'),fullPage:true,animations:'disabled'});
 const confirmResponse=page.waitForResponse(response=>{
  if(!response.url().endsWith('/api/sample-storage')||response.request().method()!=='POST')return false;
  const body=response.request().postDataJSON() as {action?:string};
  return body.action==='autoFillConfirm';
 },{timeout:10000});
 await confirmButton.click();
 expect((await confirmResponse).status()).toBe(200);
 await expect(dialog).toBeHidden();
 await expect(page.getByText('จัดเก็บ 1 ตัวอย่างตาม FIFO แล้ว')).toBeVisible();
 await expect(waiting.getByRole('button',{name:/^Box\d+ · [A-I][1-9]$/})).toBeVisible();
});
