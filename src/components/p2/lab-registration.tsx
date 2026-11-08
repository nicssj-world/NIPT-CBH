'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {api,Dialog,ErrorNotice,Field,Ln,message,time,type Unit} from './shared';
import type {RegistrationPet} from '../../../packages/p2/pet-registration';

type Done={caseId:string;ln:string;hn:string;name:string};
/** Lab registration is always on paper (request form and consent, Owner 2026-11-09), so there is no consent choice. The dialog stays open after each case so the next LN can be entered straight away. */
export function LabRegistration({units,onClose,onRegistered}:{units:Unit[];onClose:()=>void;onRegistered?:()=>void}){
 const key=useRef(crypto.randomUUID()),lnInput=useRef<HTMLInputElement>(null),submit=useRef<HTMLButtonElement>(null);
 const [done,setDone]=useState<Done[]>([]);
 const [mode,setMode]=useState<'CHOOSE'|'OPERATIONAL'>('CHOOSE'),[ln,setLn]=useState(''),[hn,setHn]=useState(''),[rows,setRows]=useState<RegistrationPet[]|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pet=rows?.find(p=>p.fileId===selected);
 const petId=pet?.fileId;
 useEffect(()=>{if(petId)submit.current?.focus();},[petId]);
 useEffect(()=>{if(done.length>0)lnInput.current?.focus();},[done.length]);
 const identifiers={...(ln.trim()?{ln:ln.trim().replaceAll('-','')}:{}),...(hn.trim()?{hn:hn.trim()}:{})};
 function changed(){setRows(null);setSelected('');setError('');key.current=crypto.randomUUID();}
 async function lookup(){
  if(!ln.trim()&&!hn.trim()){setError('กรอก LN หรือ HN อย่างใดอย่างหนึ่งก่อนค้นหา');return;}
  setBusy(true);setError('');setRows(null);setSelected('');
  try{const result=await api<{candidates:RegistrationPet[]}>('/api/p2/pet-registration',{action:'lookup',...identifiers});setRows(result.candidates);if(result.candidates.length===1)setSelected(result.candidates[0].fileId);}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function register(){
  if(!pet)return;setBusy(true);setError('');
  try{const result=await api<{caseId:string}>('/api/p2/pet-registration',{action:'register',...identifiers,fileId:pet.fileId,...(units[0]?{unitId:units[0].id}:{}),consentMode:'Paper',idempotencyKey:key.current});
   setDone(list=>[{caseId:result.caseId,ln:pet.ln,hn:pet.hn,name:pet.name},...list]);setLn('');setHn('');changed();onRegistered?.();}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <Dialog title="ลงทะเบียนโดย Lab" onClose={onClose} dirty={!!ln||!!hn}>
  {mode==='CHOOSE'?<div className="stack"><p>เลือกตามงานที่เกิดขึ้นจริง ข้อมูลผู้ป่วยใช้ทะเบียนกลางร่วมกัน</p><Link className="button secondary" href="/historical">ตรวจ Manual เสร็จแล้ว มี PDF</Link><button className="button" type="button" onClick={()=>setMode('OPERATIONAL')}>ลงทะเบียนตัวอย่างเพื่อตรวจตามระบบ</button></div>:<div className="stack">
   <p>กรอก LN หรือ HN อย่างใดอย่างหนึ่ง ระบบใช้ข้อมูล PET ที่พร้อมและตรวจสอบได้จาก HIS</p>
   <form className="stack" onSubmit={e=>{e.preventDefault();void lookup();}}><div className="form-grid">
    <Field label="LN HIS" help="กรอก LN หรือ HN อย่างใดอย่างหนึ่ง">{id=><input id={id} ref={lnInput} autoFocus autoComplete="off" inputMode="numeric" value={ln} disabled={busy} onChange={e=>{setLn(e.target.value);changed();}}/>}</Field>
    <Field label="HN">{id=><input id={id} autoComplete="off" value={hn} disabled={busy} onChange={e=>{setHn(e.target.value);changed();}}/>}</Field>
   </div><button className="button secondary" disabled={busy||(!ln.trim()&&!hn.trim())}>{busy?'กำลังตรวจข้อมูล…':'ค้นหาข้อมูลจาก HIS'}</button></form>
   <div aria-live="polite">{rows?.length===0&&<p className="notice" role="status">ยังไม่พบ PET ที่พร้อมสำหรับตัวระบุนี้ กรุณาตรวจ LN/HN และสถานะ PET / .ok จาก HIS ก่อนลองใหม่ ระบบยังไม่สร้างเคสหรือออก LN Halos</p>}
    {rows&&rows.length>1&&<fieldset className="stack"><legend>พบหลาย LN — เลือกรายการตรวจที่ถูกต้อง</legend>{rows.map(p=><label className="check-label" key={p.fileId}><input type="radio" name="pet-order" value={p.fileId} checked={selected===p.fileId} disabled={busy} onChange={()=>{setSelected(p.fileId);key.current=crypto.randomUUID();}}/>LN {p.ln} · HN {p.hn} · รับจาก HIS {time(p.receivedAt)}</label>)}</fieldset>}
   </div>
   {pet&&<section aria-label="ข้อมูลยืนยันจาก HIS PET"><h3>ข้อมูลยืนยันจาก HIS PET</h3><dl className="compact-facts">
    {([['LN HIS',pet.ln],['HN',pet.hn],['ชื่อผู้รับบริการ',pet.name],['วันเกิด',pet.dob],['เพศ',pet.sex],['วัน/เวลาเก็บตัวอย่าง',time(pet.specimenAt)],['วัน/เวลารับตัวอย่างใน HIS',time(pet.receivedAt)],['หน่วยงานส่งตรวจ (HIS Ward)',pet.ward||'รอข้อมูลจาก HIS']] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
   </dl><p className="help">GA, EDD/EDC และประเภทครรภ์กรอกภายหลังในรายละเอียดตัวอย่างได้ LN Halos เกิดจากหลักฐานรับตัวอย่างที่ถูกต้องเท่านั้น หากมีเลขแล้วระบบใช้เลขเดิม</p></section>}
   {pet&&<form className="stack" onSubmit={e=>{e.preventDefault();void register();}}><p className="notice" role="status">ใบขอส่งตรวจและใบ Consent เป็นกระดาษ (ช่องทาง Lab) ระบบบันทึกเป็น Paper Consent ให้อัตโนมัติ</p><p className="help">Paper Consent เป็นเครื่องหมายว่าใช้ต้นฉบับกระดาษที่มากับตัวอย่าง ไม่ต้องสแกน อัปโหลด พิมพ์ หรือลงนามซ้ำ และไม่ใช่การรับรองทางคลินิก เคสเดิมคงเอกสารและ Consent ที่บันทึกไว้</p><button className="button" ref={submit} disabled={busy}>{busy?'กำลังลงทะเบียน…':'ลงทะเบียนตัวอย่าง'}</button></form>}
   <ErrorNotice error={error}/>
   {done.length>0&&<section aria-label="ลงทะเบียนแล้วในรอบนี้" aria-live="polite"><h3>ลงทะเบียนแล้วในรอบนี้ ({done.length} ราย)</h3><ul className="registered-list">{done.map(d=><li key={d.caseId}><Link href={'/cases/'+d.caseId} target="_blank" rel="noopener" aria-label={'เปิดเคส LN '+d.ln+' ในแท็บใหม่'}><Ln value={d.ln}/></Link> · HN {d.hn||'—'}{d.name?' · '+d.name:''} · ลงทะเบียนแล้ว</li>)}</ul></section>}
   <button className="button secondary" type="button" disabled={busy} onClick={()=>setMode('CHOOSE')}>กลับไปเลือกประเภทงาน</button>
  </div>}
 </Dialog>;
}
