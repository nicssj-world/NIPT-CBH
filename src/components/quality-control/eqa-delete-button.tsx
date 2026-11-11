"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {api,ApiFailure,Dialog,ErrorNotice,message} from "../p2/shared";
import "./quality-control.css";

const DELETE_MESSAGES:Record<string,string>={
 EQA_HAS_DOWNSTREAM_WORK:"ลบไม่ได้ เพราะมีงานต่อจากการลงทะเบียนแล้ว (เช่น label, Run, ผลตรวจ หรือรายงาน)",
 EQA_NOT_FOUND:"ไม่พบรายการ EQA นี้ (อาจถูกลบไปแล้ว)"
};
type Deleted={lnHalos:string;numberReusable:boolean};
/** Deletes a mistaken EQA registration. One confirmation; the database refuses when anything was built on it. */
export function EqaDeleteButton({caseId,sampleRef,lnHalos}:{caseId:string;sampleRef:string;lnHalos:string|null}){
 const router=useRouter(),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState<Deleted|null>(null);
 const close=()=>{setOpen(false);if(done)router.refresh();else requestAnimationFrame(()=>trigger.current?.focus());};
 async function submit(){
  setBusy(true);setError("");
  try{setDone(await api<Deleted>("/api/eqa/delete",{caseId}));}
  catch(e){setError((e instanceof ApiFailure&&DELETE_MESSAGES[e.code])||message(e));}finally{setBusy(false);}
 }
 return <>
  <button ref={trigger} type="button" className="button small secondary qc-delete" aria-label={`ลบการลงทะเบียน EQA ${sampleRef}`} onClick={()=>{setOpen(true);setDone(null);setError("");}}>ลบ</button>
  {open&&<Dialog title="ลบการลงทะเบียน EQA" onClose={close}>
   {done?<div className="stack"><p role="status" className="notice success">ลบแล้ว{done.lnHalos?` LN Halos ${done.lnHalos}`:""} {done.numberReusable?"ใช้เลขนี้ซ้ำได้":"เลขนี้เป็นเลขเก่าที่มีผู้ป่วยรายถัดไปแล้ว จึงไม่กลับมาใช้ซ้ำ (ไม่กระทบเลขอื่น)"}</p>
     <div className="dialog-actions"><button type="button" className="button" onClick={close}>ปิด</button></div></div>
   :<form className="stack" onSubmit={e=>{e.preventDefault();if(!busy)void submit();}}>
    <p>ลบตัวอย่าง EQA <strong>{sampleRef}</strong>{lnHalos?<> (LN Halos <code>{lnHalos}</code>)</>:null} ออกจากระบบ ใช้ได้เฉพาะรายการที่ยังไม่มีงานต่อจากการลงทะเบียน ระบบเก็บบันทึกการลบไว้ตรวจสอบ</p>
    <ErrorNotice error={error}/>
    <div className="dialog-actions"><button type="submit" className="button" disabled={busy}>{busy?"กำลังลบ…":"ยืนยันการลบ"}</button><button type="button" className="button secondary" onClick={close} disabled={busy}>ยกเลิก</button></div>
   </form>}
  </Dialog>}
 </>;
}
