'use client';
import {useEffect,useState} from 'react';
import {labApi,failureText} from '../p4/lab-api';
import {Dialog} from '../p2/shared';
const labels={TASK_LIST:'Task List',QC:'QC',POOLING:'Pooling',SEQUENCING:'Sequencing'};
export function ManualStageMarkers({draftId,canWrite}:{draftId:string;canWrite:boolean}){
 const [open,setOpen]=useState(false),[stages,setStages]=useState({TASK_LIST:false,QC:false,POOLING:false,SEQUENCING:false}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const endpoint='/api/p5h/manual-stages/'+draftId;
 useEffect(()=>{if(!open)return;let active=true;labApi<{stage:keyof typeof labels;performed:boolean}[]>(endpoint).then(rows=>{if(active)setStages({TASK_LIST:rows.some(r=>r.stage==='TASK_LIST'&&r.performed),QC:rows.some(r=>r.stage==='QC'&&r.performed),POOLING:rows.some(r=>r.stage==='POOLING'&&r.performed),SEQUENCING:rows.some(r=>r.stage==='SEQUENCING'&&r.performed)});}).catch(e=>{if(active)setError(failureText(e));});return()=>{active=false;};},[open,endpoint]);
 return <><button className="button secondary small" type="button" onClick={()=>setOpen(true)}>งานกระดาษ Manual</button>{open&&<Dialog title="งานที่ปฏิบัติบนกระดาษ" onClose={()=>setOpen(false)}><p>ทำเครื่องหมายเฉพาะงานที่ทำจริงแล้ว เอกสารกระดาษเก็บไว้ที่ Lab ไม่ต้องอัปโหลดใบงาน ระบบไม่สร้างค่า QC หรือลงวันที่ปฏิบัติงานแทน</p><div className="stack">{Object.entries(labels).map(([key,label])=><label key={key} className="check-label"><input type="checkbox" disabled={!canWrite||busy} checked={stages[key as keyof typeof labels]} onChange={e=>setStages(v=>({...v,[key]:e.target.checked}))}/>{label}: {stages[key as keyof typeof labels]?'ดำเนินการแล้ว — Manual':'ยังไม่ยืนยันว่าทำแล้ว'}</label>)}</div>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{canWrite&&<button className="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await labApi(endpoint,{stages});setNotice('บันทึกสถานะ Manual ตามที่ยืนยันแล้ว ไม่มีการปล่อยผลหรือส่ง HIS อัตโนมัติ');}catch(e){setError(failureText(e));}finally{setBusy(false);}}}>บันทึกงาน Manual ที่ทำจริง</button>}</Dialog>}</>;
}
