"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {LabIcon} from "../shared/lab-icons";
import "./job-progress.css";

export type JobView={state:"QUEUED"|"RUNNING"|"DONE"|"CANCELLED";kind?:string;result?:{outcome?:string;passed?:boolean;counts?:Record<string,number>}};
const OUTCOME:Record<string,string>={SUCCESS:"สำเร็จ",PARTIAL:"สำเร็จบางส่วน",SHARE_UNAVAILABLE:"เข้าถึงโฟลเดอร์ต้นทางไม่ได้",FAILED:"ล้มเหลว",SKIPPED_BACKOFF:"เว้นช่วงก่อนลองใหม่"};
const COUNT_LABEL:[string,string][]=[["stored","ไฟล์ใหม่"],["parseError","อ่านไม่ได้"],["sameContent","ซ้ำที่ข้าม"],["notNipt","ไม่ใช่ NIPT"],["waitingOk","รอ .ok"],["readError","อ่านไฟล์ไม่สำเร็จ"]];
const POLL_MS=1500,GIVE_UP_S=300;

/** Queues are answered by a worker; this follows one job (queued → running → done) and refreshes the page once when it ends. */
export function useJobProgress(onDone:()=>void){
 const [job,setJob]=useState<{id:string;startedAt:number}|null>(null),[view,setView]=useState<JobView|null>(null),[seconds,setSeconds]=useState(0),[stalled,setStalled]=useState(false);
 const done=useRef(onDone);useEffect(()=>{done.current=onDone;});
 const start=useCallback((id:string)=>{setView({state:"QUEUED"});setSeconds(0);setStalled(false);setJob({id,startedAt:Date.now()});},[]);
 useEffect(()=>{
  if(!job)return;
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
  const tick=setInterval(()=>setSeconds(Math.floor((Date.now()-job.startedAt)/1000)),1000);
  const poll=async()=>{
   try{
    const r=await fetch(`/api/p3/inbound/jobs/${job.id}`,{cache:"no-store"});
    if(r.ok){const next=await r.json() as JobView;if(!alive)return;setView(next);if(next.state==="DONE"||next.state==="CANCELLED"){clearInterval(tick);done.current();return;}}
   }catch{/* a single failed poll is retried */}
   if(!alive)return;
   if((Date.now()-job.startedAt)/1000>GIVE_UP_S){setStalled(true);clearInterval(tick);return;}
   timer=setTimeout(()=>void poll(),POLL_MS);
  };
  void poll();
  return()=>{alive=false;clearInterval(tick);if(timer)clearTimeout(timer);};
 },[job]);
 return {start,view,seconds,stalled,active:!!job&&!!view&&view.state!=="DONE"&&view.state!=="CANCELLED"&&!stalled};
}

/** Three visible steps with words and icons; the result is stated in words, never colour alone. */
export function JobProgress({view,seconds,stalled,label}:{view:JobView|null;seconds:number;stalled:boolean;label:string}){
 if(!view)return null;
 const running=view.state==="RUNNING",finished=view.state==="DONE",cancelled=view.state==="CANCELLED";
 const step=(n:number,text:string,at:"done"|"now"|"todo")=><li key={n} data-step={at}><LabIcon name={at==="done"?"check":at==="now"?"clock":"minusCircle"} size={16}/>{text}</li>;
 const r=view.result,counts=r?.counts??{};
 const failed=finished&&(r?.outcome?r.outcome!=="SUCCESS":r?.passed===false);
 return <div className="job-progress" role="status" aria-live="polite" aria-label={`ความคืบหน้า${label}`}>
  <ol>
   {step(1,"เข้าคิวแล้ว","done")}
   {step(2,finished?"Worker ทำงานเสร็จแล้ว":running?"Worker กำลัง"+label+"…":"รอ Worker รับงาน…",finished?"done":cancelled?"todo":running?"now":"now")}
   {step(3,cancelled?"ยกเลิกงาน":"ได้ผล",finished?"done":"todo")}
  </ol>
  {!finished&&!cancelled&&!stalled&&<progress aria-label={`กำลัง${label}`}/>}
  {!finished&&!cancelled&&<p className="help">ผ่านไป {seconds} วินาที{stalled?" · ใช้เวลานานกว่าปกติ ดูผลได้ในประวัติการสแกนด้านล่าง หรือตรวจว่า Worker ทำงานอยู่":""}</p>}
  {finished&&<p className={`job-result${failed?" bad":""}`}>{r?.outcome?`ผล: ${OUTCOME[r.outcome]??r.outcome}`:r?.passed===undefined?"เสร็จแล้ว":r.passed?"ผล: ผ่าน":"ผล: ไม่ผ่าน"}{r?.outcome&&" · "+COUNT_LABEL.filter(([k])=>counts[k]!==undefined).map(([k,t])=>`${t} ${counts[k]}`).join(" · ")}</p>}
 </div>;
}
