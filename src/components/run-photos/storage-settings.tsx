"use client";
import {useId,useState} from "react";
import {useRouter} from "next/navigation";
import type {StorageTest} from "../../../packages/run-photos/store";
import {labApi,failureText,bkk,LabFailure} from "../p4/lab-api";
import {formatBytes} from "./photo-client";

const CHECK:Record<string,string>={EXISTS:"พบโฟลเดอร์",DIRECTORY:"เป็นโฟลเดอร์",WRITE:"เขียนไฟล์ทดสอบ 64 KB",READ_BACK:"อ่านกลับตรงทุกไบต์",DELETE:"ลบไฟล์ทดสอบ"};
const CODE:Record<string,string>={FILE_MISSING:"ไม่พบโฟลเดอร์ หรือ Share ไม่ได้เชื่อมต่อ",ENOENT:"ไม่พบโฟลเดอร์ หรือ Share ไม่ได้เชื่อมต่อ",STORAGE_ACCESS_DENIED:"บัญชีบริการไม่มีสิทธิ์",EACCES:"บัญชีบริการไม่มีสิทธิ์",EPERM:"บัญชีบริการไม่มีสิทธิ์",STORAGE_UNAVAILABLE:"เครือข่ายหรือ Share ไม่ตอบสนอง",STORAGE_TIMEOUT:"Share ตอบช้าเกินกำหนด",ROOT_NOT_DIRECTORY:"Path นี้เป็นไฟล์ ไม่ใช่โฟลเดอร์",READ_BACK_MISMATCH:"อ่านกลับไม่ตรงกับที่เขียน",STORAGE_FULL:"พื้นที่เต็ม",SKIPPED:"ไม่ได้ตรวจ (ขั้นก่อนหน้าไม่ผ่าน)"};
export type StorageOverview={canConfigure:boolean;defaultInUse:boolean;roots:{id:string;state:string;source:string;path:string|null;createdAt:string;retiredAt:string|null;createdBy:string|null;photos:number;bytes:number;lastTest:{ok:boolean;testedAt:string;account:string|null;freeBytes:number|null}}[]};

function Receipt({r,path}:{r:StorageTest;path:string}){
 return <div className={`notice ${r.ok?"success":""}`} role="status">
  <strong>{r.ok?"ทดสอบผ่าน — ใช้ Path นี้ได้":"ทดสอบไม่ผ่าน — ยังใช้ Path นี้ไม่ได้"}</strong>
  <p className="small storage-path">{path}</p>
  <ul className="storage-checks">{r.checks.map(c=><li key={c.name}><span className={`status ${c.ok?"good":c.code==="SKIPPED"?"":"bad"}`}>{c.ok?"ผ่าน":"ไม่ผ่าน"}</span> {CHECK[c.name]??c.name}{!c.ok&&c.code?` — ${CODE[c.code]??c.code}`:""}</li>)}</ul>
  <p className="small">ตรวจโดยบัญชี <span className="storage-path">{r.account}</span> บนเครื่อง {r.host} (บัญชีเดียวกับที่ระบบใช้บันทึกภาพ) · {r.elapsedMs} ms{r.freeBytes!==null?` · พื้นที่ว่าง ${formatBytes(r.freeBytes)}`:""}</p>
 </div>;
}
export function StorageSettings({initial}:{initial:StorageOverview}){
 const id=useId(),router=useRouter();
 const active=initial.roots.find(r=>r.state==="Active");
 const [path,setPath]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState<"test"|"save"|null>(null),[tested,setTested]=useState<{path:string;receipt:StorageTest}|null>(null),[error,setError]=useState(""),[saved,setSaved]=useState("");
 const testedOk=!!tested?.receipt.ok&&tested.path.toLowerCase()===path.trim().replace(/[\\/]+$/,"").toLowerCase();
 const test=async()=>{setBusy("test");setError("");setSaved("");try{setTested(await labApi<{path:string;receipt:StorageTest}>("/api/settings/run-photo-storage",{action:"test",path}));}catch(e){setTested(null);setError(failureText(e));}finally{setBusy(null);}};
 const save=async()=>{setBusy("save");setError("");try{await labApi("/api/settings/run-photo-storage",{action:"activate",path,reason});setSaved("บันทึกแล้ว — ภาพใหม่จะเก็บที่ Path นี้ ภาพเดิมยังเปิดและค้นหาได้จากที่เก็บเดิม");setPath("");setReason("");setTested(null);router.refresh();}
  catch(e){setError(failureText(e));if(e instanceof LabFailure&&e.details)setTested(null);}finally{setBusy(null);}};
 return <>
  <section className="panel" aria-labelledby={id+"-a"}>
   <h2 id={id+"-a"}>ที่เก็บภาพที่ใช้งานอยู่</h2>
   {active?<dl className="compact-facts">
    <div><dt>Storage Path</dt><dd>{active.path?<span className="storage-path">{active.path}</span>:"แสดงเฉพาะผู้ดูแลระบบ"}{active.source==="INSTALLATION_DEFAULT"&&<span className="badge warning">ค่าเริ่มต้นของการติดตั้ง</span>}</dd></div>
    <div><dt>ผลทดสอบล่าสุด</dt><dd><span className={`status ${active.lastTest.ok?"good":"bad"}`}>{active.lastTest.ok?"ผ่าน":"ไม่ผ่าน"}</span> · {bkk(active.lastTest.testedAt)}{active.lastTest.account?` · บัญชี ${active.lastTest.account}`:""}{active.lastTest.freeBytes!==null?` · ว่าง ${formatBytes(active.lastTest.freeBytes)}`:""}</dd></div>
    <div><dt>ภาพในที่เก็บนี้</dt><dd>{active.photos} ภาพ · {formatBytes(active.bytes)}</dd></div>
    <div><dt>ใช้ตั้งแต่</dt><dd>{bkk(active.createdAt)}{active.createdBy?` · ${active.createdBy}`:""}</dd></div>
   </dl>:<p>ยังไม่ได้เลือกที่เก็บ — ภาพแรกจะเก็บในโฟลเดอร์เริ่มต้นของการติดตั้ง (ภายใน File Store) จนกว่าผู้ดูแลระบบจะตั้ง Path</p>}
   <p className="help">ผลทดสอบเป็นของเวลาที่บันทึก Path — หากที่เก็บไม่พร้อมภายหลัง ระบบแจ้งเฉพาะตอนอัปโหลดหรือเปิดภาพ งาน Run, Task List, QC, Pooling, ผลตรวจ และ HIS ทำต่อได้ตามปกติ</p>
  </section>
  {initial.canConfigure?<section className="panel" aria-labelledby={id+"-c"}>
   <h2 id={id+"-c"}>เปลี่ยน Storage Path</h2>
   <form className="stack" onSubmit={e=>{e.preventDefault();if(testedOk)void save();else void test();}}>
    <div><label htmlFor={id+"-path"}>Path ใหม่</label>
     <input id={id+"-path"} className="storage-path" value={path} onChange={e=>{setPath(e.target.value);setSaved("");}} maxLength={400} placeholder="D:\NIPT-CBH\RunPhotos หรือ \\LAB-SERVER\NIPT-Photos" autoComplete="off" spellCheck={false} aria-describedby={id+"-path-help"}/>
     <p id={id+"-path-help"} className="help">โฟลเดอร์บนเครื่องแม่ข่าย (เช่น D:\NIPT-CBH\RunPhotos) หรือ Network Share (UNC เช่น \\LAB-SERVER\NIPT-Photos) ที่สร้างไว้แล้ว และให้สิทธิ์อ่าน/เขียนแก่บัญชีบริการของระบบ — ไม่ใช้ Drive Letter ที่ Map เฉพาะผู้ใช้</p></div>
    <div className="row"><button type="button" className="button secondary" disabled={!path.trim()||busy!==null} onClick={()=>void test()}>{busy==="test"?"กำลังทดสอบ…":"ทดสอบการเข้าถึง"}</button></div>
    {tested&&<Receipt r={tested.receipt} path={tested.path}/>}
    {testedOk&&<>
     <div><label htmlFor={id+"-reason"}>เหตุผลที่เปลี่ยน (อย่างน้อย 8 ตัวอักษร)</label><input id={id+"-reason"} value={reason} onChange={e=>setReason(e.target.value)} maxLength={250} placeholder="เช่น ย้ายไป NAS ของห้องปฏิบัติการ"/></div>
     <p className="notice warning-notice small" role="note">ภาพใหม่จะเก็บที่ Path นี้ ภาพเดิมไม่ถูกย้ายหรือลบ และยังเปิดจากที่เก็บเดิม — ต้องคงที่เก็บเดิมไว้ให้เข้าถึงได้ และรวมไว้ในการสำรองข้อมูล ระบบทดสอบ Path อีกครั้งก่อนบันทึก</p>
     <div className="row"><button className="button" disabled={busy!==null||reason.trim().length<8}>{busy==="save"?"กำลังบันทึก…":"บันทึกและใช้ Path นี้"}</button></div>
    </>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {saved&&<p className="notice success" role="status">{saved}</p>}
   </form>
  </section>:<p className="notice warning-notice">การเปลี่ยน Storage Path ทำได้โดยผู้ดูแลระบบ (APP_ADMIN / IT_OPERATOR) เท่านั้น</p>}
  <section className="panel" aria-labelledby={id+"-h"}>
   <h2 id={id+"-h"}>ประวัติที่เก็บภาพ</h2>
   {!initial.roots.length?<div className="empty-state"><p>ยังไม่มีภาพในระบบ</p></div>:<div className="table-wrap" role="region" aria-label="ที่เก็บภาพเดิม" tabIndex={0}><table className="data-table"><caption>ที่เก็บเดิมยังใช้เปิดภาพที่บันทึกไว้ในที่เก็บนั้น</caption>
    <thead><tr><th scope="col">สถานะ</th><th scope="col">Path</th><th scope="col">ภาพ</th><th scope="col">ใช้ตั้งแต่</th><th scope="col">หยุดรับภาพใหม่</th></tr></thead>
    <tbody>{initial.roots.map(r=><tr key={r.id}><td><span className={`status ${r.state==="Active"?"good":""}`}>{r.state==="Active"?"ใช้งาน":"เก็บภาพเดิม"}</span></td><td>{r.path?<span className="storage-path">{r.path}</span>:"—"}{r.source==="INSTALLATION_DEFAULT"&&<span className="badge neutral">ค่าเริ่มต้น</span>}</td><td>{r.photos} · {formatBytes(r.bytes)}</td><td>{bkk(r.createdAt)}</td><td>{r.retiredAt?bkk(r.retiredAt):"—"}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="panel" aria-labelledby={id+"-b"}>
   <h2 id={id+"-b"}>สำรองและกู้คืน</h2>
   <p>ฐานข้อมูล (ข้อมูลภาพ ช่วงตัวอย่าง ผู้อัปโหลด SHA-256 และประวัติ) สำรองด้วย Backup/Restore เดิมของระบบ ไฟล์ภาพสำรองแยกด้วยคำสั่งบนเครื่องแม่ข่าย โดยบัญชีบริการเดียวกับที่ระบบใช้เก็บภาพ:</p>
   <ul>
    <li><span className="storage-path">npm run photos -- verify</span> — ตรวจว่าทุกไฟล์ที่ฐานข้อมูลอ้างถึงมีอยู่และ SHA-256 ตรง และแจ้งไฟล์ที่ไม่มีใครอ้างถึง</li>
    <li><span className="storage-path">npm run photos -- backup &lt;โฟลเดอร์ว่าง&gt;</span> — คัดลอกไฟล์ทุกที่เก็บพร้อม Manifest และตรวจทุกไบต์</li>
    <li><span className="storage-path">npm run photos -- restore &lt;backup&gt; &lt;rootId&gt; &lt;path&gt;</span> แล้ว <span className="storage-path">relocate</span> — กู้ไฟล์ไปเครื่องใหม่และบันทึกตำแหน่งใหม่ (หลังกู้ฐานข้อมูล)</li>
   </ul>
  </section>
 </>;
}
