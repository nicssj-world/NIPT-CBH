'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {api,Dialog,ErrorNotice,Field,Ln,message,time,type Unit} from './shared';
import {LabIcon} from '../shared/lab-icons';
import {patientDisplayName} from '../../../packages/domain/patient-name';
import type {RegistrationPet} from '../../../packages/p2/pet-registration';
import {CHOOSE_UNRESOLVED,DUPLICATE,NOT_FOUND,entryLabel,isDuplicate,summarize,toRegister,type Entry} from './lab-registration-batch';

/** A scanner on a Thai keyboard layout types Thai digits; the LN field always holds Latin digits. */
const latinDigits=(v:string)=>v.replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-0x0e50));
/** Searched on its own once the value looks complete (a full 10-digit LN, or an HN after a short pause); Enter always searches at once. */
const LOOKUP_DELAY_MS=600,looksComplete=(ln:string,hn:string)=>ln.trim().replaceAll('-','').length>=10||hn.trim().length>=5;
const numberOf=(e:Entry)=>/^\d{10}$/.test(e.ln)?<Ln value={e.ln}/>:<span className="ln-number">{entryLabel(e)}</span>;

/**
 * Lab registration is always on paper (request form and consent, Owner 2026-11-09), so there is no consent choice.
 * Each LN/HN is matched with its PET as soon as it is entered and listed with its status; only matched entries are
 * registered, in one step, and the result is summarised (registered, not matched and which numbers to check).
 */
export function LabRegistration({units,onClose,onRegistered}:{units:Unit[];onClose:()=>void;onRegistered?:()=>void}){
 const lnInput=useRef<HTMLInputElement>(null),summaryBox=useRef<HTMLElement>(null),timer=useRef<ReturnType<typeof setTimeout>>(undefined);
 const [mode,setMode]=useState<'CHOOSE'|'OPERATIONAL'>('CHOOSE'),[ln,setLn]=useState(''),[hn,setHn]=useState(''),[items,setItems]=useState<Entry[]>([]),[confirming,setConfirming]=useState(false),[finished,setFinished]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(finished)summaryBox.current?.focus();},[finished]);
 const patch=(id:string,change:Partial<Entry>)=>setItems(list=>list.map(i=>i.id===id?{...i,...change}:i));
 const waiting=items.filter(i=>i.state==='matching').length,matched=toRegister(items).length,summary=summarize(items);

 function typed(nextLn:string,nextHn:string){clearTimeout(timer.current);setError('');if(looksComplete(nextLn,nextHn))timer.current=setTimeout(()=>void add(nextLn,nextHn),LOOKUP_DELAY_MS);}
 /** Adds the entry at once (so list order follows entry order) and matches it in the background; the fields are free for the next one. */
 async function add(lnValue=ln,hnValue=hn){
  clearTimeout(timer.current);
  const lnClean=lnValue.trim().replaceAll('-',''),hnClean=hnValue.trim();
  if(!lnClean&&!hnClean){setError('กรอก LN หรือ HN อย่างใดอย่างหนึ่งก่อนค้นหา');return;}
  const entry:Entry={id:crypto.randomUUID(),key:crypto.randomUUID(),ln:lnClean,hn:lnClean?'':hnClean,state:'matching'};
  setItems(list=>[entry,...list]);setFinished(false);setLn('');setHn('');setError('');lnInput.current?.focus();
  try{
   const result=await api<{candidates:RegistrationPet[]}>('/api/p2/pet-registration',{action:'lookup',...(lnClean?{ln:lnClean}:{hn:hnClean})});
   const found=result.candidates;
   if(found.length===0)patch(entry.id,{state:'failed',reason:NOT_FOUND});
   else if(found.length>1)patch(entry.id,{state:'choose',candidates:found});
   else setItems(list=>list.map(i=>i.id!==entry.id?i:isDuplicate(list,entry.id,found[0])?{...i,state:'failed',reason:DUPLICATE}:{...i,state:'matched',pet:found[0]}));
  }catch(e){patch(entry.id,{state:'failed',reason:message(e)});}
 }
 function pick(entry:Entry,pet:RegistrationPet){setItems(list=>list.map(i=>i.id!==entry.id?i:isDuplicate(list,entry.id,pet)?{...i,state:'failed',reason:DUPLICATE}:{...i,state:'matched',pet,key:crypto.randomUUID()}));}
 /** Registers only the matched entries, one after another; an entry that fails stays in the list with its reason. */
 async function confirm(){
  const todo=toRegister(items);if(!todo.length||confirming)return;
  setConfirming(true);setError('');
  setItems(list=>list.map(i=>i.state==='choose'?{...i,state:'failed',reason:CHOOSE_UNRESOLVED}:i));
  for(const entry of todo){
   patch(entry.id,{state:'registering'});
   try{const result=await api<{caseId:string}>('/api/p2/pet-registration',{action:'register',...(entry.ln?{ln:entry.ln}:{hn:entry.hn}),fileId:entry.pet!.fileId,...(units[0]?{unitId:units[0].id}:{}),consentMode:'Paper',idempotencyKey:entry.key});patch(entry.id,{state:'registered',caseId:result.caseId});}
   catch(e){patch(entry.id,{state:'failed',failedAt:'register',reason:message(e)});}
  }
  setConfirming(false);setFinished(true);onRegistered?.();
 }
 const dirty=!!ln||!!hn||items.some(i=>i.state==='matched'||i.state==='choose'||i.state==='matching'||i.state==='registering');
 return <Dialog title="ลงทะเบียนโดย Lab" onClose={onClose} dirty={dirty}>
  {mode==='CHOOSE'?<div className="stack"><p>เลือกตามงานที่เกิดขึ้นจริง ข้อมูลผู้ป่วยใช้ทะเบียนกลางร่วมกัน</p><Link className="button secondary" href="/historical">ตรวจ Manual เสร็จแล้ว มี PDF</Link><button className="button" type="button" onClick={()=>setMode('OPERATIONAL')}>ลงทะเบียนตัวอย่างเพื่อตรวจตามระบบ</button></div>:<div className="stack">
   <p>กรอกหรือยิงบาร์โค้ด LN หรือ HN ทีละราย ระบบจับคู่กับข้อมูล PET จาก HIS ให้ทันที แล้วกดยืนยันเมื่อครบ</p>
   <p className="paper-note"><LabIcon name="file" size={18}/> ใบขอส่งตรวจและใบ Consent เป็นกระดาษ (ช่องทาง Lab) ระบบบันทึกเป็น Paper Consent ให้อัตโนมัติ</p>
   <form className="stack" onSubmit={e=>{e.preventDefault();void add();}}><div className="form-grid">
    <Field label="LN HIS" help="กรอก LN หรือ HN อย่างใดอย่างหนึ่ง">{id=><input id={id} ref={lnInput} autoFocus autoComplete="off" inputMode="numeric" value={ln} disabled={confirming} onChange={e=>{const v=latinDigits(e.target.value);setLn(v);typed(v,hn);}}/>}</Field>
    <Field label="HN">{id=><input id={id} autoComplete="off" value={hn} disabled={confirming} onChange={e=>{setHn(e.target.value);typed(ln,e.target.value);}}/>}</Field>
   </div><button className="button secondary" disabled={confirming||(!ln.trim()&&!hn.trim())}>เพิ่มเข้ารายการและจับคู่ PET</button></form>
   <ErrorNotice error={error}/>
   {finished&&<section className="registration-summary" aria-label="สรุปผลการลงทะเบียน" role="status" tabIndex={-1} ref={summaryBox}><h3>สรุปผลการลงทะเบียน</h3>
    <p className="summary-counts"><span><LabIcon name="check" size={18}/> ลงทะเบียนสำเร็จ <strong>{summary.registered}</strong> ราย</span><span><LabIcon name={summary.failed?'x':'check'} size={18}/> ไม่สำเร็จ <strong>{summary.failed}</strong> ราย</span></p>
    {summary.failed>0&&<><p>เลขที่ต้องตรวจสอบ (ไม่ได้นำเข้า):</p><ul>{summary.failedEntries.map((f,idx)=><li key={idx}><strong>{f.label}</strong> — {f.reason}</li>)}</ul></>}
    <button className="button secondary" type="button" onClick={()=>{setItems([]);setFinished(false);lnInput.current?.focus();}}>เริ่มรอบใหม่</button></section>}
   {items.length>0&&<section aria-label="รายการในรอบนี้"><h3>รายการในรอบนี้ ({items.length} ราย)</h3><ul className="registered-list">{items.map(i=><li key={i.id} data-state={i.state}>
    <div className="registered-main"><strong>{numberOf(i)}</strong>{i.pet&&<> · HN {i.pet.hn||'—'} · {patientDisplayName(i.pet.name)}</>}
     {i.state==='matching'&&<span className="match-status pending"><LabIcon name="clock" size={16}/> กำลังจับคู่ PET…</span>}
     {i.state==='matched'&&<span className="match-status"><LabIcon name="check" size={16}/> จับคู่ PET สำเร็จ · รอยืนยัน</span>}
     {i.state==='registering'&&<span className="match-status pending"><LabIcon name="clock" size={16}/> กำลังลงทะเบียน…</span>}
     {i.state==='registered'&&<span className="match-status"><LabIcon name="check" size={16}/> จับคู่ PET สำเร็จ · ลงทะเบียนแล้ว{i.caseId&&<> · <Link href={'/cases/'+i.caseId} target="_blank" rel="noopener" aria-label={'เปิดเคส '+entryLabel(i)+' ในแท็บใหม่'}>เปิดเคส</Link></>}</span>}
     {i.state==='failed'&&<span className="match-status failed"><LabIcon name="x" size={16}/> {i.failedAt==='register'?'จับคู่ PET สำเร็จ แต่ลงทะเบียนไม่สำเร็จ':'จับคู่ PET ไม่สำเร็จ'} — {i.reason}</span>}
     {i.state!=='registered'&&i.state!=='registering'&&<button type="button" className="icon-btn" title="เอาออกจากรายการ" aria-label={'เอา '+entryLabel(i)+' ออกจากรายการ'} disabled={confirming} onClick={()=>setItems(list=>list.filter(o=>o.id!==i.id))}><LabIcon name="trash" size={18}/></button>}
    </div>
    {i.state==='choose'&&i.candidates&&<fieldset className="stack"><legend><LabIcon name="alert" size={16}/> พบหลาย LN — เลือกรายการตรวจที่ถูกต้อง</legend>{i.candidates.map(c=><label className="check-label" key={c.fileId}><input type="radio" name={'pick-'+i.id} value={c.fileId} onChange={()=>pick(i,c)}/>LN {c.ln} · HN {c.hn} · {patientDisplayName(c.name)} · รับตัวอย่าง {time(c.receivedAt)}</label>)}</fieldset>}
   </li>)}</ul></section>}
   {items.length>0&&<button className="button" type="button" disabled={confirming||waiting>0||matched===0} onClick={()=>void confirm()}>{confirming?'กำลังลงทะเบียน…':waiting>0?'รอจับคู่ PET ให้ครบก่อน…':`ยืนยันลงทะเบียน (${matched} ราย)`}</button>}
   <p className="help">GA, EDD/EDC และประเภทครรภ์กรอกภายหลังในรายละเอียดตัวอย่างได้ LN Halos เกิดจากหลักฐานรับตัวอย่างที่ถูกต้องเท่านั้น หากมีเลขแล้วระบบใช้เลขเดิม · Paper Consent เป็นเครื่องหมายว่าใช้ต้นฉบับกระดาษที่มากับตัวอย่าง ไม่ใช่การรับรองทางคลินิก</p>
   <button className="button secondary" type="button" disabled={confirming} onClick={()=>setMode('CHOOSE')}>กลับไปเลือกประเภทงาน</button>
  </div>}
 </Dialog>;
}
