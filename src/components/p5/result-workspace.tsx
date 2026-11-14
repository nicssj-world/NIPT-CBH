"use client";
import {useState} from "react";
import {NativeReports} from "./native-reports";
import {ReadyGenIntake,type ImportSummary} from "./readygen-intake";
import {ReleaseBoard} from "./release-board";
import {ResultHistorySearch} from "./result-history-search";
import type {BoardTab} from "./release-board-logic";
import './result-workflow.css';

// Results page: two ways in (ReadyGen PDF, HALOS file) feed ONE board — ต้องจัดการ / รออนุมัติผลและส่ง HIS / ส่งแล้ว. A result is visible to ANC only after "ส่ง HIS".
export function ResultWorkspace({canImport,canSettings,canExport=false}:{canImport:boolean;canSettings:boolean;canExport?:boolean}){
 const [channel,setChannel]=useState<'pdf'|'halos'>('pdf'),[tab,setTab]=useState<BoardTab>('READY'),[refresh,setRefresh]=useState(0);
 const showTab=(t:BoardTab)=>{setTab(t);setRefresh(n=>n+1);};
 const imported=(s:ImportSummary)=>showTab(s.ready>0||s.action===0?'READY':'ACTION');
 return <>
  <header className="page-header"><div><h1>ผลตรวจ NIPT</h1></div></header>
  <div className="result-channel-switch" role="group" aria-label="เลือกช่องทางออกผล">
   <button type="button" className={`button ${channel==='pdf'?'':'secondary'}`} aria-pressed={channel==='pdf'} onClick={()=>setChannel('pdf')}>นำเข้า PDF จาก ReadyGen</button>
   <button type="button" className={`button ${channel==='halos'?'':'secondary'}`} aria-pressed={channel==='halos'} onClick={()=>setChannel('halos')}>สร้างรายงานจาก HALOS</button>
  </div>
  <p className="help result-channel-description">{channel==='pdf'?'มี PDF Final จาก ReadyGen แล้ว: สแกนไฟล์แล้วกด “นำเข้า” ผลที่จับคู่ได้จะไป “รออนุมัติผลและส่ง HIS”':'มีไฟล์ผลจาก HALOS: ตรวจผลแปล เลือกผู้ลงนาม แล้วออกรายงาน ผลจะไป “รออนุมัติผลและส่ง HIS”'}</p>
  {channel==='halos'&&<NativeReports canImport={canImport} onReported={()=>showTab('READY')}/>}
  {canImport&&channel==='pdf'&&<ReadyGenIntake canSettings={canSettings} onImported={imported}/>}
  <ReleaseBoard tab={tab} onTab={setTab} refreshKey={refresh} sentExtras={<ResultHistorySearch canExport={canExport}/>}/>
 </>;
}
