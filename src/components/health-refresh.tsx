"use client";
import {useRouter} from "next/navigation";
import {useState,useTransition} from "react";
import {LabIcon} from "./shared/lab-icons";
/** OWNER-LAB-059: a single, user-triggered re-measurement (no polling loop, so no excess load). */
export function HealthRefresh({checkedAt}:{checkedAt:string|null}){
 const router=useRouter(),[pending,start]=useTransition(),[clicked,setClicked]=useState(false);
 return <div className="health-refresh"><button type="button" className="button secondary" disabled={pending} onClick={()=>{setClicked(true);start(()=>router.refresh());}}><LabIcon name="refresh"/>{pending?"กำลังตรวจ…":"ตรวจอีกครั้ง"}</button>
  <span className="help" aria-live="polite">{pending?"กำลังวัดสถานะล่าสุด":clicked&&checkedAt?"อัปเดตแล้ว":""}</span></div>;
}
