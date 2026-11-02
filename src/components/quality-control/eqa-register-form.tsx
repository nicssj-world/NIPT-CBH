"use client";
import Link from "next/link";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {api,Dialog,ErrorNotice,Field,message,type Unit} from "../p2/shared";
import {ThaiDateInput} from "../shared/thai-date-input";

type Done={caseId:string;lnHalos:string};
/** EQA registration from the organizer's referral card. The card is the only source: nothing is inferred (it has no EDD, so none is asked). */
export function EqaRegisterForm({units}:{units:Unit[]}){
 const router=useRouter(),key=useRef(crypto.randomUUID());
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState<Done|null>(null);
 const [f,setF]=useState({unitId:units[0]?.id??"",organizer:"GenQA/EMQN",programYear:String(new Date().getFullYear()),sampleRef:"",ln:"",surname:"",firstName:"",dob:"",gaWeeks:"",gaDays:"",collectionDate:"",pregnancy:"Singleton"});
 const set=(k:keyof typeof f)=>(v:string)=>setF(s=>({...s,[k]:v}));
 const input=(k:keyof typeof f,id:string,extra:Record<string,unknown>={})=><input id={id} className="input" value={f[k]} disabled={busy} onChange={e=>set(k)(e.target.value)} {...extra}/>;
 async function submit(){
  setBusy(true);setError("");
  try{
   const result=await api<Done>("/api/eqa/register",{unitId:f.unitId,idempotencyKey:key.current,organizer:f.organizer.trim(),programYear:Number(f.programYear),sampleRef:f.sampleRef.trim(),ln:f.ln.trim().replaceAll("-",""),
    surname:f.surname.trim(),firstName:f.firstName.trim(),dob:f.dob,gaWeeks:Number(f.gaWeeks),gaDays:Number(f.gaDays),collectionDate:f.collectionDate,pregnancy:f.pregnancy});
   setDone(result);router.refresh();
  }catch(e){setError(message(e));key.current=crypto.randomUUID();}finally{setBusy(false);}
 }
 const ready=!!(f.unitId&&f.organizer.trim()&&f.sampleRef.trim()&&f.ln.trim()&&f.surname.trim()&&f.firstName.trim()&&f.dob&&f.collectionDate&&f.gaWeeks!==""&&f.gaDays!=="");
 return <>
  <button type="button" className="button" onClick={()=>{setOpen(true);setDone(null);setError("");key.current=crypto.randomUUID();}}>ลงทะเบียน EQA</button>
  {open&&<Dialog title="ลงทะเบียนตัวอย่าง EQA" onClose={()=>setOpen(false)} dirty={!done&&!!(f.sampleRef||f.surname)}>
   {done?<div className="stack"><p role="status" className="notice success">ลงทะเบียนและรับตัวอย่างแล้ว LN Halos <strong>{done.lnHalos}</strong></p>
     <p className="help">ขั้นต่อไปเหมือนผู้ป่วยปกติ: รับตัวอย่าง (กดยืนยันครั้งเดียว) แล้วจัดเข้า Task List</p>
     <div className="dialog-actions"><Link className="button" href={`/cases/${done.caseId}`}>ดูรายละเอียดตัวอย่าง</Link><button type="button" className="button secondary" onClick={()=>setOpen(false)}>ปิด</button></div></div>
   :<form className="stack" onSubmit={e=>{e.preventDefault();if(ready&&!busy)void submit();}}>
    <p className="help">กรอกตามบัตร Referral ของผู้จัดเท่านั้น ระบบไม่เดาค่าที่ไม่มีในบัตร (เช่น EDD) และไม่มีการส่งผลไปยัง HIS</p>
    <ErrorNotice error={error}/>
    <div className="grid-2">
     <Field label="ผู้จัดโปรแกรม" required>{id=>input("organizer",id,{maxLength:120})}</Field>
     <Field label="ปี EQA" required>{id=>input("programYear",id,{inputMode:"numeric",maxLength:4})}</Field>
     <Field label="Hospital No. บนบัตร (ใช้เป็น HN)" required>{id=>input("sampleRef",id,{maxLength:80})}</Field>
     <Field label="เลข LN ของตัวอย่าง" required help="เลข LN ภายในที่ไม่ซ้ำกับผู้ป่วย">{id=>input("ln",id,{inputMode:"numeric",maxLength:32})}</Field>
     <Field label="นามสกุล (Surname)" required>{id=>input("surname",id,{maxLength:120})}</Field>
     <Field label="ชื่อ (First name)" required>{id=>input("firstName",id,{maxLength:120})}</Field>
     <Field label="วันเกิด" required>{id=><ThaiDateInput id={id} value={f.dob} onChange={set("dob")} disabled={busy}/>}</Field>
     <Field label="วันที่เก็บตัวอย่าง" required>{id=><ThaiDateInput id={id} value={f.collectionDate} onChange={set("collectionDate")} disabled={busy}/>}</Field>
     <Field label="อายุครรภ์ตามสแกน (สัปดาห์)" required>{id=>input("gaWeeks",id,{inputMode:"numeric",maxLength:2})}</Field>
     <Field label="อายุครรภ์ตามสแกน (วัน)" required>{id=>input("gaDays",id,{inputMode:"numeric",maxLength:1})}</Field>
     <Field label="ชนิดครรภ์" required>{id=><select id={id} className="input" value={f.pregnancy} disabled={busy} onChange={e=>set("pregnancy")(e.target.value)}><option value="Singleton">ครรภ์เดี่ยว (Singleton)</option><option value="Twins">ครรภ์แฝด (Twins)</option></select>}</Field>
     {units.length>1&&<Field label="หน่วยงาน" required>{id=><select id={id} className="input" value={f.unitId} disabled={busy} onChange={e=>set("unitId")(e.target.value)}>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>}</Field>}
    </div>
    <div className="dialog-actions"><button type="submit" className="button" disabled={!ready||busy}>{busy?"กำลังบันทึก…":"ลงทะเบียนและรับตัวอย่าง"}</button><button type="button" className="button secondary" onClick={()=>setOpen(false)} disabled={busy}>ยกเลิก</button></div>
   </form>}
  </Dialog>}
 </>;
}
