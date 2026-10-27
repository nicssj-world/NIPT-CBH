"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {csrf} from "./p2/shared";
import {LabIcon} from "./shared/lab-icons";
import "./his-paths-panel.css";

/** OWNER-LAB-055/059 Settings → HIS Integration: change folders, let the worker test them, then Save/Apply — the running
 *  scanner and delivery worker use the new folders on their next job. */
type Name="pet"|"res"|"cfsPdf"|"backup"|"externalPdf";
type Test={state:"NOT_TESTED"|"RUNNING"|"PASSED"|"FAILED";errorCode?:string;warning?:string;report?:{workerAccount?:string|null;code?:string}};
type KeyView={activeRevision:{id:string;version:number;since:string}|null;usingDefaults:boolean;paths:Partial<Record<Name,string>>;enabled:boolean|null;pending:null|{id:string;version:number;paths:Partial<Record<Name,string>>;test:Test}};
type Overview={keys:Record<"his_inbound"|"his_outbound"|"result_management",KeyView>;history:{id:string;setting_key:string;version:number;state:string;created_at:string;reason:string;actor:string;pathChange:boolean}[]};
const FIELDS:{name:Name;key:keyof Overview["keys"];label:string;help:string}[]=[
 {name:"pet",key:"his_inbound",label:"PET + OK ขาเข้าจาก HIS",help:"โฟลเดอร์แม่ของโฟลเดอร์วัน YYYYMMDD · อ่านอย่างเดียว ไม่ย้ายหรือลบไฟล์ของ HIS"},
 {name:"res",key:"his_outbound",label:"RES + OK ขาออกไป HIS",help:"เขียน .res แล้วจึงเขียน .ok คู่กันในโฟลเดอร์เดียวกัน"},
 {name:"cfsPdf",key:"his_outbound",label:"PDF ผลสำหรับ CFS",help:"PDF ผลที่ตั้งชื่อใหม่สำหรับระบบ CFS"},
 {name:"backup",key:"his_outbound",label:"สำรองไฟล์ที่ส่ง HIS",help:"สำเนาไฟล์ที่ส่งออกทุกครั้ง (NIPTY เดิมไม่มีค่านี้ ต้องกำหนดเอง)"},
 {name:"externalPdf",key:"result_management",label:"PDF ผลจากภายนอก (ReadyGen / บริษัท)",help:"โฟลเดอร์ที่สแกนเมื่อกด “สแกนไฟล์ PDF” ในหน้าผลตรวจ"},
];
const ERROR:Record<string,string>={SHARE_PATH_NOT_FOUND:"ไม่พบโฟลเดอร์ — หรือ Worker มองไม่เห็นไดรฟ์นี้ (ไดรฟ์ที่ Map เฉพาะผู้ใช้ ให้ใช้ UNC เช่น \\\\server\\share)",SHARE_PERMISSION_DENIED:"บัญชี Worker ไม่มีสิทธิ์อ่าน/เขียนโฟลเดอร์นี้",
 SHARE_NOT_DIRECTORY:"เส้นทางนี้ไม่ใช่โฟลเดอร์",UNSAFE_SHARE_PATH:"รูปแบบเส้นทางไม่ถูกต้อง ต้องเป็นเส้นทางเต็ม เช่น D:\\Folder หรือ \\\\server\\share",SHARE_LINK_PROHIBITED:"เส้นทางผ่าน Shortcut/Junction ไม่อนุญาต",
 SHARE_SYSTEM_PATH_PROHIBITED:"ห้ามใช้โฟลเดอร์ระบบ Windows หรือโฟลเดอร์ข้อมูลของโปรแกรม",HIS_MIXED_DESTINATIONS_PROHIBITED:"ต้องกำหนดโฟลเดอร์ขาออกทั้ง RES, PDF และสำรองเป็นโฟลเดอร์จริงครบทุกช่อง",
 RESULT_FOLDER_NOT_ACCESSIBLE:"เปิดโฟลเดอร์ PDF ผลไม่ได้ — ตรวจเส้นทางและสิทธิ์",SHARE_READBACK_MISMATCH:"เขียนแล้วอ่านกลับไม่ตรง ตรวจสิทธิ์และพื้นที่โฟลเดอร์",HIS_CONFIGURATION_CHANGED:"การตั้งค่าถูกเปลี่ยนระหว่างทดสอบ กรุณาทดสอบใหม่"};
const when=(v:string)=>new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"});

async function call<T>(body?:unknown):Promise<T>{
 const r=await fetch("/api/settings/his-paths",{method:body?"POST":"GET",cache:"no-store",headers:body?{"content-type":"application/json","x-csrf-token":csrf()}:{},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error??"ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง");return d as T;
}

export function HisPathsPanel({canWrite}:{canWrite:boolean}){
 const [o,setO]=useState<Overview|null>(null),[edit,setEdit]=useState<Partial<Record<Name,string>>>({}),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const poll=useRef<ReturnType<typeof setTimeout>|null>(null);
 const load=useCallback(async()=>{try{const next=await call<Overview>();setO(next);setError("");return next;}catch(e){setError((e as Error).message);return null;}},[]);
 const pendings=o?Object.values(o.keys).map(k=>k.pending).filter((p):p is NonNullable<KeyView["pending"]>=>!!p):[];
 const running=pendings.some(p=>p.test.state==="RUNNING"||p.test.state==="NOT_TESTED");
 useEffect(()=>{let live=true;call<Overview>().then(next=>{if(live)setO(next);},e=>{if(live)setError((e as Error).message);});
  return()=>{live=false;if(poll.current)clearTimeout(poll.current);};},[]);
 useEffect(()=>{if(!running)return;poll.current=setTimeout(()=>void load(),1500);return()=>{if(poll.current)clearTimeout(poll.current);};},[running,o,load]);
 const changed=Object.fromEntries(Object.entries(edit).filter(([n,v])=>{const f=FIELDS.find(x=>x.name===n)!;return v!==undefined&&v.trim()!==(o?.keys[f.key].paths[n as Name]??"");}));
 // Owner 2026-10-27: one step. The folders are checked in this request; a usable change is Active at once, an unusable one is refused with the real reason.
 async function save(){setBusy(true);setError("");setNotice("");try{const r=await call<{saved:{key:string;version:number}[]}>({operation:"save",paths:changed,reason:reason.trim()||undefined});setEdit({});setReason("");await load();setNotice(`บันทึกและใช้งานแล้ว (${r.saved.length} หมวด) — Worker ใช้เส้นทางใหม่ตั้งแต่งานถัดไป ไม่ต้องเริ่มระบบใหม่`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!o)return error?<p className="notice" role="alert">{error}</p>:<p role="status">กำลังโหลด…</p>;
 return <section className="his-paths" aria-labelledby="his-paths-title">
  <header className="his-paths-head"><div><h2 id="his-paths-title">เส้นทางไฟล์ HIS</h2><p className="help">แก้เส้นทาง → บันทึกและใช้งาน ระบบตรวจโฟลเดอร์ให้ทันที ถ้าใช้งานได้จะมีผลตั้งแต่งานถัดไป ถ้าใช้ไม่ได้จะแจ้งสาเหตุและยังไม่บันทึก ไม่ต้องติดตั้งใหม่หรือเริ่มระบบใหม่</p></div></header>
  <div aria-live="polite">{error&&<p className="notice" role="alert">{error}</p>}{notice&&<p className="notice success" role="status">{notice}</p>}</div>
  <div className="his-paths-list">{FIELDS.map(f=>{const k=o.keys[f.key],cur=k.paths[f.name]??"",pend=k.pending?.paths[f.name],test=k.pending?.test,changedHere=k.pending&&pend!==cur;
   return <div key={f.name} className="his-path-row">
    <div className="his-path-label"><label htmlFor={`his-${f.name}`}>{f.label}</label><p className="help">{f.help}</p></div>
    <div className="his-path-current"><span className="his-path-caption">ใช้อยู่{k.usingDefaults?" (ค่าเริ่มต้นจาก NIPTY เดิม)":k.activeRevision?` · รุ่น ${k.activeRevision.version}`:""}</span><code>{cur||"—"}</code></div>
    <div className="his-path-edit">{canWrite&&<input id={`his-${f.name}`} type="text" spellCheck={false} autoComplete="off" placeholder="เส้นทางใหม่" value={edit[f.name]??""} onChange={e=>setEdit(x=>({...x,[f.name]:e.target.value}))} disabled={busy}/>}
     {changedHere&&test&&<p className={`his-path-test ${test.state.toLowerCase()}`}><LabIcon name={test.state==="PASSED"?"check":test.state==="FAILED"?"x":"clock"} size={16}/>
      {test.state==="PASSED"?`ทดสอบผ่าน: ${pend}${test.warning==="INBOUND_FOLDER_EMPTY"&&f.name==="pet"?" — ยังไม่พบโฟลเดอร์วัน YYYYMMDD หรือไฟล์ PET ตรวจว่าเป็นโฟลเดอร์ที่ HIS เขียนไฟล์จริง":""}`:test.state==="FAILED"?`${pend} — ${ERROR[test.errorCode??""]??test.errorCode}`:`กำลังทดสอบ ${pend}`}</p>}</div>
   </div>;})}</div>
  {pendings.some(p=>p.test.report?.workerAccount)&&<p className="help">ทดสอบโดยบัญชี Worker: <code>{pendings.find(p=>p.test.report?.workerAccount)?.test.report?.workerAccount}</code></p>}
  {canWrite&&<div className="his-paths-actions">
   <button type="button" className="button" disabled={busy||!Object.keys(changed).length} onClick={()=>void save()}><LabIcon name="save"/>{busy?"กำลังตรวจโฟลเดอร์และบันทึก…":"บันทึกและใช้งาน"}</button>
  </div>}
  <details className="his-paths-history"><summary>ประวัติการเปลี่ยน ({o.history.length})</summary><ul>{o.history.map(h=><li key={h.id}><span>{when(h.created_at)}</span><span>{h.setting_key} รุ่น {h.version}</span><span>{h.state==="Active"?"ใช้อยู่":"รุ่นก่อน"}</span><span>{h.actor}</span>{h.pathChange&&<span className="badge">เปลี่ยนเส้นทาง</span>}</li>)}</ul></details>
 </section>;
}
