'use client';
import {useState} from 'react';
import {FileDropInput} from '../shared/file-drop-input';
import {csrf} from '../p2/shared';
export function ReplaceHistoricalPdf({draftId,version,onDone}:{draftId:string;version:number;onDone:()=>Promise<void>}){
 const [file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <details><summary>เพิ่ม / เปลี่ยน Final PDF</summary><FileDropInput accept=".pdf" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setError('');}}/>{error&&<p role="alert" className="form-error">{error}</p>}<button type="button" className="button secondary small" disabled={!file||busy} onClick={async()=>{if(!file)return;setBusy(true);try{const form=new FormData();form.set('file',file);form.set('version',String(version));const r=await fetch(`/api/p5h/rows/${draftId}/pdf`,{method:'POST',headers:{'x-csrf-token':csrf()},body:form});if(!r.ok){const d=await r.json();throw Error(d.error??d.code??'เปลี่ยน PDF ไม่สำเร็จ');}setFile(null);await onDone();}catch(e){setError(e instanceof Error?e.message:'เปลี่ยน PDF ไม่สำเร็จ');}finally{setBusy(false);}}}>บันทึก PDF และตรวจสอบใหม่</button></details>;
}
