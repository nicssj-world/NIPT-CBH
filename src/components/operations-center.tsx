'use client';
import Link from 'next/link';
import {useState} from 'react';

type Summary={
 archiveCounts:{state:string;count:number}[];
 released24h:number;
 pdfAccess7d:{purpose:string;count:number}[];
 exceptions:{id:string;state:string;attempts:number;last_error:string|null;updated_at:string}[];
 pdfAudit:{actor_name:string;version_id:string|null;purpose:string;accessed_at:string}[];
};
const label:Record<string,string>={
 ANC_RESULT_FILE:'เปิดรายงาน ANC',ANC_RESULT_PRINT_VIEW:'ดูรายงานเพื่อพิมพ์',LAB_REVIEW_FILE:'เปิดรายงาน LAB',
 ARCHIVED:'จัดเก็บสำเร็จ',PENDING:'รอจัดเก็บ',FAILED:'จัดเก็บไม่สำเร็จ'
};
const fmt=(v:string)=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
export function OperationsCenter({summary}: {summary:Summary}){
 const [busy,setBusy]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [sent,setSent]=useState<string[]>([]);
 const count=(state:string)=>summary.archiveCounts.find(x=>x.state===state)?.count??0;
 const access=(purpose:string)=>summary.pdfAccess7d.find(x=>x.purpose===purpose)?.count??0;
 async function recheck(jobId:string){
  setBusy(jobId);setNotice('');
  try{
   const who=await fetch('/api/me',{cache:'no-store'});if(!who.ok)throw Error('ไม่สามารถตรวจสอบสิทธิ์ได้');
   const csrf=(await who.json()).csrf;
   const response=await fetch('/api/settings/pdf-archive',{method:'POST',
    headers:{'Content-Type':'application/json','x-csrf-token':csrf},
    body:JSON.stringify({operation:'retry',jobId})});
   const result=await response.json();
   if(!response.ok||result.state!=='PENDING_PROBE')throw Error('ไม่สามารถส่งคำขอได้ โปรดตรวจ NAS Settings');
   setSent(prev=>[...prev,jobId]);
   setNotice('ส่งคำขอให้ Worker ทดสอบ NAS แล้ว สถานะจะเปลี่ยนได้หลัง Worker ตรวจผ่านเท่านั้น');
  }catch(e){setNotice(e instanceof Error?e.message:'ทำรายการไม่สำเร็จ');}finally{setBusy(null);}
 }
 return <div className="stack" style={{display:'grid',gap:'1rem'}}>
  <section className="panel"><h2>KPI การดำเนินงาน</h2><p className="muted">ข้อมูลตามเวลาฐานข้อมูล ไม่ใช่จำนวนที่ HIS ยืนยันรับแล้ว</p>
   <dl className="compact-facts">
    <div><dt>รายงานรับรองใน 24 ชั่วโมง</dt><dd>{summary.released24h}</dd></div>
    <div><dt>PDF จัดเก็บบน NAS สำเร็จ</dt><dd>{count('ARCHIVED')}</dd></div>
    <div><dt>PDF รอดำเนินการ / ล้มเหลว</dt><dd>{count('PENDING')} / {count('FAILED')}</dd></div>
    <div><dt>เปิดรายงาน ANC / ดูเพื่อพิมพ์ (7 วัน)</dt><dd>{access('ANC_RESULT_FILE')} / {access('ANC_RESULT_PRINT_VIEW')}</dd></div>
    <div><dt>เปิดรายงาน LAB (7 วัน)</dt><dd>{access('LAB_REVIEW_FILE')}</dd></div>
   </dl>
   <p><Link href="/health">สถานะ Worker, HIS/CFS, Queue และ Backup</Link>{' · '}<Link href="/settings/backup">หลักฐาน Backup/Restore</Link></p>
  </section>
  <section className="panel"><h2>Exception Center — NAS PDF Archive</h2>
   <p className="muted">แสดงเฉพาะงาน FAILED และ PENDING เกิน 30 นาที การลองใหม่ไม่สั่งออกผลหรือส่ง HIS ซ้ำ</p>
   {summary.exceptions.length===0?<p>ไม่พบงาน Archive ที่เข้าเกณฑ์แจ้งเตือน</p>:
    <ul>{summary.exceptions.map(e=><li key={e.id} style={{marginBlock:'0.65rem'}}>
      <strong>{label[e.state]??e.state}</strong>{' · '}{fmt(e.updated_at)}{' · '}ครั้งที่ {e.attempts}
      {e.last_error?' · '+e.last_error:''}
      {e.state==='FAILED'&&<>{' '}<button type="button" className="button secondary"
       disabled={busy!==null||sent.includes(e.id)} onClick={()=>void recheck(e.id)}>
       {busy===e.id?'กำลังส่งคำขอ':'ตรวจ NAS และลองจัดเก็บใหม่'}
      </button></>}
     </li>)}</ul>}
   <p role="status">{notice}</p>
   <p><Link href="/settings">ตั้งค่าและทดสอบ NAS</Link></p>
  </section>
  <section className="panel"><h2>PDF Access Audit — ล่าสุด 30 รายการ</h2>
   <p className="muted">แสดงผู้เปิดอ่าน ประเภทการเข้าถึง และรหัสรุ่นรายงาน โดยไม่แสดงข้อมูลผู้ป่วยหรือเนื้อหา PDF</p>
   {summary.pdfAudit.length===0?<p>ยังไม่มีประวัติการเปิดรายงานตามประเภทที่ติดตาม</p>:
   <div style={{overflowX:'auto'}}><table><thead><tr><th>เวลา</th><th>ผู้ใช้งาน</th><th>ประเภท</th><th>รหัสรุ่นรายงาน</th></tr></thead>
    <tbody>{summary.pdfAudit.map((e,i)=><tr key={e.version_id+'-'+e.accessed_at+'-'+i}><td>{fmt(e.accessed_at)}</td><td>{e.actor_name}</td><td>{label[e.purpose]??e.purpose}</td><td><code>{e.version_id??'—'}</code></td></tr>)}</tbody>
   </table></div>}
   <p><Link href="/settings/audit">Audit Log ระบบ</Link></p>
  </section>
 </div>;
}
