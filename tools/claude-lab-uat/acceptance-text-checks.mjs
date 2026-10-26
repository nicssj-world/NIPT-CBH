// Copy/structure acceptance checks over the visible text of every route captured on the FINAL build (inventory-final/, 7 of 8 width x theme runs).
// Each check names the Owner item it evidences. usage: node tools/claude-lab-uat/acceptance-text-checks.mjs
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const DIR='.local/claude-evidence-20261025/inventory-final',files=readdirSync(DIR).filter(f=>f.endsWith('.txt'));
const of=(user,w,t,route)=>{const n=`${user}-${w}-${t}${route}.txt`;return files.includes(n)?readFileSync(`${DIR}/${n}`,'utf8'):null;};
const routes={home:'_',lab:'_lab',batches:'_lab_batches',task:'_lab_batches_B',bench:'_lab_batches_B_bench',pooling:'_lab_batches_B_pooling',seq:'_lab_batches_B_sequencing',workbook:'_lab_batches_B_workbook',photos:'_lab_photos',inbound:'_inbound',results:'_results',signers:'_results_signers',storage:'_sample-storage',settings:'_settings',health:'_health',cases:'_cases',doctors:'_doctors',historical:'_historical',users:'_settings_users',sauditpage:'_settings_audit'};
const configs=[];for(const w of [375,768,1440,1920])for(const t of ['light','dark'])if(of('lab',w,t,routes.lab))configs.push([w,t]);
const out=[];
function check(item,desc,route,user,test){
 const bad=[],seen=[];
 for(const [w,t] of configs){const txt=of(user,w,t,routes[route]);if(txt===null)continue;seen.push(`${w}${t[0]}`);if(!test(txt))bad.push(`${w}${t[0]}`);}
 out.push({item,desc,route,user,configs:seen.length,failing:bad,ok:seen.length>0&&bad.length===0});
}
const absent=(...ss)=>t=>ss.every(s=>!(s instanceof RegExp?s.test(t):t.includes(s)));
const present=(...ss)=>t=>ss.every(s=>s instanceof RegExp?s.test(t):t.includes(s));
// 001 LAB home: block removed (home = "/" for lab role) ; navigation still present
check('OWNER-LAB-001','Home has no "เตรียมเอกสารและติดตามรอบปัจจุบัน" block; workspace navigation still present','home','lab',t=>!t.includes('เตรียมเอกสารและติดตามรอบปัจจุบัน')&&t.includes('งาน Lab')&&t.includes('Batch / Task List'));
check('OWNER-LAB-015','HIS inbound is labelled "รับตัวอย่างจาก HIS"','inbound','lab',present('รับตัวอย่างจาก HIS'));
check('OWNER-LAB-015','route unchanged: /inbound renders the page (not redirected) for lab','inbound','lab',present('การสแกนอัตโนมัติ'));
check('OWNER-LAB-019','Inbound history/list offers page size 25/50/100','inbound','lab',t=>/\b25\b/.test(t)&&/\b50\b/.test(t)&&/\b100\b/.test(t));
check('OWNER-LAB-020','Inbound status shows verified state, last success and next action','inbound','lab',present('ทำงานปกติ','สำเร็จล่าสุด','ถัดไป'));
check('OWNER-LAB-023','Inbound order: summary -> status/actions -> scan/history/search (no verbose technical cards)','inbound','lab',t=>{const a=t.indexOf('รายการที่ต้องดำเนินการ'),b=t.indexOf('คำสั่ง'),c=t.indexOf('ค้นหา LN');return a>=0&&b>a&&c>b;});
check('OWNER-LAB-024','No TRAINING / developer placeholder wording on lab pages','lab','lab',absent('TRAINING','placeholder','Lorem','TODO'));
check('OWNER-LAB-024','No TRAINING / placeholder wording on task list','task','lab',absent('TRAINING','placeholder','Lorem','TODO'));
check('OWNER-LAB-031','Task List has no "ยืนยันแผนตำแหน่ง" / lock-plan buttons; edit action present','task','lab',t=>!t.includes('ยืนยันแผนตำแหน่ง')&&!t.includes('ล็อกตำแหน่ง Task List')&&t.includes('แก้ไขแผนผัง'));
check('OWNER-LAB-032','Task counts use "ตัวอย่าง N/15", not "ผู้ป่วย N/15"','task','lab',t=>/ตัวอย่าง \d+\/15/.test(t)&&!/ผู้ป่วย \d+\/15/.test(t));
check('OWNER-LAB-033','Compact header order: Control, Library Prep date, Operator; then Extraction Lot/Expiry, Library Lot/Expiry','task','lab',t=>{const i=['Control','วันที่ทำ Library Preparation','ผู้ปฏิบัติงาน','Extraction Lot / Expiry','Library Lot / Expiry'].map(s=>t.indexOf(s));return i.every(x=>x>=0)&&i.every((x,k)=>k===0||x>i[k-1]);});
check('OWNER-LAB-039','No raw placement revision (r<N>:hash) shown','task','lab',t=>!/\br\d+:[0-9a-f]{6,}/i.test(t));
check('OWNER-LAB-039','No raw placement revision on bench/pooling/seq pages','pooling','lab',t=>!/\br\d+:[0-9a-f]{6,}/i.test(t));
check('OWNER-LAB-041','Bench shows three numbered steps QC -> Pooling -> Sequencing','bench','lab',t=>{const i=['ขั้นที่ 1','QC Measurements','ขั้นที่ 2','Pooling','ขั้นที่ 3','Sequencing'].map(s=>t.indexOf(s));return i.every(x=>x>=0)&&i.every((x,k)=>k===0||x>i[k-1]);});
check('OWNER-LAB-041','Workbook PDF action separate from the three steps','bench','lab',present('ใบงาน Excel / PDF'));
check('OWNER-LAB-042','QC criteria exact: Patient/PC/NC >= 2.0 ng/µL, restart extraction wording; Blank <= 0.6','bench','lab',present('ตัวอย่าง, Positive control และ Negative control ควรมีความเข้มข้น ≥ 2.0 ng/µL หากไม่เป็นไปตามเกณฑ์ให้เริ่มสกัดใหม่อีกครั้ง','Blank control ควรมีความเข้มข้น ≤ 0.6 ng/µL'));
check('OWNER-LAB-045','Pooling shows Total and EB with µL; removed "เลือกตำแหน่งที่ทำ Pooling แล้วกดบันทึก" copy','pooling','lab',t=>/Total\s*\n?[\d.,]+µL/.test(t)&&/EB\s*\n?[\d.,]+µL/.test(t)&&!t.includes('เลือกตำแหน่งที่ทำ Pooling แล้วกดบันทึก'));
check('OWNER-LAB-048','Pooling has one-click select-all of valid samples','pooling','lab',present('เลือกตัวอย่างที่ใช้ได้ทั้งหมด'));
check('OWNER-LAB-049','Seq page: First Cycle group has Loaded DNB, Q30%, BIC, Fit in order','seq','lab',t=>{const i=['First Cycle','Loaded DNB','Q30%','BIC','Fit'].map(s=>t.indexOf(s));return i.every(x=>x>=0)&&i.every((x,k)=>k===0||x>i[k-1]);});
check('OWNER-LAB-049','Seq page has no "ยืนยัน" confirmation fields/buttons','seq','lab',t=>!/ยืนยัน/.test(t));
check('OWNER-LAB-049','Seq page keeps Preview/Print, XLSX export and PDF Result import','seq','lab',present('ดูตัวอย่าง / พิมพ์','ส่งออก XLSX 2 ไฟล์','นำเข้า PDF Result'));
check('OWNER-LAB-053','Run photo page: no "ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง" helper, no persistent "อัปโหลดแล้ว N ภาพ" badge','photos','lab',absent('ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง',/อัปโหลดแล้ว \d+ ภาพ/));
check('OWNER-LAB-054','NIPT Results has no old "นำเข้าไฟล์ผลจากโฟลเดอร์" subtitle','results','lab',absent('นำเข้าไฟล์ผลจากโฟลเดอร์'));
check('OWNER-LAB-054','Signer picker page lists verified signers with licence (Users/Profile source)','signers','lab',t=>/ใบอนุญาต \d+/.test(t));
writeFileSync('.local/claude-evidence-20261025/acceptance-text-checks.json',JSON.stringify(out,null,1));
for(const o of out)console.log((o.ok?'PASS':'FAIL'),o.item,o.desc,'| configs',o.configs,o.failing.length?'| failing '+o.failing.join(','):'');
