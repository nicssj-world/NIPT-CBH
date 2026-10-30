'use client';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,Dialog,ErrorNotice,Field,message,time,type Unit} from './shared';
import type {RegistrationPet} from '../../../packages/p2/pet-registration';

export function LabRegistration({units,onClose}:{units:Unit[];onClose:()=>void}){
 const router=useRouter(),key=useRef(crypto.randomUUID());
 const [mode,setMode]=useState<'CHOOSE'|'OPERATIONAL'|'EQA'>('CHOOSE'),[ln,setLn]=useState(''),[hn,setHn]=useState(''),[rows,setRows]=useState<RegistrationPet[]|null>(null),[selected,setSelected]=useState(''),[consent,setConsent]=useState<''|'Paper'|'Electronic'>(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [eqaOrganizer,setEqaOrganizer]=useState(''),[eqaSample,setEqaSample]=useState(''),[eqaName,setEqaName]=useState(''),[eqaYear,setEqaYear]=useState(''),[eqaEvidence,setEqaEvidence]=useState(''),[eqaCollection,setEqaCollection]=useState(''),[eqaDob,setEqaDob]=useState(''),[eqaSex,setEqaSex]=useState<'F'|'M'|'U'|''>(''),[eqaCollectionAt,setEqaCollectionAt]=useState(''),[eqaEdd,setEqaEdd]=useState(''),[eqaPregnancy,setEqaPregnancy]=useState<'Singleton'|'Twins'|''>(''),[eqaSource,setEqaSource]=useState<'TUBE_LABEL'|'REQUEST_FORM'|''>(''),[eqaUnit,setEqaUnit]=useState('');
 async function registerEqa(){
  setBusy(true);setError('');
  try{
   const data={ln:ln.replaceAll('-',''),hn:hn.trim(),unitId:eqaUnit||units[0]?.id,identifierSource:eqaSource,idempotencyKey:key.current,collectionDate:eqaCollection,eqa:{organizer:eqaOrganizer,organizerSampleId:eqaSample,patientName:eqaName,programYear:Number(eqaYear),evidenceReference:eqaEvidence,...(eqaDob?{patientDob:eqaDob}:{}),...(eqaSex?{patientSex:eqaSex}:{}),...(eqaCollectionAt?{collectionAt:eqaCollectionAt+':00+07:00'}:{}),...(eqaEdd?{edd:eqaEdd}:{}),...(eqaPregnancy?{pregnancyType:eqaPregnancy}:{})}};
   const result=await api<{caseId:string}>('/api/eqa/register',data);
   router.push('/cases/'+result.caseId);router.refresh();
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 const pet=rows?.find(p=>p.fileId===selected),identifiers={...(ln.trim()?{ln:ln.trim().replaceAll('-','')}:{}),...(hn.trim()?{hn:hn.trim()}:{})};
 function changed(){setRows(null);setSelected('');setError('');key.current=crypto.randomUUID();}
 async function lookup(){
  if(!ln.trim()&&!hn.trim()){setError('กรอก LN หรือ HN อย่างใดอย่างหนึ่งก่อนค้นหา');return;}
  setBusy(true);setError('');setRows(null);setSelected('');
  try{const result=await api<{candidates:RegistrationPet[]}>('/api/p2/pet-registration',{action:'lookup',...identifiers});setRows(result.candidates);if(result.candidates.length===1)setSelected(result.candidates[0].fileId);}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function register(){
  if(!pet||!consent)return;setBusy(true);setError('');
  try{const result=await api<{caseId:string}>('/api/p2/pet-registration',{action:'register',...identifiers,fileId:pet.fileId,...(units[0]?{unitId:units[0].id}:{}),consentMode:consent,idempotencyKey:key.current});router.push('/cases/'+result.caseId);router.refresh();}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <Dialog title="ลงทะเบียนโดย Lab" onClose={onClose} dirty={!!ln||!!hn}>
  {mode==='CHOOSE'?<div className="stack"><p>เลือกตามงานที่เกิดขึ้นจริง ข้อมูลผู้ป่วยใช้ทะเบียนกลางร่วมกัน</p><Link className="button secondary" href="/historical">ตรวจ Manual เสร็จแล้ว มี PDF</Link><button className="button" type="button" onClick={()=>setMode('OPERATIONAL')}>ลงทะเบียนตัวอย่างเพื่อตรวจตามระบบ</button><button className="button secondary" type="button" onClick={()=>setMode('EQA')}>ลงทะเบียนตัวอย่าง EQA (ไม่มี PET)</button></div>:mode==='EQA'?<div className="stack">
   <p className="help">สำหรับตัวอย่างจากผู้จัด EQA เท่านั้น ข้อมูลผู้ป่วยสมมติต้องตรงกับเอกสารและฉลากของผู้จัด ระบบจะไม่สร้าง PET และไม่ส่งผลไป HIS</p>
   <form className="stack" onSubmit={e=>{e.preventDefault();void registerEqa();}}>
    <div className="form-grid">
     <Field label="LN สำหรับตัวอย่าง (10 หลัก)">{id=><input id={id} inputMode="numeric" required pattern="[0-9]{10}" value={ln} disabled={busy} onChange={e=>{setLn(e.target.value);changed();}}/>}</Field>
     <Field label="HN ตามข้อมูลผู้จัด">{id=><input id={id} required value={hn} disabled={busy} onChange={e=>{setHn(e.target.value);changed();}}/>}</Field>
     <Field label="ผู้จัด EQA">{id=><input id={id} required value={eqaOrganizer} disabled={busy} onChange={e=>setEqaOrganizer(e.target.value)}/>}</Field>
     <Field label="รหัสตัวอย่างจากผู้จัด">{id=><input id={id} required value={eqaSample} disabled={busy} onChange={e=>setEqaSample(e.target.value)}/>}</Field>
     <Field label="ชื่อผู้ป่วยสมมติจากผู้จัด">{id=><input id={id} required value={eqaName} disabled={busy} onChange={e=>setEqaName(e.target.value)}/>}</Field>
     <Field label="ปีโครงการ EQA">{id=><input id={id} required type="number" min="2000" max="2200" value={eqaYear} disabled={busy} onChange={e=>setEqaYear(e.target.value)}/>}</Field>
     <Field label="อ้างอิงเอกสารผู้จัด">{id=><input id={id} required value={eqaEvidence} disabled={busy} onChange={e=>setEqaEvidence(e.target.value)}/>}</Field>
     <Field label="วันที่เก็บตัวอย่างตามเอกสาร">{id=><input id={id} required type="date" value={eqaCollection} disabled={busy} onChange={e=>setEqaCollection(e.target.value)}/>}</Field>
     <Field label="วันเกิด (กรอกเฉพาะที่ผู้จัดให้)">{id=><input id={id} type="date" value={eqaDob} disabled={busy} onChange={e=>setEqaDob(e.target.value)}/>}</Field>
     <Field label="วันที่และเวลาเก็บตัวอย่างจากผู้จัด (จำเป็นสำหรับส่ง NIFTY)">{id=><input id={id} type="datetime-local" disabled={busy} value={eqaCollectionAt} onChange={e=>setEqaCollectionAt(e.target.value)}/>}</Field>
     <Field label="EDD จากผู้จัด (ถ้ามี)">{id=><input id={id} type="date" disabled={busy} value={eqaEdd} onChange={e=>setEqaEdd(e.target.value)}/>}</Field>
     <Field label="ชนิดครรภ์จากผู้จัด (ถ้ามี)">{id=><select id={id} disabled={busy} value={eqaPregnancy} onChange={e=>setEqaPregnancy(e.target.value as typeof eqaPregnancy)}><option value="">ไม่ได้ระบุ</option><option value="Singleton">ครรภ์เดี่ยว</option><option value="Twins">ครรภ์แฝด</option></select>}</Field>
     <Field label="เพศ (กรอกเฉพาะที่ผู้จัดให้)">{id=><select id={id} value={eqaSex} disabled={busy} onChange={e=>setEqaSex(e.target.value as typeof eqaSex)}><option value="">ไม่ได้ระบุ</option><option value="F">หญิง</option><option value="M">ชาย</option><option value="U">ไม่ระบุเพศ</option></select>}</Field>
     <Field label="แหล่งตรวจสอบตัวระบุ">{id=><select id={id} required value={eqaSource} disabled={busy} onChange={e=>setEqaSource(e.target.value as typeof eqaSource)}><option value="">เลือกหลักฐาน</option><option value="TUBE_LABEL">ฉลากหลอดจากผู้จัด</option><option value="REQUEST_FORM">ใบข้อมูลผู้จัด</option></select>}</Field>
     <Field label="หน่วยงานรับตัวอย่าง">{id=><select id={id} required value={eqaUnit} disabled={busy} onChange={e=>setEqaUnit(e.target.value)}><option value="">เลือกหน่วยงาน</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>}</Field>
    </div>
    <button type="submit" className="button" disabled={busy||!eqaSource||!eqaUnit}>{busy?'กำลังรับตัวอย่าง EQA…':'ยืนยันข้อมูลและรับตัวอย่าง EQA'}</button>
   </form>
   <ErrorNotice error={error}/><button className="button secondary" type="button" disabled={busy} onClick={()=>setMode('CHOOSE')}>กลับไปเลือกประเภทงาน</button>
  </div>:<div className="stack">
   <p>กรอก LN หรือ HN อย่างใดอย่างหนึ่ง ระบบใช้ข้อมูล PET ที่พร้อมและตรวจสอบได้จาก HIS</p>
   <form className="stack" onSubmit={e=>{e.preventDefault();void lookup();}}><div className="form-grid">
    <Field label="LN HIS" help="กรอก LN หรือ HN อย่างใดอย่างหนึ่ง">{id=><input id={id} autoFocus autoComplete="off" inputMode="numeric" value={ln} disabled={busy} onChange={e=>{setLn(e.target.value);changed();}}/>}</Field>
    <Field label="HN">{id=><input id={id} autoComplete="off" value={hn} disabled={busy} onChange={e=>{setHn(e.target.value);changed();}}/>}</Field>
   </div><button className="button secondary" disabled={busy||(!ln.trim()&&!hn.trim())}>{busy?'กำลังตรวจข้อมูล…':'ค้นหาข้อมูลจาก HIS'}</button></form>
   <div aria-live="polite">{rows?.length===0&&<p className="notice" role="status">ยังไม่พบ PET ที่พร้อมสำหรับตัวระบุนี้ กรุณาตรวจ LN/HN และสถานะ PET / .ok จาก HIS ก่อนลองใหม่ ระบบยังไม่สร้างเคสหรือออก LN Halos</p>}
    {rows&&rows.length>1&&<fieldset className="stack"><legend>พบหลาย LN — เลือกรายการตรวจที่ถูกต้อง</legend>{rows.map(p=><label className="check-label" key={p.fileId}><input type="radio" name="pet-order" value={p.fileId} checked={selected===p.fileId} disabled={busy} onChange={()=>{setSelected(p.fileId);key.current=crypto.randomUUID();}}/>LN {p.ln} · HN {p.hn} · รับจาก HIS {time(p.receivedAt)}</label>)}</fieldset>}
   </div>
   {pet&&<section aria-label="ข้อมูลยืนยันจาก HIS PET"><h3>ข้อมูลยืนยันจาก HIS PET</h3><dl className="compact-facts">
    {([['LN HIS',pet.ln],['HN',pet.hn],['ชื่อผู้รับบริการ',pet.name],['วันเกิด',pet.dob],['เพศ',pet.sex],['วัน/เวลาเก็บตัวอย่าง',time(pet.specimenAt)],['วัน/เวลารับตัวอย่างใน HIS',time(pet.receivedAt)],['หน่วยงานส่งตรวจ (HIS Ward)',pet.ward||'รอข้อมูลจาก HIS']] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
   </dl><p className="help">GA, EDD/EDC และประเภทครรภ์กรอกภายหลังในรายละเอียดตัวอย่างได้ LN Halos เกิดจากหลักฐานรับตัวอย่างที่ถูกต้องเท่านั้น หากมีเลขแล้วระบบใช้เลขเดิม</p></section>}
   {pet&&<form className="stack" onSubmit={e=>{e.preventDefault();void register();}}><fieldset className="stack"><legend>ช่องทาง Consent</legend>
    <label className="check-label"><input type="radio" name="registration-consent" required checked={consent==='Paper'} disabled={busy} onChange={()=>{setConsent('Paper');key.current=crypto.randomUUID();}}/>Paper Consent</label>
    <label className="check-label"><input type="radio" name="registration-consent" required checked={consent==='Electronic'} disabled={busy} onChange={()=>{setConsent('Electronic');key.current=crypto.randomUUID();}}/>Electronic Consent</label>
   </fieldset><p className="help">Paper Consent เป็นเครื่องหมายว่าใช้ต้นฉบับกระดาษที่มากับตัวอย่าง ไม่ต้องสแกน อัปโหลด พิมพ์ หรือลงนามซ้ำ และไม่ใช่การรับรองทางคลินิก เคสเดิมคงเอกสารและ Consent ที่บันทึกไว้</p><button className="button" disabled={busy||!consent}>{busy?'กำลังลงทะเบียน…':'ลงทะเบียนตัวอย่าง'}</button></form>}
   <ErrorNotice error={error}/><button className="button secondary" type="button" disabled={busy} onClick={()=>setMode('CHOOSE')}>กลับไปเลือกประเภทงาน</button>
  </div>}
 </Dialog>;
}
