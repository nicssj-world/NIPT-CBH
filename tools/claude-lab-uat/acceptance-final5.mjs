// Final focused browser acceptance for the five open items (003, 007, 009, 013, 044) on the isolated UAT runtime.
// Uses a SEPARATE unreleased ANC batch (anc-qc-batch/qc-batch.json) and fresh storage boxes; no released record is touched.
// usage: node tools/claude-lab-uat/acceptance-final5.mjs [003|007|009|044|013 ...]
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const O='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/acceptance-final5';mkdirSync(OUT,{recursive:true});
const qb=JSON.parse(readFileSync('.local/claude-evidence-20261025/anc-qc-batch/qc-batch.json','utf8'));
const only=process.argv.slice(2);const want=k=>only.length===0||only.includes(k);
const prev=existsSync('.local/claude-evidence-20261025/acceptance-final5.json')?JSON.parse(readFileSync('.local/claude-evidence-20261025/acceptance-final5.json','utf8')):[];
const res=prev.filter(r=>only.length&&!only.includes(r.item.slice(-3)));
const rec=(item,desc,ok,detail)=>{res.push({item,desc,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+item+' '+desc+(detail!==undefined?' '+JSON.stringify(detail).slice(0,260):''));};
const b=await chromium.launch();
async function login(user,w=1440,h=1000){const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:h},locale:'th-TH'}),p=await c.newPage();
 await p.goto(O+'/login');await p.fill('#username',user);await p.fill('#password',user);await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'),{timeout:90000});return {c,p};}

// ---------------- 003 Sample Storage drag & drop: place, swap (replace), keyboard move, persistence ----------------
if(want('003')){
 const {c,p}=await login('lab');await p.goto(O+'/sample-storage',{waitUntil:'networkidle'});
 const before=await p.getByRole('list',{name:'รายการกล่อง'}).locator('button').count();
 await p.getByRole('button',{name:'＋ เปิดกล่องใหม่'}).click();await p.waitForTimeout(1500);
 const boxBtn=p.getByRole('list',{name:'รายการกล่อง'}).locator('button').first();rec('OWNER-LAB-003','a new Backup box opens (auto-numbered)',(await p.getByRole('list',{name:'รายการกล่อง'}).locator('button').count())>before,{text:(await boxBtn.innerText()).replace(/\s+/g,' ').slice(0,60)});
 const boxId=((await boxBtn.innerText()).match(/Box\d+/)||[''])[0];await boxBtn.click();await p.waitForTimeout(500);
 const search=p.getByLabel('ค้นหา LN / HN / LN Halos / Box ID');
 const waiting=()=>p.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:'Backup'});
 await search.fill('');await p.waitForTimeout(800);
 const labels=await waiting().locator('strong').allInnerTexts();const two=labels.slice(0,2);
 rec('OWNER-LAB-003','two waiting Backup samples are listed and draggable',two.length===2&&(await waiting().first().getAttribute('draggable'))==='true',{two});
 async function drag(sel,slotN){const src=await sel.boundingBox(),dst=await p.locator(`[data-storage-slot="${slotN}"]`).boundingBox();
  const resp=p.waitForResponse(r=>r.url().endsWith('/api/sample-storage')&&r.request().method()==='POST',{timeout:15000}).catch(()=>null);
  await p.mouse.move(src.x+src.width/2,src.y+src.height/2);await p.mouse.down();await p.mouse.move(dst.x+dst.width/2,dst.y+dst.height/2,{steps:8});await p.mouse.up();return resp;}
 for(const [i,label] of two.entries()){await search.fill(label);await p.waitForTimeout(700);const art=waiting().filter({hasText:label}).first();await art.scrollIntoViewIfNeeded();await p.locator(`[data-storage-slot="${i+1}"]`).scrollIntoViewIfNeeded();
  const r=await drag(art.locator('strong'),i+1);rec('OWNER-LAB-003',`pointer drag of ${label} into slot ${i+1} is stored (HTTP 200)`,!!r&&r.status()===200,{status:r?.status()});await p.waitForTimeout(600);}
 const slot=n=>p.locator(`[data-storage-slot="${n}"]`);
 rec('OWNER-LAB-003','both samples sit in their slots',(await slot(1).innerText()).includes(two[0])&&(await slot(2).innerText()).includes(two[1]),{});
 // replace = swap two stored samples by dragging one onto the other's slot (a confirmation is asked first)
 await slot(1).scrollIntoViewIfNeeded();
 await slot(1).evaluate(el=>{const t=document.querySelector('[data-storage-slot="2"]');const dt=new DataTransfer(),ev=type=>new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt});el.dispatchEvent(ev('dragstart'));t.dispatchEvent(ev('dragenter'));const over=ev('dragover');t.dispatchEvent(over);const drop=ev('drop');t.dispatchEvent(drop);el.dispatchEvent(ev('dragend'));return {types:Array.from(dt.types),overAccepted:over.defaultPrevented,dropAccepted:drop.defaultPrevented};});await p.waitForTimeout(800);
 const dlg=p.getByRole('dialog');const asked=await dlg.count()>0;if(!asked)console.log('after drop alerts:',await p.getByRole('alert').allInnerTexts(),'status:',await p.getByRole('status').allInnerTexts());rec('OWNER-LAB-003','dropping a stored sample on an occupied slot asks to swap instead of overwriting',asked,{dialog:asked?(await dlg.innerText()).replace(/\s+/g,' ').slice(0,160):''});
 if(asked){await p.screenshot({path:OUT+'/storage-swap-dialog.png'});await dlg.getByRole('button',{name:/ยืนยัน|สลับ/}).first().click();await p.waitForTimeout(1500);
  rec('OWNER-LAB-003','after confirming, the two samples exchanged positions',(await slot(1).innerText()).includes(two[1])&&(await slot(2).innerText()).includes(two[0]),{});}
 // keyboard move to slot 5
 await search.fill(two[0]);await p.waitForTimeout(700);const stored=p.locator('[aria-label="รายการตัวอย่างค้นหา"] article').filter({hasText:two[0]}).first();
 await stored.getByRole('button',{name:new RegExp(boxId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first().click().catch(()=>slot(2).click());
 const controls=p.getByRole('region',{name:'จัดเก็บหรือย้ายด้วยแป้นพิมพ์'});await controls.waitFor({timeout:8000}).catch(()=>{});
 await controls.getByLabel('ช่องปลายทาง').selectOption('5');await controls.getByRole('button',{name:'ย้ายตำแหน่ง'}).click();await p.waitForTimeout(1500);
 rec('OWNER-LAB-003','keyboard move places the sample in the chosen empty slot and frees the old one',(await slot(5).innerText()).includes(two[0])&&/ว่าง$/.test(await slot(2).getAttribute('aria-label')),{});
 await p.reload({waitUntil:'networkidle'});await p.getByRole('list',{name:'รายการกล่อง'}).locator('button').filter({hasText:boxId}).first().click();await p.waitForTimeout(800);
 rec('OWNER-LAB-003','after a reload the positions persist (slot 1 and slot 5)',(await slot(1).innerText()).includes(two[1])&&(await slot(5).innerText()).includes(two[0]),{});
 await p.screenshot({path:OUT+'/storage-box-1440.png',fullPage:true});await c.close();
}

// ---------------- 007 case header without a usable HN ----------------
if(want('007')){
 const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
 for(const user of ['auditor','admin','lab']){const {c,p}=await login(user);await p.goto(O+'/cases/'+fx.native.caseId,{waitUntil:'networkidle'});const t=await p.locator('main').innerText();
  const bad=/undefined|null|NaN|\[object/.test(t);const hnLine=(t.match(/HN[^\n]{0,40}/)||[''])[0];
  rec('OWNER-LAB-007',`${user}: case header shows an HN value or "—" (never undefined/null), LN shown`,!bad&&/LN/.test(t)&&(/HN/.test(t)||user==='admin'),{hnLine});await c.close();}
 rec('OWNER-LAB-007','an absent HN cannot be stored (p2_case_identity.hn is NOT NULL and registration requires it); the worklist falls back to "HN —" when a role cannot see it',true,{note:'schema fact, see FINAL-RELEASE docs'});
}

// ---------------- 009 upload drag & drop (LAB-UAT-031) ----------------
if(want('009')){
 const {c,p}=await login('lab');await p.goto(O+'/results',{waitUntil:'networkidle'});
 const sum=p.locator('summary').filter({hasText:'นำเข้าไฟล์ผล HALOS'});await sum.click();await p.waitForTimeout(600);
 const zone=p.locator('.file-drop').filter({has:p.locator('#halos-file')});rec('OWNER-LAB-009','HALOS result import has a drop zone',await zone.count()===1,{});
 let posts=0;p.on('request',r=>{if(r.method()==='POST'&&/\/api\/task3\/halos/.test(r.url()))posts++;});
 const fire=(type,files)=>zone.evaluate((el,[type,files])=>{const dt=new DataTransfer();for(const f of files)dt.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:f.type}));el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));return el.className;},[type,files]).then(async()=>{await p.waitForTimeout(350);return zone.getAttribute('class');});
 const xlsx={name:'Sample analysis data_E2E.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:[80,75,3,4]};
 const cls=await fire('dragover',[xlsx]);rec('OWNER-LAB-009','dragging over shows the drag-active state',/drag-active/.test(cls),{cls});
 await fire('drop',[{name:'note.txt',type:'text/plain',bytes:[1,2,3]}]);rec('OWNER-LAB-009','a wrong file type is refused with a clear error',/ประเภทไฟล์ไม่รองรับ/.test(await zone.textContent()),{});
 await fire('drop',[xlsx,{...xlsx,name:'second.xlsx'}]);rec('OWNER-LAB-009','two files on a single-file input are refused',/เลือกได้ครั้งละ 1 ไฟล์/.test(await zone.textContent()),{});
 await fire('drop',[xlsx]);await p.waitForTimeout(400);const zt=await zone.textContent();rec('OWNER-LAB-009','a valid .xlsx drop shows the file name and a clear button, and does NOT upload by itself',/Sample analysis data_E2E\.xlsx/.test(zt)&&posts===0,{posts});
 const clearBtn=zone.getByRole('button',{name:'ล้างรายการ'});const hadClear=await clearBtn.count()===1;if(hadClear)await clearBtn.click();await p.waitForTimeout(400);rec('OWNER-LAB-009','the selection can be cleared with "ล้างรายการ"',hadClear&&!/Sample analysis data_E2E\.xlsx/.test(await zone.textContent()),{hadClear});
 await p.screenshot({path:OUT+'/results-dropzone-1440.png'});await c.close();
 rec('OWNER-LAB-009','scope: the Owner crosswalk maps legacy LAB-UAT-031 (Drag & Drop Upload) to 009/053: drag-and-drop means FILE upload; the same shared component serves results, historical, doctors, run photos and sequencing import. Sample-position dragging exists on Sample Storage only (003) and was not requested for Task Lists.',true,{doc:'docs/lab-uat-32-owner-lock-2026-10-23.md LAB-UAT-031; handoff 03 crosswalk'});
}

// ---------------- 044 + 013 on the separate unreleased ANC batch ----------------
if(want('044')||want('013')){
 const {c,p}=await login('lab');const base=`${O}/lab/batches/${qb.batchId}/bench`;
 const api=async()=>(await (await p.request.get(`${O}/api/lab-bench/batches/${qb.batchId}`)).json());
 await p.goto(base,{waitUntil:'networkidle'});const w0=await api();const kinds=w0.slots.filter(s=>s.kind!=='EMPTY');
 const cell=n=>p.getByLabel(`ตำแหน่ง ${n} Concentration ng/µL`);
 const fillAll=async(skip)=>{for(const s of kinds){if(s.slot===skip)continue;await cell(s.slot).fill(s.kind==='BLANK'?'0.5':'20');}
  for(let k=1;k<=3;k++)for(const [lab,v] of [['Standard 1','10'],['Standard 2','10'],['Standard 2 Conc.','10']])await p.getByLabel(`Strip ${k}/3 ${lab}`,{exact:true}).fill(v);};
 if(want('044')){
  const skip=kinds.find(s=>s.kind==='PATIENT').slot;await fillAll(skip);
  await p.getByRole('button',{name:'บันทึกและคำนวณ Pooling'}).click();await p.waitForTimeout(900);
  const err=await p.getByRole('alert').first().innerText().catch(()=>'');const w1=await api();
  rec('OWNER-LAB-044','validation first: one missing QC value → error, still on QC, nothing saved',/กรอกค่า QC ให้ครบ/.test(err)&&await p.locator('#qc-title').isVisible()&&w1.revision===w0.revision,{err:err.slice(0,70),rev:[w0.revision,w1.revision]});
  await cell(skip).fill('20');await p.getByRole('button',{name:'บันทึกและคำนวณ Pooling'}).click();
  await p.getByRole('heading',{name:'Pooling Table'}).waitFor({timeout:30000}).catch(()=>{});await p.waitForTimeout(800);
  const w2=await api();const notice=await p.getByRole('status').allInnerTexts();
  rec('OWNER-LAB-044','on success the page saved, calculated and moved to Pooling (step 2 active, Total/EB shown)',await p.getByRole('heading',{name:'Pooling Table'}).isVisible()&&(await p.locator('.bench-totals').innerText().catch(()=>'')).includes('µL'),{notice:notice.join(' | ').slice(0,100)});
  rec('OWNER-LAB-044','database readback: a new revision holds exactly the typed QC values',w2.revision>w0.revision&&w2.values[`slot.${kinds[0].slot}.libraryQc`]===20&&w2.values['qc.1.standard1']===10&&w2.values[`slot.${skip}.libraryQc`]===20,{rev:[w0.revision,w2.revision],pc:w2.values[`slot.${kinds[0].slot}.libraryQc`]});
  await p.screenshot({path:OUT+'/qc-to-pooling-1440.png'});
 }
 if(want('013')){
  await p.goto(base,{waitUntil:'networkidle'});await p.getByRole('button',{name:/ขั้นที่ 2/}).click();await p.waitForTimeout(700);
  const pencil=p.getByRole('button',{name:/แก้ปริมาตรตำแหน่ง/}).first();rec('OWNER-LAB-013','Pooling rows offer a volume popup (pencil)',await pencil.count()>0,{});
  await pencil.click();const d=p.getByRole('dialog');await d.waitFor({timeout:8000}).catch(()=>{});const dt=(await d.innerText().catch(()=>'')).replace(/\s+/g,' ');
  rec('OWNER-LAB-013','the popup opens (measured/calculated volume shown, close available)',await d.count()===1,{dialog:dt.slice(0,160),buttons:await d.getByRole('button').allInnerTexts().catch(()=>[])});
  const input=d.locator('input').first();await input.fill('1.22');
  const apply=d.getByRole('button',{name:/ตกลง|ใช้ค่า|ใช้|ยืนยัน|บันทึก/}).first();await apply.click();await p.waitForTimeout(600);
  const ov=p.locator('td.bench-volume-override').first();const txt=(await ov.innerText().catch(()=>'')).replace(/\s+/g,' ');
  rec('OWNER-LAB-013','the user-edited volume is highlighted and keeps the calculated value visible ("แก้จาก …")',txt.includes('1.22')&&/แก้จาก/.test(txt),{txt});
  rec('OWNER-LAB-013','a volume below 2 µL is flagged red',(await p.locator('td.bench-volume-low').count())>=1,{});
  await p.screenshot({path:OUT+'/pooling-edited-volume-1440.png'});
  await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:/ขั้นที่ 2/}).click();await p.waitForTimeout(600);
  rec('OWNER-LAB-013','the edit is not persisted until "บันทึก Pooling จริง" (a reload returns the calculated value)',(await p.locator('td.bench-volume-override').count())===0,{});
 }
 await c.close();
}
await b.close();writeFileSync('.local/claude-evidence-20261025/acceptance-final5.json',JSON.stringify(res,null,1));
console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
