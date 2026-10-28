'use client';
import {useEffect,useState} from 'react';

type Status={config:{enabled:boolean;root_path:string|null};probe:{id:string;state:string;error_code:string|null;worker_account:string|null;retry_job_id:string|null}|null;counts:{state:string;count:number}[];errors:{id:string;state:string;last_error:string;attempts:number}[]};
const probeError:Record<string,string>={ARCHIVE_PUBLICATION_UNSUPPORTED:'NAS ไม่รองรับวิธีเผยแพร่ PDF อย่างปลอดภัย หรือ Windows ไม่อนุญาตให้ย้ายไฟล์โดยไม่เขียนทับ กรุณาตรวจสิทธิ์ Worker และ SMB',ARCHIVE_PROBE_EACCES:'บัญชี Worker ไม่มีสิทธิ์เข้าถึงหรือเขียนปลายทาง',ARCHIVE_PROBE_EPERM:'บัญชี Worker ไม่มีสิทธิ์ดำเนินการกับปลายทาง',ARCHIVE_PROBE_ENOENT:'ไม่พบปลายทางหรือเครือข่ายไม่พร้อม',ARCHIVE_WORKER_IDENTITY_UNAVAILABLE:'ตรวจสอบบัญชี Windows ของ Worker ไม่ได้'};
export function PdfArchiveSettings(){
 const [status,setStatus]=useState<Status|null>(null),[root,setRoot]=useState(''),[probeId,setProbeId]=useState<string|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const response=await fetch('/api/settings/pdf-archive',{cache:'no-store'});if(!response.ok)throw Error('โหลดสถานะไม่สำเร็จ');const data=await response.json() as Status;setStatus(data);return data;}
 useEffect(()=>{let active=true;void Promise.resolve().then(load).then(data=>{if(active)setRoot(data.config.root_path??'');}).catch(()=>{if(active)setMessage('โหลดสถานะ NAS ไม่สำเร็จ');});return()=>{active=false;};},[]);
 useEffect(()=>{if(!probeId)return;const timer=setInterval(()=>{void load().catch(()=>setMessage('โหลดผลทดสอบไม่สำเร็จ'));},2000);return()=>clearInterval(timer);},[probeId]);
 async function action(operation:'test'|'enable'|'disable'|'retry',jobId?:string){
  setBusy(true);setMessage('');try{const me=await fetch('/api/me').then(r=>r.json());const response=await fetch('/api/settings/pdf-archive',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':me.csrf},body:JSON.stringify({operation,path:root,probeId,jobId})});const data=await response.json();if(!response.ok)throw Error(data.error??'ทำรายการไม่สำเร็จ');if(operation==='test'||operation==='retry'){setProbeId(data.probeId);setMessage(operation==='retry'?'ส่งคำขอให้ Worker ตรวจ NAS ก่อนลองจัดเก็บใหม่แล้ว':'ส่งคำขอทดสอบไปยัง Worker แล้ว');}else{setProbeId(null);setMessage(operation==='enable'?'เปิดใช้งานแล้ว':'ปิดใช้งานแล้ว');}await load();}catch(error){setMessage(error instanceof Error?error.message:'ทำรายการไม่สำเร็จ');}finally{setBusy(false);}
 }
 const tested=status?.probe?.id===probeId&&status?.probe?.state==='PASSED'&&status?.probe?.retry_job_id==null;
 return <section className="panel"><h2>NAS PDF Archive</h2><p>เก็บสำเนาเฉพาะรายงานที่รับรองหลังเปิดใช้งาน สถานะนี้แยกจากผลทางคลินิกและ HIS</p>
  <label htmlFor="archive-root">NAS UNC Path</label><input id="archive-root" value={root} onChange={event=>{setRoot(event.target.value);setProbeId(null);}} spellCheck={false}/>
  <div><button className="button secondary" disabled={busy||!root} onClick={()=>void action('test')}>Test Connection</button>{' '}
  <button className="button" disabled={busy||!tested} onClick={()=>void action('enable')}>Save &amp; Enable</button>{' '}
  <button className="button secondary" disabled={busy||!status?.config.enabled} onClick={()=>void action('disable')}>ปิดใช้งาน</button></div>
  <p role="status">{message} {status?.config.enabled?'เปิดใช้งาน':'ปิดใช้งาน'}</p>
  {probeId&&status?.probe?.id===probeId&&<p>ผลทดสอบ: {status.probe.state} {status.probe.error_code?`${probeError[status.probe.error_code]??'ทดสอบไม่สำเร็จ กรุณาตรวจเครือข่ายและสิทธิ์บัญชี Worker'} (${status.probe.error_code})`:''} {status.probe.worker_account?` · Worker: ${status.probe.worker_account}`:''}</p>}
  <p>งาน Archive: {status?.counts.length?status.counts.map(x=>`${x.state}: ${x.count}`).join(' · '):'ไม่มีรายการ'}</p>
  {!!status?.errors.length&&<ul>{status.errors.map(error=><li key={error.id}>{error.state} · {error.last_error} · ครั้งที่ {error.attempts} {error.state==='FAILED'&&<>{' '}<button className="button secondary" disabled={busy||!status?.config.enabled} onClick={()=>void action('retry',error.id)}>ตรวจ NAS และลองจัดเก็บใหม่</button></>}</li>)}</ul>}
 </section>;
}
