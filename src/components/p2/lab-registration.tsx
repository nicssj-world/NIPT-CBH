'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,Dialog,ErrorNotice,Field,message,type Unit,type Doctor} from './shared';

export function LabRegistration({units,onClose}:{units:Unit[];onClose:()=>void}){
 const router=useRouter(),key=useRef(crypto.randomUUID()),hnRef=useRef<HTMLInputElement>(null);
 const [mode,setMode]=useState<'CHOOSE'|'OPERATIONAL'>('CHOOSE'),[ln,setLn]=useState(''),[hn,setHn]=useState(''),[unit,setUnit]=useState(units[0]?.id??''),[weeks,setWeeks]=useState(''),[days,setDays]=useState(''),[edc,setEdc]=useState(''),[pregnancy,setPregnancy]=useState('Singleton'),[request,setRequest]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[linked,setLinked]=useState<string|null>(null);
 const [doctors,setDoctors]=useState<Doctor[]>([]),[doctor,setDoctor]=useState('');
 useEffect(()=>{let active=true;api<{doctors:Doctor[]}>('/api/p2/doctors').then(result=>{if(active)setDoctors(result.doctors.filter(d=>d.active));}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
 async function submit(){
  setError('');const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(edc);
  if(!match){setError('กรอก EDC เป็น MM/DD/YYYY เช่น 03/24/2027');return;}
  const iso=`${match[3]}-${match[1]}-${match[2]}`;setBusy(true);
  try{
   const result=await api<{caseId:string|null;intake?:{outcome:string;fields:string[]}}>('/api/p2/register',{ln:ln.replaceAll('-',''),hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:key.current,labOperational:{gaWeeks:Number(weeks),gaDays:Number(days),edd:iso,pregnancy,paperRequest:request,paperConsent:consent,doctorVersionId:doctor||null}});
   if(!result.caseId){setError('LN/HN ขัดแย้งกับทะเบียน กรุณาตรวจหลอดและใบขอส่งตรวจก่อน');return;}
   if(result.intake&&!['NO_INTAKE','APPLIED_S1'].includes(result.intake.outcome)){setLinked(result.caseId);setError(`ลงทะเบียนแล้ว แต่ข้อมูล HIS ต้องตรวจสอบ (${result.intake.fields.join(', ')||result.intake.outcome}) จึงยังไม่รับสิ่งส่งตรวจ`);return;}
   router.push('/lab');router.refresh();
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <Dialog title="ลงทะเบียนโดย Lab" onClose={onClose} dirty={!!ln||!!hn}>
  {mode==='CHOOSE'?<div className="stack"><p>เลือกตามงานที่เกิดขึ้นจริง ข้อมูลผู้ป่วยใช้ทะเบียนกลางร่วมกัน</p><Link className="button secondary" href="/historical">ตรวจ Manual เสร็จแล้ว มี PDF</Link><button className="button" type="button" onClick={()=>setMode('OPERATIONAL')}>Lab ได้รับตัวอย่าง + ใบขอส่งตรวจ + Paper Consent แล้ว และจะตรวจตามระบบ</button></div>:<form className="stack" onSubmit={e=>{e.preventDefault();void submit();}}>
   <p>กรอก LN/HN จากหลอดและใบขอส่งตรวจ ระบบรับตัวอย่างและออก LN Halos อัตโนมัติเมื่อ PET ของ HIS ตรงกัน</p>
   <div className="form-grid">
    <Field label="LN HIS" required>{id=><input id={id} autoFocus autoComplete="off" inputMode="numeric" required value={ln} onChange={e=>setLn(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();hnRef.current?.focus();}}}/>}</Field>
    <Field label="HN" required>{id=><input id={id} ref={hnRef} autoComplete="off" required value={hn} onChange={e=>setHn(e.target.value)}/>}</Field>
    <Field label="GA สัปดาห์" required>{id=><input id={id} type="number" min="0" max="45" required value={weeks} onChange={e=>setWeeks(e.target.value)}/>}</Field>
    <Field label="GA วัน" required>{id=><input id={id} type="number" min="0" max="6" required value={days} onChange={e=>setDays(e.target.value)}/>}</Field>
    <Field label="EDC (MM/DD/YYYY)" required help="เดือน/วัน/ปี ค.ศ.">{id=><input id={id} inputMode="numeric" placeholder="MM/DD/YYYY" required value={edc} onChange={e=>setEdc(e.target.value)}/>}</Field>
    <Field label="ประเภทครรภ์" required>{id=><select id={id} value={pregnancy} onChange={e=>setPregnancy(e.target.value)}><option value="Singleton">ครรภ์เดี่ยว (Singleton)</option><option value="Twins">ครรภ์แฝด (Twins)</option></select>}</Field>
    <Field label="หน่วยงาน" required>{id=><select id={id} required value={unit} onChange={e=>setUnit(e.target.value)}><option value="">เลือกหน่วยงาน</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>}</Field>
    <Field label="แพทย์ผู้ส่งตรวจ" help="เลือกตามใบขอส่งตรวจจากทะเบียนแพทย์ร่วม ไม่ใช่การลงนามใหม่">{id=><select id={id} value={doctor} onChange={e=>setDoctor(e.target.value)}><option value="">ยังไม่ระบุ</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>}</Field>
   </div>
   <label className="check-label"><input type="checkbox" required checked={request} onChange={e=>setRequest(e.target.checked)}/>มีใบขอส่งตรวจกระดาษที่ Lab</label>
   <label className="check-label"><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)}/>มี Paper Consent ที่ Lab</label>
   <ErrorNotice error={error}/>{linked?<Link className="button" href={'/cases/'+linked}>เปิดเคสเพื่อตรวจข้อมูล</Link>:<div className="action-bar"><button className="button" disabled={busy}>{busy?'กำลังลงทะเบียน…':'ลงทะเบียนและเข้าคิว Lab'}</button><button className="button secondary" type="button" disabled={busy} onClick={()=>setMode('CHOOSE')}>กลับไปเลือกประเภทงาน</button></div>}
  </form>}
 </Dialog>;
}
