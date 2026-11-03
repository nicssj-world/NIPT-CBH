"use client";
import {useEffect,useState} from "react";
import Image from "next/image";
type Evidence={id:string;sequence:number;roundNumber:number;createdAt:string};
/** Read-only gallery. Photos are fetched via an authenticated, scope-checked endpoint, not public storage. */
export function RejectionEvidence({caseId}:{caseId:string}){
 const [items,setItems]=useState<Evidence[]|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let active=true;
  fetch("/api/p4/specimen-rejection-evidence?caseId="+encodeURIComponent(caseId),{cache:"no-store"})
   .then(r=>{if(!r.ok)throw new Error("DENIED");return r.json() as Promise<{photos:Evidence[]}>;})
   .then(d=>{if(active)setItems(d.photos);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[caseId]);
 if(!items?.length&&!error)return null;
 return <section className="panel rejection-evidence-history" aria-label="รูปภาพประกอบการปฏิเสธสิ่งส่งตรวจ">
  <h2>หลักฐานการปฏิเสธสิ่งส่งตรวจ</h2>
  {error?<p className="help">ไม่สามารถโหลดรูปภาพประกอบได้ กรุณาตรวจสอบสิทธิ์หรือลองเปิดรายละเอียดอีกครั้ง</p>:
   <div className="rejection-history-grid">{items!.map(e=><figure key={e.id}>
    <a href={"/api/p4/specimen-rejection-evidence/"+e.id} target="_blank" rel="noopener noreferrer" aria-label={"เปิดรูปภาพหลักฐานรอบที่ "+e.roundNumber+" รูปที่ "+e.sequence}>
     <Image unoptimized src={"/api/p4/specimen-rejection-evidence/"+e.id} alt={"ภาพสิ่งส่งตรวจที่ปฏิเสธ รอบที่ "+e.roundNumber+" รูปที่ "+e.sequence} width={160} height={120}/>
    </a>
    <figcaption>รอบที่ {e.roundNumber} · รูปที่ {e.sequence}<small>{new Date(e.createdAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"})}</small></figcaption>
   </figure>)}</div>}
 </section>;
}
