'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {labApi,failureText} from './lab-api';
import {LabIcon} from '../shared/lab-icons';
type Row={id:string;ln:string;ln_halos:string;classification:string;case_id:string|null;match_issue:string|null};
const matchIssue:Record<string,string>={MIGRATION_PET_WARD_UNMAPPED:'ไม่พบหน่วยงานส่งตรวจในระบบ',MULTIPLE_PET_REVIEW_REQUIRED:'มี PET หลายรายการ ต้องตรวจสอบ',STORED_PET_CHANGED:'สถานะ PET เปลี่ยน ระบบจะลองใหม่',UNVERIFIED_PET:'ตรวจสอบไฟล์ PET ไม่สำเร็จ',IMPORT_AUTHORITY_INACTIVE:'สิทธิ์ผู้อนุมัติเดิมสิ้นสุด ให้ผู้ดูแลนำเข้าไฟล์เดิมซ้ำเพื่ออนุมัติการจับคู่',PROCESSING_FAILED:'จับคู่ PET ไม่สำเร็จ กรุณาติดต่อผู้ดูแล'};
export function MigrationWorklist(){
 const [data,setData]=useState<{rows:Row[];total:number}|null>(null);
 const [error,setError]=useState(''),[busyId,setBusyId]=useState<string|null>(null),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;labApi<{rows:Row[];total:number}>('/api/migration/worklist').then(x=>{if(live)setData(x);}).catch(()=>{});return()=>{live=false;};},[reload]);
 const remove=async(r:Row)=>{setBusyId(r.id);setError('');try{await labApi('/api/migration/worklist',{recordId:r.id});setReload(n=>n+1);}catch(e){setError(failureText(e));}finally{setBusyId(null);}};
 if(!data?.rows.length)return null;
 return <section className="panel stack" aria-label="รายการนำเข้ารอเข้า LAB"><h2>รายการนำเข้ารอเข้า LAB ({data.total})</h2>
 {error&&<p className="notice" role="alert">{error}</p>}
 <p className="muted">ระบบค้น PET ย้อนหลังเพื่อเติมข้อมูลให้อัตโนมัติ รายการที่ข้อมูลยังไม่ครบไม่กระทบตัวอย่างอื่น</p>
 <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">LN</th><th scope="col">LN Halos เดิม</th><th scope="col">สถานะ</th><th scope="col">รายการ</th><th scope="col"><span className="sr-only">เอาออก</span></th></tr></thead>
 <tbody>{data.rows.map(r=><tr key={r.id}><td>{r.ln}</td><td>{r.ln_halos}</td><td>{r.classification==='RERUN'?'รอตรวจซ้ำ':'รอเข้า LAB'}</td><td>{r.case_id?<Link href={`/cases/${r.case_id}`}>เปิดรายละเอียด</Link>:<span>{r.match_issue?matchIssue[r.match_issue]??`รอตรวจสอบ (${r.match_issue})`:'รอ PET / หน่วยงานส่งตรวจ'}</span>}</td><td>{!r.case_id&&r.classification==='NO_HALOS'&&<button type="button" className="icon-btn danger" title="เอาออกจากรายการ" aria-label={`เอา ${r.ln} ออกจากรายการ`} disabled={busyId===r.id} onClick={()=>void remove(r)}><LabIcon name="trash" size={20}/></button>}</td></tr>)}</tbody></table></div>
 </section>;
}
