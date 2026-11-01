'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {labApi} from './lab-api';
type Row={id:string;ln:string;ln_halos:string;classification:string;case_id:string|null};
export function MigrationWorklist(){
 const [data,setData]=useState<{rows:Row[];total:number}|null>(null);
 useEffect(()=>{let live=true;labApi<{rows:Row[];total:number}>('/api/migration/worklist').then(x=>{if(live)setData(x);}).catch(()=>{});return()=>{live=false;};},[]);
 if(!data?.rows.length)return null;
 return <section className="panel stack" aria-label="รายการนำเข้ารอเข้า LAB"><h2>รายการนำเข้ารอเข้า LAB ({data.total})</h2>
 <p className="muted">ระบบค้น PET ย้อนหลังเพื่อเติมข้อมูลให้อัตโนมัติ รายการที่ข้อมูลยังไม่ครบไม่กระทบตัวอย่างอื่น</p>
 <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">LN</th><th scope="col">LN Halos เดิม</th><th scope="col">สถานะ</th><th scope="col">รายการ</th></tr></thead>
 <tbody>{data.rows.map(r=><tr key={r.id}><td>{r.ln}</td><td>{r.ln_halos}</td><td>{r.classification==='RERUN'?'รอตรวจซ้ำ':'รอเข้า LAB'}</td><td>{r.case_id?<Link href={`/cases/${r.case_id}`}>เปิดรายละเอียด</Link>:<span>รอ PET / หน่วยงานส่งตรวจ</span>}</td></tr>)}</tbody></table></div>
 </section>;
}
