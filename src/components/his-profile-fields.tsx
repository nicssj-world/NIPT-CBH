"use client";
const PROFILE_FIELDS=[['version','รุ่นรูปแบบ'],['sender','รหัสผู้ส่ง'],['receiver','รหัสผู้รับ'],['testCode','รหัสการทดสอบ'],['specimenCode','รหัสสิ่งส่งตรวจ'],['o18','รหัสแผนก'],['accessionSuffix','ส่วนต่อท้าย Accession'],['wardId','รหัสหน่วยงาน'],['wardName','ชื่อหน่วยงาน'],['resultFlag','รหัสสถานะผล'],['cfsText','ข้อความอ้างอิง CFS'],['pdfTemplate','รูปแบบชื่อ PDF']] as const;
export function HisProfileFields({value,editable,onChange}:{value:unknown;editable:boolean;onChange:(v:unknown)=>void}){
 const data=(value??{}) as Record<string,unknown>;
 return <fieldset><legend>รูปแบบไฟล์ RES ตามข้อกำหนด HIS</legend><label className="check-label"><input type="checkbox" disabled={!editable} checked={value!==null&&value!==undefined} onChange={e=>onChange(e.target.checked?{syntheticOnly:false,style:'full',maxResultCodeUnits:0,...Object.fromEntries(PROFILE_FIELDS.map(([k])=>[k,'']))}:null)}/> กำหนดรูปแบบสำหรับส่งผลที่รับรองแล้ว</label>{value!==null&&value!==undefined&&<>
  {PROFILE_FIELDS.map(([key,label])=><div className="field" key={key}><label htmlFor={'res-'+key}>{label}</label><input id={'res-'+key} value={String(data[key]??'')} readOnly={!editable} onChange={e=>onChange({...data,[key]:e.target.value})} required/></div>)}
  <div className="field"><label htmlFor="res-max">จำนวนอักขระ UTF-16 สูงสุดของข้อความผล</label><input id="res-max" type="number" min={1} max={16384} value={Number(data.maxResultCodeUnits)||''} readOnly={!editable} onChange={e=>onChange({...data,maxResultCodeUnits:Number(e.target.value)})} required/></div></>}
 </fieldset>;
}
export function HisCertifierFields({value,users,editable,onChange}:{value:unknown;users:{id:string;display_name:string}[];editable:boolean;onChange:(v:unknown)=>void}){
 const data=(value??{}) as Record<string,string>;
 return <fieldset><legend>รหัสผู้รับรองผลใน HIS</legend>{users.map(user=>{const [code='',name='']=(data[user.id]??'').split('^');const set=(nextCode:string,nextName:string)=>{const next={...data};if(!nextCode&&!nextName)delete next[user.id];else next[user.id]=nextCode+'^'+nextName;onChange(next);};return <div className="field" key={user.id}><strong>{user.display_name}</strong><label htmlFor={'his-code-'+user.id}>รหัส HIS</label><input id={'his-code-'+user.id} value={code} readOnly={!editable} onChange={e=>set(e.target.value,name)}/><label htmlFor={'his-name-'+user.id}>ชื่อผู้รับรองที่ส่งเข้า HIS</label><input id={'his-name-'+user.id} value={name} readOnly={!editable} onChange={e=>set(code,e.target.value)}/></div>;})}{!users.length&&<p>ยังไม่มีผู้รับรองที่ได้รับสิทธิ์</p>}</fieldset>;
}
