"use client";
import {notifySaved} from "./shared/save-notice";
import {useEffect,useMemo,useState} from "react";
import {HisSettingsStatus} from "./his-settings-status";
import {HisProfileFields,HisCertifierFields} from './his-profile-fields';
import {useSearchParams,useRouter} from "next/navigation";
import {Required,useUnsaved,thaiTime} from './admin-console';
type Category={key:string;category:string;risk:string;default:unknown;directSave?:boolean;canPropose:boolean;canActivate:boolean};
type Scope={enabled:boolean;alreadyEnabled:boolean;lookbackDays:number;intervalSeconds:number;basePath:string;dayFolders:number|null;pairedPetFiles:number|null;petFiles:number|null;sampleParse:string|null;accessible:boolean;errorCode:string|null};
type Revision={id:string;setting_key:string;version:number;state:string;created_by:string;created_name?:string;created_username?:string;created_at:string;effective_from:string;activated_at:string|null;approved_by:string|null;test_passed:boolean;value:unknown};
type FieldSpec={name:string;label:string;help:string;kind:"text"|"path"|"number"|"boolean"|"select"|"locked"|"date"|"hash"|"uuid-or-empty"|"res-profile"|"his-certifiers";options?:{value:string;label:string}[];unit?:string;min?:number;max?:number;lockedBy?:string};
type Form={key:string;title:string;summary:string;phase:string;fields:FieldSpec[]};
type Coverage={category:number;item:string;plan:string;nipty:string|null;source:string|null;status:string;phase:string;note:string};
type Values=Record<string,unknown>;
const CATEGORY_NO:Record<string,number>={"General":1,"ANC/Request & Consent":2,"ANC Doctors":3,"User/Role/Permission":4,"HIS Inbound":5,"Laboratory":6,"Result Management":7,"HIS Outbound/CFS":8,"Storage/NAS/Backup":9,"Notifications/System/Audit":10};
const RISK_TEXT:Record<string,string>={GENERAL:"ทั่วไป — เปิดใช้ได้หลังทดสอบ",SECURITY:"ความปลอดภัย",CLINICAL:"คลินิก — ต้องมีผู้อนุมัติอีกคน",INTEGRATION:"Integration — ต้องมีผู้อนุมัติอีกคน"};
const DIRECT_TEXT="การตั้งค่าระบบ — ผู้ดูแลระบบบันทึกแล้วใช้งานทันที ไม่ต้องมีผู้อนุมัติและไม่ต้องกรอกเหตุผล";
const STATE_TEXT:Record<string,string>={Draft:"ร่าง",Validated:"ทดสอบผ่าน",Approved:"อนุมัติแล้ว",Active:"ใช้งานอยู่",Archived:"เก็บถาวร"};
const COVERAGE_TONE:Record<string,string>={Implemented:"good",Partial:"warning",Missing:"bad",Deferred:"",HOLD:"warning"};
const STATUSES=["Implemented","Partial","Missing","Deferred","HOLD","Installation-owned","Locked"];

/** Labelled form per category (no hand-edited JSON). The server schema still validates; maker-checker and RBAC are unchanged. */
export function SettingsEditor(){
 const [search,setSearch]=useState('');
 const [certifierUsers,setCertifierUsers]=useState<{id:string;display_name:string}[]>([]);
 const params=useSearchParams();const router=useRouter();
 const [userId,setUserId]=useState(""),[canApprove,setCanApprove]=useState(false),[canRetry,setCanRetry]=useState(false),[forms,setForms]=useState<Record<string,Form>>({}),[active,setActive]=useState<Values>({}),[coverage,setCoverage]=useState<Coverage[]>([]),[categories,setCategories]=useState<string[]>([]);
 const [catalog,setCatalog]=useState<Category[]>([]),[revisions,setRevisions]=useState<Revision[]>([]),[key,setKey]=useState(params.get("key")??"general"),[value,setValue]=useState<Values>({}),[reason,setReason]=useState(""),[scope,setScope]=useState<Scope|null>(null),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 const startValue=(k:string,cat:Category[],act:Values)=>({...((cat.find(c=>c.key===k)?.default??{}) as Values),...((act[k]??{}) as Values)});
 async function load(){const r=await fetch("/api/settings");if(!r.ok)throw new Error();const d=await r.json();setUserId(d.userId);setCertifierUsers(d.certifierUsers??[]);setCanApprove(d.canApprove);setCanRetry(d.canRetry);setCatalog(d.catalog);setRevisions(d.revisions);setForms(d.forms);setActive(d.active);setCoverage(d.coverage);setCategories(d.coverageCategories);return d as {catalog:Category[];active:Values};}
 useEffect(()=>{const wanted=params.get("key")??"general";Promise.resolve().then(load).then(d=>{const k=d.catalog.some(c=>c.key===wanted)?wanted:"general";setKey(k);setValue(startValue(k,d.catalog,d.active));}).catch(()=>setError("โหลดการตั้งค่าไม่ได้ กรุณาโหลดหน้านี้ใหม่"));},[params]);
 useUnsaved(dirty);
 async function action(operation:string,id?:string){setBusy(true);setError("");setMessage("");try{const me=await fetch("/api/me").then(r=>r.json());const input={operation,id,key,value:operation==="propose"?value:undefined,reason};const r=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":me.csrf},body:JSON.stringify(input)});const data=await r.json();if(!r.ok){setError(data.error);return;}if(!data.queued)notifySaved();
  setMessage(data.queued?"เข้าคิวทดสอบที่ Worker แล้ว — รอผลในส่วน Test Connection ด้านล่าง แล้วบันทึกผลทดสอบผ่าน":operation==="propose"?"บันทึกร่างแล้ว — กด ทดสอบร่าง ในรายการรุ่นด้านล่างก่อนส่งอนุมัติ":operation==="validate"?"ทดสอบร่างแล้ว ตรวจผลในรายการรุ่น":"บันทึกการเปลี่ยนแปลงแล้ว ตรวจสถานะรุ่นด้านล่าง");setDirty(false);const d=await load();if(operation==="activate"){setValue(startValue(key,d.catalog,d.active));router.refresh();}}
  catch{setError("บันทึกไม่สำเร็จ หรือเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง");}finally{setBusy(false);}}
 // Owner 2026-10-27: system configuration is one step - save and it is Active. Only first-time Auto Scan asks to see what it will scan.
 async function saveDirect(confirmFirstScan=false){setBusy(true);setError("");setMessage("");try{
  const me=await fetch("/api/me").then(r=>r.json());const headers={"Content-Type":"application/json","x-csrf-token":me.csrf};
  if(key==="his_inbound"&&value.enabled===true&&(active.his_inbound as {enabled?:boolean}|undefined)?.enabled!==true&&!confirmFirstScan){
   const s=await fetch("/api/settings",{method:"POST",headers,body:JSON.stringify({operation:"scope",key,value})});const sd=await s.json();if(!s.ok){setError(sd.error);return;}setScope(sd as Scope);return;}
  const r=await fetch("/api/settings",{method:"POST",headers,body:JSON.stringify({operation:"save",key,value,reason:reason.trim()||undefined,confirmFirstScan})});const data=await r.json();
  if(!r.ok){setError(data.error);return;}
  setScope(null);const d=await load();setValue(startValue(key,d.catalog,d.active));setDirty(false);
  if(data.unchanged){setMessage("ไม่มีค่าที่เปลี่ยน — ค่าที่ใช้งานอยู่ยังเหมือนเดิม");return;}
  notifySaved();setMessage(`บันทึกและใช้งานแล้ว (รุ่น ${data.version}) — มีผลทันที ไม่ต้องเริ่มระบบใหม่`);
 }catch{setError("บันทึกไม่สำเร็จ หรือเชื่อมต่อไม่ได้ ค่าที่ใช้งานอยู่ยังไม่เปลี่ยน กรุณาลองอีกครั้ง");}finally{setBusy(false);}}
 const category=catalog.find(c=>c.key===key),form=forms[key],direct=!!category?.directSave;
 const rows=useMemo(()=>coverage.filter(c=>c.category===CATEGORY_NO[category?.category??""]),[coverage,category]);
 const set=(name:string,v:unknown)=>{setValue(x=>({...x,[name]:v}));setDirty(true);};
 const editable=!!category?.canPropose&&!['storage_backup','doctor_registry'].includes(key);
 const input=(f:FieldSpec)=>{const id=`setting-${f.name}`,v=value[f.name],help=<p id={`${id}-help`} className="help">{f.help}{f.unit?` · หน่วย: ${f.unit}`:""}</p>;
  if(f.kind==='res-profile')return <HisProfileFields key={f.name} value={v} editable={editable} onChange={v=>set(f.name,v)}/>;
  if(f.kind==='his-certifiers')return <HisCertifierFields key={f.name} value={v} users={certifierUsers} editable={editable} onChange={v=>set(f.name,v)}/>;
  const unused=(key==='doctor_registry'&&f.name==='version')||(key==='laboratory'&&['templateVersion','formulaVersion'].includes(f.name));
  if(f.kind==="locked"||unused||key==='storage_backup')return <div className="field locked" key={f.name}><label htmlFor={id}>{f.label}<span className="locked-tag">{unused?(key==='laboratory'?'METADATA ONLY · บันทึกใน Batch ไม่เปลี่ยน Template/สูตรควบคุม':'NOT IMPLEMENTED · ยังไม่มี Runtime Consumer ของค่านี้'):key==='storage_backup'?'INSTALLATION-OWNED · ค่าในเว็บไม่มีผลต่อ Retention':f.lockedBy}</span></label><input id={id} value={v===null||v===undefined?"ไม่มีค่า":String(v)} readOnly aria-readonly="true" aria-describedby={`${id}-help`}/>{help}</div>;
  if(f.kind==="boolean")return <div className="field" key={f.name}><label className="check-label"><input type="checkbox" checked={v===true} disabled={!editable} onChange={e=>set(f.name,e.target.checked)} aria-describedby={`${id}-help`}/> {f.label}</label>{help}</div>;
  if(f.kind==="select")return <div className="field" key={f.name}><label htmlFor={id}>{f.label}<Required/></label><select id={id} value={v===undefined||v===null?"":String(v)} disabled={!editable} onChange={e=>set(f.name,e.target.value===""?(f.name==="round2SpecimenDatePolicy"?null:undefined):e.target.value)} aria-describedby={`${id}-help`}>{v===undefined&&<option value="">— ไม่กำหนด —</option>}{f.options!.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>{help}</div>;
  if(f.kind==="number")return <div className="field" key={f.name}><label htmlFor={id}>{f.label}<Required/>{f.unit?` (${f.unit})`:""}</label><input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={typeof v==="number"?v:""} readOnly={!editable} onChange={e=>set(f.name,e.target.value===""?null:Number(e.target.value))} aria-describedby={`${id}-help`} required/>{help}</div>;
  return <div className="field" key={f.name}><label htmlFor={id}>{f.label}{f.kind!=="uuid-or-empty"&&<Required/>}</label><input id={id} type={f.kind==="date"?"date":"text"} className={["path","hash","uuid-or-empty"].includes(f.kind)?"mono":undefined} spellCheck={false} value={v===null||v===undefined||v===null?"":String(v)} readOnly={!editable} maxLength={f.max??500}
   onChange={e=>set(f.name,f.kind==="uuid-or-empty"&&e.target.value===""?null:e.target.value)} aria-describedby={`${id}-help`} required={f.kind!=="uuid-or-empty"}/>{help}</div>;};
 return <>
  <div className="setting-layout"><section className="panel"><label htmlFor="settings-search">ค้นหาการตั้งค่า</label><input id="settings-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/>
   <nav className="settings-groups" aria-label="หมวดการตั้งค่า">{[...catalog].sort((x,y)=>(CATEGORY_NO[x.category]??99)-(CATEGORY_NO[y.category]??99)).filter(c=>`${c.category} ${forms[c.key]?.title} ${forms[c.key]?.fields.map(f=>f.label).join(' ')}`.toLowerCase().includes(search.toLowerCase())).map(c=><button className="button secondary" key={c.key} aria-current={key===c.key?'page':undefined} onClick={()=>{if(dirty&&!window.confirm('มีข้อมูลที่ยังไม่บันทึก ต้องการเปลี่ยนหมวดหรือไม่?'))return;setKey(c.key);setValue(startValue(c.key,catalog,active));setReason('');setDirty(false);setError('');setMessage('');}}>{CATEGORY_NO[c.category]}. {forms[c.key]?.title??c.category}<span className="help">{revisions.find(r=>r.setting_key===c.key&&r.state==='Active')?'กำลังใช้งาน':'ค่าเริ่มต้น'}{revisions.some(r=>r.setting_key===c.key&&['Draft','Validated','Approved'].includes(r.state))?' · มีฉบับที่ยังไม่เปิดใช้':''}{forms[c.key]?.fields.some(f=>f.kind==='locked')?' · กำหนดค่าไว้แล้ว':''}</span></button>)}</nav>
   <p className="help">การตั้งค่าระบบ (HIS, Laboratory, ทั่วไป ฯลฯ) ผู้ดูแลระบบบันทึกแล้วใช้งานทันที ส่วนหมวดคลินิกที่เกี่ยวกับการรับรอง/ปล่อยผลยังต้องมีผู้อนุมัติอีกคน</p></section>
  <section className="panel"><h2>{form?.title??"กำลังโหลดการตั้งค่า…"}</h2><p className="muted">{form?.summary} · ระดับ {direct?DIRECT_TEXT:(RISK_TEXT[category?.risk??""]??"—")}</p>
   {!editable&&<p className="help">สิทธิ์ของคุณใช้ดูข้อมูลและตรวจรุ่นที่ได้รับอนุญาต</p>}
   <form className="stack" onSubmit={e=>{e.preventDefault();if(direct)void saveDirect();else void action("propose");}}>
    <div className="setting-fields">{form?.fields.map(input)}</div>
    <details><summary>ดูค่าทั้งหมดแบบ JSON (อ่านอย่างเดียว)</summary><pre className="json-view">{JSON.stringify(value,null,2)}</pre></details>
    <p className="help">ห้ามใส่รหัสผ่านหรือข้อมูลผู้ป่วย — Secret เก็บแยกในช่องทาง Secret</p>
    {editable&&direct&&<div className="action-bar"><button className="button" disabled={busy||!category||!!scope}>{busy?"กำลังบันทึก…":"บันทึกและใช้งาน"}</button></div>}
    {editable&&!direct&&<><div className="field"><label htmlFor="setting-reason">เหตุผลที่เปลี่ยน (ไม่บังคับ)</label><input id="setting-reason" value={reason} onChange={e=>{setReason(e.target.value);setDirty(true);}} maxLength={250}/></div>
     <div className="action-bar"><button className="button" disabled={busy||!category}>{busy?"กำลังบันทึก…":"บันทึกร่าง"}</button></div></>}
   </form></section></div>
  {scope&&<section className="panel" role="alertdialog" aria-labelledby="scan-scope-h" aria-describedby="scan-scope-d"><h2 id="scan-scope-h">ยืนยันการเปิด Auto Scan ครั้งแรก</h2>
   <p id="scan-scope-d">ระบบจะอ่านโฟลเดอร์ PET จาก HIS ย้อนหลัง {scope.lookbackDays} วัน ทุก {scope.intervalSeconds} วินาที แล้วนำไฟล์ที่พบเข้าสู่รายการรอลงทะเบียน (อ่านอย่างเดียว ไม่ย้ายหรือลบไฟล์ของ HIS)</p>
   <p className="mono">{scope.basePath}</p>
   {scope.errorCode&&!scope.accessible?<p className="notice" role="alert">เข้าถึงโฟลเดอร์นี้ไม่ได้ขณะนี้ ({scope.errorCode}) — ยืนยันได้ แต่การสแกนจะรายงานข้อผิดพลาดจนกว่าจะแก้เส้นทางหรือสิทธิ์</p>:<p role="status">ขณะนี้พบโฟลเดอร์วัน {scope.dayFolders??0} โฟลเดอร์ และไฟล์ PET+OK ครบคู่ {scope.pairedPetFiles??0} คู่ ในช่วงย้อนหลัง {scope.lookbackDays} วัน</p>}
   <div className="action-bar"><button type="button" className="button" disabled={busy} onClick={()=>void saveDirect(true)}>ยืนยันเปิด Auto Scan และบันทึก</button> <button type="button" className="button secondary" disabled={busy} onClick={()=>setScope(null)}>ยกเลิก</button></div></section>}
  <div aria-live="polite">{message&&<p className="notice success" role="status">{message}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  {["his_inbound","his_outbound"].includes(key)&&<HisSettingsStatus settingKey={key} activeId={revisions.find(r=>r.setting_key===key&&r.state==="Active")?.id} canTest={!!category?.canPropose} canRetry={canRetry} draftIds={direct?[]:revisions.filter(r=>r.setting_key===key&&r.state==="Draft"&&r.created_by===userId).map(r=>r.id)} onValidate={id=>void action("validate",id)}/>}
  <section className="panel"><h2>รุ่นการตั้งค่า</h2><p className="help">แสดง Active Revision เสมอ พร้อมประวัติล่าสุด 100 รายการ; ประวัติเหตุการณ์ทั้งหมดดูได้ใน Audit Log</p>{revisions.filter(r=>r.setting_key===key).length?<ul className="timeline">{revisions.filter(r=>r.setting_key===key).map(r=><li key={r.id}><div className="row"><strong>รุ่น {r.version}</strong><span>ผู้แก้ไข {r.created_name??r.created_by} ({r.created_username??"—"}) · {thaiTime(r.created_at)} · กำหนดมีผล {thaiTime(r.effective_from)} · เปิดใช้จริง {r.activated_at?thaiTime(r.activated_at):"ยังไม่มีหลักฐานเปิดใช้"}</span><span>{STATE_TEXT[r.state]??r.state}</span><span>{r.test_passed?"ทดสอบผ่าน":"ยังไม่ผ่านการทดสอบ"}</span></div><div className="row">{r.state==="Draft"&&r.created_by===userId&&category?.canPropose&&<button className="button secondary" disabled={busy} onClick={()=>action("validate",r.id)}>ทดสอบร่าง</button>}{r.state==="Validated"&&<>{canApprove&&key!=="storage_backup"&&r.created_by!==userId&&<button className="button secondary" disabled={busy} onClick={()=>action("approve",r.id)}>อนุมัติ (ผู้ตรวจอีกคน)</button>}{category?.canActivate&&!["CLINICAL","INTEGRATION"].includes(category.risk)&&<button className="button secondary" disabled={busy} onClick={()=>action("activate",r.id)}>เปิดใช้</button>}</>}{r.state==="Approved"&&category?.canActivate&&r.created_by!==userId&&<button className="button" disabled={busy} onClick={()=>action("activate",r.id)}>เปิดใช้รุ่นที่อนุมัติแล้ว</button>}{r.state==="Archived"&&category?.canPropose&&<button className="button secondary" disabled={busy} onClick={()=>action("rollback",r.id)}>สร้างร่างคืนค่ารุ่นนี้</button>}</div></li>)}</ul>:<p>ยังไม่มีรุ่นที่บันทึก ระบบใช้ค่าเริ่มต้น</p>}</section>
  <section className="panel" aria-labelledby="coverage-h"><h2 id="coverage-h">ความครอบคลุมของหมวดนี้ (Settings Coverage)</h2>
   <p className="help">เทียบ Implementation Plan §13.2 กับ Settings ของ NIPTY เดิมและระบบปัจจุบัน — Deferred = อยู่ใน Phase ถัดไป · HOLD = รอการตัดสินใจของเจ้าของงาน/IT</p>
   <div className="table-wrap" role="region" aria-label="ตารางความครอบคลุมของหมวด" tabIndex={0}><table className="data-table coverage-table"><thead><tr><th scope="col">รายการ</th><th scope="col">Plan</th><th scope="col">NIPTY เดิม</th><th scope="col">NIPT CBH</th><th scope="col">สถานะ</th><th scope="col">Phase</th><th scope="col">หมายเหตุ</th></tr></thead>
    <tbody>{rows.map(c=><tr key={c.item}><td>{c.item}</td><td>{c.plan}</td><td className="mono">{c.nipty??"—"}</td><td className="mono">{c.source??"—"}</td><td><span className={`status ${COVERAGE_TONE[c.status]}`}>{c.status}</span></td><td>{c.phase}</td><td>{c.note||"—"}</td></tr>)}</tbody></table></div>
   <details><summary>สรุปทั้ง 10 หมวด</summary><div className="table-wrap" role="region" aria-label="สรุปความครอบคลุม" tabIndex={0}><table className="data-table coverage-summary"><thead><tr><th scope="col">หมวด</th>{STATUSES.map(s=><th scope="col" key={s} className="num">{s}</th>)}</tr></thead>
    <tbody>{categories.map((name,i)=><tr key={name}><td>{i+1}. {name}</td>{STATUSES.map(s=><td key={s} className="num">{coverage.filter(c=>c.category===i+1&&c.status===s).length}</td>)}</tr>)}</tbody></table></div></details>
  </section>
 </>;
}
