import Link from 'next/link';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../server/http';
import {pool} from '../../../../packages/db/connection';
import {listAnnualEqa,listActualIqc} from '../../../../packages/eqa/service';
import {authorize} from '../../../../packages/security/policy';
export default async function QualityControlPage({searchParams}:{searchParams:Promise<{year?:string}>}){
 const user=(await currentUser())!;
 if(!authorize(user,'case.read',{},'read')||!authorize(user,'batch.finalize',{},'read'))redirect('/');
 const search=await searchParams;
 const year=/^20\d{2}$/.test(search.year??'')?Number(search.year):new Date().getFullYear();
 const [eqa,iqc]=await Promise.all([listAnnualEqa(pool(),user,year),listActualIqc(pool(),user,year)]);
 return <main className="stack"><header className="page-header"><div><h1>Quality Control</h1><p className="muted">EQA ประจำปีและ IQC Positive / Negative จากข้อมูล Run จริง</p></div></header>
 <section className="panel"><form method="GET" className="row"><label htmlFor="qc-year">ปีโครงการ</label><input id="qc-year" type="number" name="year" min="2000" max="2200" defaultValue={year}/><button className="button">แสดง</button></form></section>
 <section className="panel"><h2>EQA ประจำปี ({eqa.length})</h2>
 <p className="help">แสดงเฉพาะเคสที่ลงทะเบียนและยืนยันตัวอย่าง EQA ภายในระบบ การจัดส่ง PDF ให้ผู้จัดดำเนินการโดยเจ้าหน้าที่ ไม่ใช่การส่งเข้า HIS</p>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>รหัสตัวอย่างจากผู้จัด</th><th>ผู้จัด</th><th>รหัสในระบบ</th><th>Run</th><th>สถานะรายงาน</th><th>รายละเอียด</th></tr></thead>
 <tbody>{eqa.map(x=><tr key={x.case_id}><td>{x.organizer_sample_id}</td><td>{x.organizer}</td><td>{x.ln_halos??'รอรับตัวอย่าง'}</td><td>{x.run_label??'ยังไม่เข้ารอบ'}</td><td>{x.report_id?'มีรายงานรับรอง':'ยังไม่มีรายงานรับรอง'}</td><td><Link href={'/cases/'+x.case_id}>ดูเคส</Link></td></tr>)}</tbody></table></div>
 {!eqa.length&&<p className="help">ยังไม่มีตัวอย่าง EQA ในปีนี้</p>}</section>
 <section className="panel"><h2>IQC — Positive / Negative</h2><p className="help">ค่าที่แสดงดึงจาก Workbook Revision ล่าสุดของ Run เท่านั้น ไม่เติมค่าหรือเกณฑ์ผ่าน/ไม่ผ่านเมื่อไม่มีข้อมูล</p>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>Control</th><th>ช่อง</th><th>Library QC (ค่าต้นฉบับ)</th><th>Revision</th></tr></thead>
 <tbody>{iqc.map(x=><tr key={x.batch_id+'-'+x.slot_number}><td>{x.run_label}</td><td>{x.control_type==='positive'?'Positive (PC)':'Negative (NC)'}</td><td>{x.slot_number}</td><td>{x.measurement??'ไม่มีค่าบันทึก'}</td><td>{x.revision??'ไม่มี Revision'}</td></tr>)}</tbody></table></div>
 {!iqc.length&&<p className="help">ไม่มีรายการ PC/NC สำหรับปีที่เลือก</p>}</section></main>;
}
