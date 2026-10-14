"use client";
import {useEffect,useMemo,useState} from "react";
import {HisSettingsStatus} from "./his-settings-status";
import {useSearchParams} from "next/navigation";
type Category={key:string;category:string;risk:string;default:unknown;canPropose:boolean;canActivate:boolean};
type Revision={id:string;setting_key:string;version:number;state:string;created_by:string;approved_by:string|null;test_passed:boolean;value:unknown};
type FieldSpec={name:string;label:string;help:string;kind:"text"|"path"|"number"|"boolean"|"select"|"locked"|"date"|"hash"|"uuid-or-empty";options?:{value:string;label:string}[];unit?:string;min?:number;max?:number;lockedBy?:string};
type Form={key:string;title:string;summary:string;phase:string;fields:FieldSpec[]};
type Coverage={category:number;item:string;plan:string;nipty:string|null;source:string|null;status:string;phase:string;note:string};
type Values=Record<string,unknown>;
const CATEGORY_NO:Record<string,number>={"General":1,"ANC/Request & Consent":2,"ANC Doctors":3,"User/Role/Permission":4,"HIS Inbound":5,"Laboratory":6,"Result Management":7,"HIS Outbound/CFS":8,"Storage/NAS/Backup":9,"Notifications/System/Audit":10};
const RISK_TEXT:Record<string,string>={GENERAL:"ทั่วไป — เปิดใช้ได้หลังทดสอบ",SECURITY:"ความปลอดภัย",CLINICAL:"คลินิก — ต้องมีผู้อนุมัติอีกคน",INTEGRATION:"Integration — ต้องมีผู้อนุมัติอีกคน"};
const STATE_TEXT:Record<string,string>={Draft:"ร่าง",Validated:"ทดสอบผ่าน",Approved:"อนุมัติแล้ว",Active:"ใช้งานอยู่",Archived:"เก็บถาวร"};
const COVERAGE_TONE:Record<string,string>={Implemented:"good",Partial:"warning",Missing:"bad",Deferred:"",HOLD:"warning"};
const STATUSES=["Implemented","Partial","Missing","Deferred","HOLD"];

/** Labelled form per category (no hand-edited JSON). The server schema still validates; maker-checker and RBAC are unchanged. */
export function SettingsEditor(){
 const params=useSearchParams();
 const [userId,setUserId]=useState(""),[canApprove,setCanApprove]=useState(false),[canRetry,setCanRetry]=useState(false),[forms,setForms]=useState<Record<string,Form>>({}),[active,setActive]=useState<Values>({}),[coverage,setCoverage]=useState<Coverage[]>([]),[categories,setCategories]=useState<string[]>([]);
 const [catalog,setCatalog]=useState<Category[]>([]),[revisions,setRevisions]=useState<Revision[]>([]),[key,setKey]=useState(params.get("key")??"general"),[value,setValue]=useState<Values>({}),[reason,setReason]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 const startValue=(k:string,cat:Category[],act:Values)=>({...((cat.find(c=>c.key===k)?.default??{}) as Values),...((act[k]??{}) as Values)});
 async function load(){const r=await fetch("/api/settings");if(!r.ok)throw new Error();const d=await r.json();setUserId(d.userId);setCanApprove(d.canApprove);setCanRetry(d.canRetry);setCatalog(d.catalog);setRevisions(d.revisions);setForms(d.forms);setActive(d.active);setCoverage(d.coverage);setCategories(d.coverageCategories);return d as {catalog:Category[];active:Values};}
 useEffect(()=>{const wanted=params.get("key")??"general";Promise.resolve().then(load).then(d=>{const k=d.catalog.some(c=>c.key===wanted)?wanted:"general";setKey(k);setValue(startValue(k,d.catalog,d.active));}).catch(()=>setError("โหลดการตั้งค่าไม่ได้ กรุณาโหลดหน้านี้ใหม่"));},[params]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
 async function action(operation:string,id?:string){setBusy(true);setError("");setMessage("");try{const me=await fetch("/api/me").then(r=>r.json());const input={operation,id,key,value:operation==="propose"?value:undefined,reason};const r=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":me.csrf},body:JSON.stringify(input)});const data=await r.json();if(!r.ok){setError(data.error);return;}
  setMessage(data.queued?"เข้าคิวทดสอบที่ Worker แล้ว — รอผลในส่วน Test Connection ด้านล่าง แล้วบันทึกผลทดสอบผ่าน":operation==="propose"?"บันทึกร่างแล้ว — กด ทดสอบร่าง ในรายการรุ่นด้านล่างก่อนส่งอนุมัติ":operation==="validate"?"ทดสอบร่างแล้ว ตรวจผลในรายการรุ่น":"บันทึกการเปลี่ยนแปลงแล้ว ตรวจสถานะรุ่นด้านล่าง");setDirty(false);const d=await load();if(operation==="activate")setValue(startValue(key,d.catalog,d.active));}
  catch{setError("บันทึกไม่สำเร็จ หรือเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง");}finally{setBusy(false);}}
 const category=catalog.find(c=>c.key===key),form=forms[key];
 const rows=useMemo(()=>coverage.filter(c=>c.category===CATEGORY_NO[category?.category??""]),[coverage,category]);
 const set=(name:string,v:unknown)=>{setValue(x=>({...x,[name]:v}));setDirty(true);};
 const editable=!!category?.canPropose;
 const input=(f:FieldSpec)=>{const id=`setting-${f.name}`,v=value[f.name],help=<p id={`${id}-help`} className="help">{f.help}{f.unit?` · หน่วย: ${f.unit}`:""}</p>;
  if(f.kind==="locked")return <div className="field locked" key={f.name}><label htmlFor={id}>{f.label}<span className="locked-tag">{f.lockedBy}</span></label><input id={id} value={v===null||v===undefined?"ไม่มีค่า":String(v)} readOnly aria-readonly="true" aria-describedby={`${id}-help`}/>{help}</div>;
  if(f.kind==="boolean")return <div className="field" key={f.name}><label className="check-label"><input type="checkbox" checked={v===true} disabled={!editable} onChange={e=>set(f.name,e.target.checked)} aria-describedby={`${id}-help`}/> {f.label}</label>{help}</div>;
  if(f.kind==="select")return <div className="field" key={f.name}><label htmlFor={id}>{f.label}</label><select id={id} value={v===undefined?"":String(v)} disabled={!editable} onChange={e=>set(f.name,e.target.value===""?undefined:e.target.value)} aria-describedby={`${id}-help`}>{v===undefined&&<option value="">— ไม่กำหนด —</option>}{f.options!.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>{help}</div>;
  if(f.kind==="number")return <div className="field" key={f.name}><label htmlFor={id}>{f.label}{f.unit?` (${f.unit})`:""}</label><input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={typeof v==="number"?v:""} readOnly={!editable} onChange={e=>set(f.name,e.target.value===""?null:Number(e.target.value))} aria-describedby={`${id}-help`} required/>{help}</div>;
  return <div className="field" key={f.name}><label htmlFor={id}>{f.label}</label><input id={id} type={f.kind==="date"?"date":"text"} className={["path","hash","uuid-or-empty"].includes(f.kind)?"mono":undefined} spellCheck={false} value={v===null||v===undefined?"":String(v)} readOnly={!editable} maxLength={f.max??500}
   onChange={e=>set(f.name,f.kind==="uuid-or-empty"&&e.target.value===""?null:e.target.value)} aria-describedby={`${id}-help`} required={f.kind!=="uuid-or-empty"}/>{help}</div>;};
 return <>
  <div className="setting-layout"><section className="panel"><label htmlFor="category">หมวดการตั้งค่า</label>
   <select id="category" value={key} onChange={e=>{if(dirty&&!window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการเปลี่ยนหมวดและละทิ้งร่างหรือไม่?"))return;const next=e.target.value;setKey(next);setValue(startValue(next,catalog,active));setReason("");setDirty(false);setError("");setMessage("");}}>
    {catalog.map(c=><option key={c.key} value={c.key}>{CATEGORY_NO[c.category]}. {c.category} — {forms[c.key]?.title??c.key}</option>)}</select>
   <p className="help">ค่าใหม่มีผลเมื่อรุ่นนั้นถูกเปิดใช้เท่านั้น หมวดคลินิกและ Integration ต้องทดสอบและได้รับอนุมัติจากอีกคนก่อนเปิดใช้</p></section>
  <section className="panel"><h2>{form?.title??"กำลังโหลดการตั้งค่า…"}</h2><p className="muted">{form?.summary}{form?` · Phase ${form.phase}`:""} · ระดับ {RISK_TEXT[category?.risk??""]??"—"}</p>
   {!editable&&<p className="help">สิทธิ์ของคุณใช้ดูข้อมูลและตรวจรุ่นที่ได้รับอนุญาต</p>}
   <form className="stack" onSubmit={e=>{e.preventDefault();void action("propose");}}>
    <div className="setting-fields">{form?.fields.map(input)}</div>
    <details><summary>ดูค่าทั้งหมดแบบ JSON (อ่านอย่างเดียว)</summary><pre className="json-view">{JSON.stringify(value,null,2)}</pre></details>
    <p className="help">ห้ามใส่รหัสผ่านหรือข้อมูลผู้ป่วย — Secret เก็บแยกในช่องทาง Secret</p>
    {editable&&<><div className="field"><label htmlFor="setting-reason">เหตุผลที่เปลี่ยน</label><input id="setting-reason" value={reason} onChange={e=>{setReason(e.target.value);setDirty(true);}} maxLength={250} required/></div>
     <div className="action-bar"><button className="button" disabled={busy||!category}>{busy?"กำลังบันทึก…":"บันทึกร่าง"}</button></div></>}
   </form></section></div>
  <div aria-live="polite">{message&&<p className="notice success" role="status">{message}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  {["his_inbound","his_outbound"].includes(key)&&<HisSettingsStatus settingKey={key} activeId={revisions.find(r=>r.setting_key===key&&r.state==="Active")?.id} canTest={!!category?.canPropose} canRetry={canRetry} draftIds={revisions.filter(r=>r.setting_key===key&&r.state==="Draft"&&r.created_by===userId).map(r=>r.id)} onValidate={id=>void action("validate",id)}/>}
  <section className="panel"><h2>รุ่นการตั้งค่า</h2>{revisions.filter(r=>r.setting_key===key).length?<ul className="timeline">{revisions.filter(r=>r.setting_key===key).map(r=><li key={r.id}><div className="row"><strong>รุ่น {r.version}</strong><span>{STATE_TEXT[r.state]??r.state}</span><span>{r.test_passed?"ทดสอบผ่าน":"ยังไม่ผ่านการทดสอบ"}</span></div><div className="row">{r.state==="Draft"&&r.created_by===userId&&category?.canPropose&&<button className="button secondary" disabled={busy} onClick={()=>action("validate",r.id)}>ทดสอบร่าง</button>}{r.state==="Validated"&&<>{canApprove&&r.created_by!==userId&&<button className="button secondary" disabled={busy} onClick={()=>action("approve",r.id)}>อนุมัติ (ผู้ตรวจอีกคน)</button>}{category?.canActivate&&!["CLINICAL","INTEGRATION"].includes(category.risk)&&<button className="button secondary" disabled={busy} onClick={()=>action("activate",r.id)}>เปิดใช้</button>}</>}{r.state==="Approved"&&category?.canActivate&&r.created_by!==userId&&<button className="button" disabled={busy} onClick={()=>action("activate",r.id)}>เปิดใช้รุ่นที่อนุมัติแล้ว</button>}{r.state==="Archived"&&category?.canPropose&&<button className="button secondary" disabled={busy} onClick={()=>action("rollback",r.id)}>สร้างร่างคืนค่ารุ่นนี้</button>}</div></li>)}</ul>:<p>ยังไม่มีรุ่นที่บันทึก ระบบใช้ค่าเริ่มต้น</p>}</section>
  <section className="panel" aria-labelledby="coverage-h"><h2 id="coverage-h">ความครอบคลุมของหมวดนี้ (Settings Coverage)</h2>
   <p className="help">เทียบ Implementation Plan §13.2 กับ Settings ของ NIPTY เดิมและระบบปัจจุบัน — Deferred = อยู่ใน Phase ถัดไป · HOLD = รอการตัดสินใจของเจ้าของงาน/IT</p>
   <div className="table-wrap" role="region" aria-label="ตารางความครอบคลุมของหมวด" tabIndex={0}><table className="data-table coverage-table"><thead><tr><th scope="col">รายการ</th><th scope="col">Plan</th><th scope="col">NIPTY เดิม</th><th scope="col">NIPT CBH</th><th scope="col">สถานะ</th><th scope="col">Phase</th><th scope="col">หมายเหตุ</th></tr></thead>
    <tbody>{rows.map(c=><tr key={c.item}><td>{c.item}</td><td>{c.plan}</td><td className="mono">{c.nipty??"—"}</td><td className="mono">{c.source??"—"}</td><td><span className={`status ${COVERAGE_TONE[c.status]}`}>{c.status}</span></td><td>{c.phase}</td><td>{c.note||"—"}</td></tr>)}</tbody></table></div>
   <details><summary>สรุปทั้ง 10 หมวด</summary><div className="table-wrap" role="region" aria-label="สรุปความครอบคลุม" tabIndex={0}><table className="data-table coverage-summary"><thead><tr><th scope="col">หมวด</th>{STATUSES.map(s=><th scope="col" key={s} className="num">{s}</th>)}</tr></thead>
    <tbody>{categories.map((name,i)=><tr key={name}><td>{i+1}. {name}</td>{STATUSES.map(s=><td key={s} className="num">{coverage.filter(c=>c.category===i+1&&c.status===s).length}</td>)}</tr>)}</tbody></table></div></details>
  </section>
 </>;
}
