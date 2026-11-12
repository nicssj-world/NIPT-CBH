'use client';
import {useEffect,useState} from 'react';
import {Dialog} from './p2/shared';
import {CopyButton} from './shared/copy-button';
import './https-certificate-settings.css';

type Cert={subject:string;commonName:string|null;issuer:string;validFrom:string;validTo:string;daysLeft:number;sha256:string;type:'SELF_SIGNED'|'CA_ISSUED';status:'VALID'|'EXPIRING_SOON'|'EXPIRED'|'NOT_YET_VALID';hostname:string;subjectAltName:string|null};
const statusView:Record<Cert['status'],{label:string;tone:string}>={VALID:{label:'ใช้งานได้ (Valid)',tone:'ok'},EXPIRING_SOON:{label:'ใกล้หมดอายุ (Expiring Soon)',tone:'warning'},EXPIRED:{label:'หมดอายุแล้ว (Expired)',tone:'danger'},NOT_YET_VALID:{label:'ยังไม่ถึงวันเริ่มใช้ (Not Yet Valid)',tone:'danger'}};
const unavailable:Record<string,string>={HTTPS_NOT_ENABLED:'ระบบนี้ยังไม่ได้เปิดใช้ HTTPS (APP_ORIGIN ไม่ใช่ https://) จึงไม่มีใบรับรองให้ดาวน์โหลด',APP_ORIGIN_NOT_SET:'ยังไม่ได้กำหนด APP_ORIGIN ของระบบนี้',APP_ORIGIN_INVALID:'APP_ORIGIN ของระบบนี้ไม่ถูกต้อง',TLS_TIMEOUT:'เชื่อมต่อบริการ HTTPS ไม่ทันเวลา กรุณาลองใหม่',TLS_UNAVAILABLE:'เชื่อมต่อบริการ HTTPS ของระบบนี้ไม่ได้ กรุณาตรวจว่าบริการ HTTPS ทำงานอยู่',NO_CERTIFICATE:'บริการ HTTPS ไม่ส่งใบรับรองกลับมา'};
const formatDate=(iso:string)=>new Date(iso).toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'});
const remaining=(cert:Cert)=>cert.daysLeft<0?`หมดอายุมาแล้ว ${-cert.daysLeft} วัน`:`เหลืออีก ${cert.daysLeft} วัน`;

export function HttpsCertificateSettings(){
 const [cert,setCert]=useState<Cert|null>(null),[reason,setReason]=useState<string|null>(null),[error,setError]=useState(false),[guide,setGuide]=useState(false);
 useEffect(()=>{let active=true;void fetch('/api/settings/certificate',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then((data:{certificate:Cert|null;reason?:string})=>{if(!active)return;setCert(data.certificate);setReason(data.reason??null);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 const view=cert?statusView[cert.status]:null;
 return <section className="panel https-cert" aria-labelledby="https-cert-title">
  <h2 id="https-cert-title">ใบรับรองความปลอดภัย HTTPS (HTTPS Certificate)</h2>
  <p className="muted">ใบรับรองสาธารณะที่ระบบนี้ใช้อยู่จริง ใช้ติดตั้งบนคอมพิวเตอร์เครื่องอื่นในโรงพยาบาลเพื่อให้เบราว์เซอร์เชื่อถือ ไฟล์ที่ดาวน์โหลดไม่มีกุญแจส่วนตัว</p>
  {error&&<p role="alert" className="cert-note danger">โหลดข้อมูลใบรับรองไม่สำเร็จ กรุณารีเฟรชหน้า</p>}
  {!error&&!cert&&reason&&<p role="status" className="cert-note">{unavailable[reason]??'ไม่พบข้อมูลใบรับรอง'}</p>}
  {!error&&!cert&&!reason&&<p role="status" className="muted">กำลังอ่านใบรับรอง…</p>}
  {cert&&view&&<>
   {cert.status!=='VALID'&&<p role="alert" className={`cert-note ${view.tone}`}>{cert.status==='EXPIRING_SOON'?`ใบรับรองจะหมดอายุภายใน 30 วัน (${remaining(cert)}) ติดต่อผู้ติดตั้งระบบเพื่อเตรียมออกใบรับรองใหม่`:cert.status==='EXPIRED'?'ใบรับรองหมดอายุแล้ว เบราว์เซอร์จะแจ้งเตือนความปลอดภัย ติดต่อผู้ติดตั้งระบบเพื่อออกใบรับรองใหม่':'ใบรับรองยังไม่ถึงวันเริ่มใช้ ตรวจสอบวันและเวลาของเซิร์ฟเวอร์'} (หน้านี้ดาวน์โหลดได้อย่างเดียว ไม่ต่ออายุหรือเปลี่ยนใบรับรองให้)</p>}
   <dl className="cert-grid">
    <div><dt>สถานะ</dt><dd><span className={`cert-status ${view.tone}`}>{view.label}</span></dd></div>
    <div><dt>Hostname ของระบบ</dt><dd>{cert.hostname}</dd></div>
    <div><dt>Subject / Common Name</dt><dd>{cert.commonName??cert.subject}</dd></div>
    <div><dt>Issuer</dt><dd>{cert.issuer}</dd></div>
    <div><dt>ประเภท</dt><dd>{cert.type==='SELF_SIGNED'?'Self-signed (ออกให้ตัวเอง)':'ออกโดย CA'}</dd></div>
    <div><dt>เริ่มใช้ได้ (Valid From)</dt><dd>{formatDate(cert.validFrom)}</dd></div>
    <div><dt>วันหมดอายุ (Expiration)</dt><dd>{formatDate(cert.validTo)} <span className="muted">· {remaining(cert)}</span></dd></div>
    <div className="cert-wide"><dt>SHA-256 Fingerprint</dt><dd className="cert-fingerprint"><code>{cert.sha256}</code><CopyButton label="SHA-256 Fingerprint" value={cert.sha256}/></dd></div>
   </dl>
   <div className="row cert-actions">
    <a className="button" href="/api/settings/certificate/download" download>ดาวน์โหลด Certificate (.cer)</a>
    <button type="button" className="button secondary" onClick={()=>setGuide(true)}>วิธีติดตั้ง Certificate บน Windows</button>
   </div>
  </>}
  {guide&&<Dialog title="วิธีติดตั้ง Certificate บน Windows" onClose={()=>setGuide(false)}>
   <div className="cert-guide">
    <p><strong>ใบรับรองนี้เป็น Self-signed Certificate</strong> ไม่ได้ออกโดยหน่วยงานรับรองสากล การติดตั้งคือการ<strong>เพิ่มความเชื่อถือในระบบ Windows</strong> ของเครื่องนั้น ติดตั้งเฉพาะเครื่องที่ได้รับอนุญาตเท่านั้น ระบบนี้ไม่ติดตั้งให้อัตโนมัติ</p>
    <ol>
     <li>ดาวน์โหลดไฟล์ <code>nipt-cbh-certificate.cer</code> จากปุ่ม &quot;ดาวน์โหลด Certificate (.cer)&quot; แล้วคัดลอกไปยังเครื่องที่ต้องการติดตั้ง</li>
     <li>ตรวจสอบ SHA-256 Fingerprint ของไฟล์เทียบกับค่าที่ผู้ดูแลระบบยืนยันผ่านช่องทางที่เชื่อถือได้ (ค่าในหน้านี้: <code>{cert?.sha256??'ดูจากหน้าตั้งค่า'}</code>) ตรวจด้วย PowerShell: <code>Get-FileHash .\nipt-cbh-certificate.cer -Algorithm SHA256</code> ต้องได้ตัวอักษรเดียวกัน (ไม่นับเครื่องหมาย :) หากไม่ตรงห้ามติดตั้ง</li>
     <li>เปิด Windows Certificate Manager ด้วยสิทธิ์ Administrator: กด Start พิมพ์ <code>certlm.msc</code> แล้วคลิกขวาเลือก Run as administrator</li>
     <li>คลิกขวาที่ <strong>Trusted Root Certification Authorities → Certificates</strong> เลือก All Tasks → Import… เลือกไฟล์ .cer และยืนยันคำเตือนของ Windows ให้ที่เก็บเป็น Trusted Root Certification Authorities เท่านั้น</li>
     <li>ปิด Chrome ทุกหน้าต่าง แล้วเปิดใหม่</li>
     <li>เข้า <code>https://{cert?.hostname??'nipt-cbh'}/login</code></li>
     <li>ตรวจว่า HTTPS ไม่มีคำเตือนความปลอดภัย แล้วทดลอง Login</li>
    </ol>
    <p className="muted">หากมีการออกใบรับรองใหม่ภายหลัง ต้องดาวน์โหลดและติดตั้งไฟล์ใหม่อีกครั้ง การถอนความเชื่อถือทำได้ที่ certlm.msc → Trusted Root Certification Authorities → Certificates</p>
   </div>
  </Dialog>}
 </section>;
}
