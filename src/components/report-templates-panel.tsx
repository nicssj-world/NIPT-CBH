"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {csrf} from "./p2/shared";
import {LabIcon} from "./shared/lab-icons";
import "./report-templates-panel.css";

/** OWNER-LAB-056 Settings → แม่แบบรายงาน: bring a Word template (upload or server folder), see exactly what the system found,
 *  test it (Word renders a watermarked preview that must read back like a real report), get an independent approval, activate. */
type Kind="SINGLETON"|"TWIN";
type Insp={errors:{code:string;detail?:unknown}[];warnings:{code:string}[];found:string[];unknown:{token:string;suggestion:string|null}[];missing:string[];ambiguous:string[];product:string|null;code:string|null};
type Rev={id:string;version:number;state:string;name:string;size:number;sha256:string;code:string|null;product:string|null;source:string;createdAt:string;reason:string;createdBy:string;approvedBy:string|null;tested:boolean;hasPreview:boolean;inspection:Insp;productAcknowledged:boolean};
type KindView={locked:{code:string;product:string;sha256:string;installed:boolean};approvedProduct:string|null;active:string|null;revisions:Rev[]};
type Overview={kinds:Record<Kind,KindView>;vocabulary:Record<Kind,string[]>};
const LABEL:Record<Kind,string>={SINGLETON:"ครรภ์เดี่ยว (Singleton) · FM-WI-T-BM-17-07",TWIN:"ครรภ์แฝด (Twin) · FM-WI-T-BM-17-08"};
const STATE:Record<string,string>={Uploaded:"รอทดสอบ",Validated:"ทดสอบผ่าน รออนุมัติ",Approved:"อนุมัติแล้ว รอเปิดใช้",Active:"ใช้งานอยู่",Archived:"รุ่นก่อน (กู้คืนได้)",Rejected:"ปฏิเสธ"};
const MESSAGE:Record<string,string>={TEMPLATE_UNKNOWN_PLACEHOLDER:"มีชื่อ ${…} ที่ระบบไม่รู้จัก",TEMPLATE_AMBIGUOUS_PLACEHOLDER_SYNTAX:"รูปแบบ ${ชื่อ} ไม่ถูกต้อง (เว้นวรรค ไม่ปิดปีกกา หรือชื่อมีอักขระพิเศษ)",TEMPLATE_PLACEHOLDER_MISSING:"ขาดช่อง ${…} ที่จำเป็น",
 TEMPLATE_DOCUMENT_CODE_MISSING:"ไม่พบรหัสเอกสารควบคุมในหัว/ท้ายกระดาษ",TEMPLATE_DOCUMENT_CODE_MISMATCH:"รหัสเอกสารไม่ตรงกับแบบฟอร์มที่เลือก",TEMPLATE_STRUCTURE_INCOMPATIBLE:"โครงสร้างช่องลงนาม/QC ใช้ไม่ได้",
 TEMPLATE_HAS_MACROS_OR_EMBEDDED_CODE:"มี Macro หรือวัตถุฝังโค้ด",TEMPLATE_HAS_EXTERNAL_LINKS:"อ้างไฟล์ภายนอก",TEMPLATE_NOT_DOCX:"ไม่ใช่ไฟล์ .docx",TEMPLATE_TOO_LARGE:"ไฟล์ใหญ่เกิน 5 MB"};
const when=(v:string)=>new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"});

async function call<T>(init?:{json?:unknown;form?:FormData}):Promise<T>{
 const r=await fetch("/api/settings/report-templates",init?.form?{method:"POST",cache:"no-store",headers:{"x-csrf-token":csrf()},body:init.form}:init?.json?{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify(init.json)}:{cache:"no-store"});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error??"ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง"),{code:d.code,details:d.details});return d as T;
}
function Findings({i}:{i:Insp}){
 return <div className="tpl-findings" aria-live="polite">
  {i.errors.length===0?<p className="tpl-ok"><LabIcon name="check" size={16}/>ตรวจโครงสร้างผ่าน — พบ {i.found.length} ช่อง ${"{…}"}{i.product?` · ผลิตภัณฑ์ที่ระบุ ${i.product}`:""}{i.code?` · รหัสเอกสาร ${i.code}`:""}</p>
   :<ul className="tpl-errors">{i.errors.map(e=><li key={e.code}><LabIcon name="x" size={16}/><span>{MESSAGE[e.code]??e.code}</span></li>)}</ul>}
  {i.unknown.length>0&&<p className="tpl-detail">ไม่รู้จัก: {i.unknown.map(u=><code key={u.token}>{"${"+u.token+"}"}{u.suggestion?` → ควรเป็น ${"${"+u.suggestion+"}"}`:""}</code>)}</p>}
  {i.missing.length>0&&<p className="tpl-detail">ขาด: {i.missing.map(m=><code key={m}>{"${"+m+"}"}</code>)}</p>}
  {i.ambiguous.length>0&&<p className="tpl-detail">รูปแบบน่าสงสัย: {i.ambiguous.map(a=><code key={a}>{a}</code>)}</p>}
 </div>;
}
export function ReportTemplatesPanel({canManage,canApprove,userId}:{canManage:boolean;canApprove:boolean;userId:string}){
 const [o,setO]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(""),[reason,setReason]=useState<Record<Kind,string>>({SINGLETON:"",TWIN:""});
 const [folder,setFolder]=useState(""),[listing,setListing]=useState<{folder:string;files:{name:string;size:number}[]}|null>(null),[ack,setAck]=useState<Record<string,boolean>>({});
 const fileRef=useRef<Record<Kind,HTMLInputElement|null>>({SINGLETON:null,TWIN:null});
 const load=useCallback(async()=>{try{setO(await call<Overview>());setError("");}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{let live=true;call<Overview>().then(d=>{if(live)setO(d);},e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[]);
 async function act(key:string,fn:()=>Promise<string>){setBusy(key);setError("");setNotice("");try{setNotice(await fn());await load();}catch(e){const err=e as Error&{code?:string};setError(err.message);}finally{setBusy("");}}
 const upload=(kind:Kind)=>act("up"+kind,async()=>{const f=fileRef.current[kind]?.files?.[0];if(!f)throw Error("เลือกไฟล์ .docx ก่อน");const form=new FormData();form.set("kind",kind);form.set("reason",reason[kind].trim()||"นำเข้าแม่แบบรายงาน");form.set("file",f);
  const r=await call<{version:number;inspection:Insp}>({form});if(fileRef.current[kind])fileRef.current[kind]!.value="";return r.inspection.errors.length?`นำเข้ารุ่น ${r.version} แล้ว แต่ตรวจพบข้อผิดพลาด — แก้ไฟล์แล้วนำเข้าใหม่`:`นำเข้ารุ่น ${r.version} แล้ว ตรวจโครงสร้างผ่าน — ทดสอบสร้างตัวอย่างต่อได้`;});
 const post=(key:string,json:Record<string,unknown>,done:string)=>act(key,async()=>{const r=await call<{passed?:boolean;problems?:string[]}>({json});if(r.passed===false)throw Error(`ตัวอย่างอ่านกลับไม่ตรง: ${(r.problems??[]).join(", ")}`);return done;});
 async function list(){setBusy("list");setError("");try{const r=await fetch("/api/settings/report-templates?folder="+encodeURIComponent(folder),{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error??"อ่านโฟลเดอร์ไม่ได้");setListing(d);}catch(e){setError((e as Error).message);}finally{setBusy("");}}
 if(!o)return error?<p className="notice" role="alert">{error}</p>:<p role="status">กำลังโหลด…</p>;
 return <section className="tpl" aria-labelledby="tpl-title">
  <header><h2 id="tpl-title">แม่แบบรายงานผล (ReadyGen)</h2><p className="help">นำไฟล์ Word เข้าระบบ → ระบบตรวจช่อง ${"{ชื่อ}"} → ทดสอบสร้างตัวอย่างด้วย Word และอ่านกลับเหมือนรายงานจริง → ผู้อนุมัติอีกคนอนุมัติ → เปิดใช้ได้ทันที ไม่ต้องติดตั้งใหม่ รายงานที่ออกไปแล้วยังผูกกับแม่แบบเดิม ส่วนชุดกฎการแปลผลทางคลินิกไม่เปลี่ยนจากหน้านี้</p></header>
  <div aria-live="polite">{error&&<p className="notice" role="alert">{error}</p>}{notice&&<p className="notice success" role="status">{notice}</p>}</div>
  {canManage&&<div className="tpl-folder"><div className="field"><label htmlFor="tpl-folder">โฟลเดอร์แม่แบบบนเซิร์ฟเวอร์ (เช่น D:\Templates หรือ \\server\share) — อ่านอย่างเดียว</label><input id="tpl-folder" value={folder} onChange={e=>setFolder(e.target.value)} spellCheck={false} placeholder="เส้นทางเต็มของโฟลเดอร์ที่มีไฟล์ .docx"/></div>
   <button type="button" className="button secondary" disabled={!folder.trim()||busy==="list"} onClick={()=>void list()}><LabIcon name="refresh"/>แสดงไฟล์ในโฟลเดอร์</button></div>}
  {(Object.keys(LABEL) as Kind[]).map(kind=>{const v=o.kinds[kind];
   return <article key={kind} className="tpl-kind" aria-labelledby={`tpl-${kind}`}>
    <h3 id={`tpl-${kind}`}>{LABEL[kind]}</h3>
    <p className="tpl-using"><LabIcon name="file" size={16}/>ใช้อยู่: {v.active?`รุ่น ${v.revisions.find(r=>r.id===v.active)?.version} (ที่อนุมัติ)`:`แม่แบบมาตรฐานของ Owner (ติดตั้งกับระบบ${v.locked.installed?"":" — ยังไม่ได้ติดตั้ง"}) · ${v.locked.code} · SHA-256 ${v.locked.sha256.slice(0,12)}…`}{v.approvedProduct?` · ผลิตภัณฑ์ที่อนุมัติ ${v.approvedProduct}`:""}</p>
    {canManage&&<div className="tpl-upload"><div className="field"><label htmlFor={`file-${kind}`}>ไฟล์แม่แบบ (.docx)</label><input id={`file-${kind}`} type="file" accept=".docx" ref={el=>{fileRef.current[kind]=el;}}/></div>
     <div className="field"><label htmlFor={`why-${kind}`}>เหตุผล</label><input id={`why-${kind}`} value={reason[kind]} maxLength={200} onChange={e=>setReason(x=>({...x,[kind]:e.target.value}))} placeholder="เช่น ปรับ Layout ตามแบบฟอร์มฉบับล่าสุด"/></div>
     <button type="button" className="button" disabled={!!busy} onClick={()=>void upload(kind)}><LabIcon name="upload"/>นำเข้าและตรวจ</button>
     {listing&&listing.files.length>0&&<div className="tpl-folder-files"><span className="help">ไฟล์ในโฟลเดอร์:</span>{listing.files.map(f=><button type="button" key={f.name} className="button secondary" disabled={!!busy} onClick={()=>void post("imp"+kind+f.name,{operation:"import",kind,folder:listing.folder,name:f.name,reason:reason[kind].trim()||"นำเข้าจากโฟลเดอร์แม่แบบ"},`นำเข้า ${f.name} แล้ว`)}>{f.name}</button>)}</div>}</div>}
    <ul className="tpl-revs">{v.revisions.length===0&&<li className="help">ยังไม่มีรุ่นที่นำเข้า — ระบบใช้แม่แบบมาตรฐานของ Owner</li>}
     {v.revisions.map(r=>{const mine=r.createdBy===userId;return <li key={r.id} className={`tpl-rev ${r.state.toLowerCase()}`}>
      <div className="tpl-rev-head"><strong>รุ่น {r.version}</strong><span className={`badge tpl-${r.state.toLowerCase()}`}>{STATE[r.state]??r.state}</span><span className="help">{r.name} · {Math.round(r.size/1024)} KB · {when(r.createdAt)} · {r.source==="FOLDER"?"จากโฟลเดอร์":"อัปโหลด"} · {r.reason}</span></div>
      <Findings i={r.inspection}/>
      <div className="tpl-actions">
       {r.hasPreview&&<a className="button secondary" href={`/api/settings/report-templates?preview=${r.id}`} target="_blank" rel="noreferrer"><LabIcon name="eye"/>ดูตัวอย่าง PDF (ลายน้ำ)</a>}
       {canManage&&r.state==="Uploaded"&&r.inspection.errors.length===0&&<button type="button" className="button" disabled={!!busy} onClick={()=>void post("t"+r.id,{operation:"test",id:r.id},`ทดสอบรุ่น ${r.version} ผ่าน`)}><LabIcon name="refresh"/>ทดสอบสร้างตัวอย่าง</button>}
       {canApprove&&r.state==="Validated"&&!mine&&<>{r.product&&r.product!==v.approvedProduct&&<label className="check-label"><input type="checkbox" checked={!!ack[r.id]} onChange={e=>setAck(x=>({...x,[r.id]:e.target.checked}))}/> รับทราบ: ไฟล์ระบุผลิตภัณฑ์ {r.product} แต่ผลิตภัณฑ์ที่อนุมัติใช้กับรายงานคือ {v.approvedProduct??"ยังไม่กำหนด"}</label>}
        <button type="button" className="button" disabled={!!busy} onClick={()=>void post("a"+r.id,{operation:"approve",id:r.id,acknowledgeProductDifference:!!ack[r.id]},`อนุมัติรุ่น ${r.version} แล้ว`)}><LabIcon name="check"/>อนุมัติ (ผู้ตรวจอีกคน)</button></>}
       {r.state==="Validated"&&mine&&<span className="help">รออนุมัติจากผู้อนุมัติอีกคน (ผู้นำเข้าอนุมัติเองไม่ได้)</span>}
       {canManage&&(r.state==="Approved"||r.state==="Archived")&&<button type="button" className="button" disabled={!!busy} onClick={()=>void post("act"+r.id,{operation:"activate",id:r.id},`เปิดใช้รุ่น ${r.version} แล้ว — รายงานฉบับถัดไปใช้แม่แบบนี้`)}><LabIcon name="save"/>{r.state==="Archived"?"กู้คืนรุ่นนี้":"เปิดใช้"}</button>}
       {(canManage||canApprove)&&["Uploaded","Validated","Approved"].includes(r.state)&&<button type="button" className="button secondary" disabled={!!busy} onClick={()=>void post("r"+r.id,{operation:"reject",id:r.id,reason:"ไม่ผ่านการทบทวน"},`ปฏิเสธรุ่น ${r.version} แล้ว`)}><LabIcon name="x"/>ปฏิเสธ</button>}
      </div></li>;})}</ul>
   </article>;})}
  <details className="tpl-vocab"><summary>ช่อง ${"{ชื่อ}"} ที่ระบบรองรับ</summary><p className="help">ชื่อเหล่านี้ถูกกำหนดโดยระบบและผูกกับแหล่งข้อมูลที่ผ่านการอนุมัติ — เพิ่มชื่อใหม่ต้องพัฒนาเพิ่ม ส่วนหน้าตา/ตำแหน่ง/ฟอนต์เปลี่ยนได้โดยใช้ชื่อเดิม</p>
   {(["SINGLETON","TWIN"] as Kind[]).map(k=><p key={k}><strong>{k}</strong>: {o.vocabulary[k].map(t=><code key={t}>{"${"+t+"}"}</code>)}</p>)}</details>
 </section>;
}
