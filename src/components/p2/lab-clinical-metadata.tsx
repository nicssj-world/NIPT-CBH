'use client';
import {useState} from 'react';
import {api,Dialog,ErrorNotice,Field,message,type CaseData} from './shared';
import {ThaiDateInput} from '../shared/thai-date-input';
import {registryGa} from '../../../packages/lab/registry-ga';
export function LabClinicalMetadata({data,onClose,onSaved}:{data:CaseData;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [edd,setEdd]=useState(data.workspace.draft.pregnancy.edd??''),[pregnancy,setPregnancy]=useState(data.workspace.draft.pregnancy.type),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const ga=registryGa(edd,data.roundReceipt.collectionDate),dirty=edd!==(data.workspace.draft.pregnancy.edd??'')||pregnancy!==data.workspace.draft.pregnancy.type;
 return <Dialog title="ข้อมูลทางคลินิกภายหลัง" onClose={onClose} dirty={dirty}><form className="stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api(`/api/p2/cases/${data.case.id}`,{action:'saveLabClinicalMetadata',expectedVersion:data.workspace.version,edd:edd||null,pregnancy});await onSaved();onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}}>
  <p>บันทึกข้อมูลจากใบขอส่งตรวจของตัวอย่างรอบนี้ ผลทบทวนทางคลินิกและเอกสารต้นฉบับยังใช้กฎเดิม</p>
  <Field label="วันกำหนดคลอด EDD / EDC">{id=><ThaiDateInput id={id} value={edd} onChange={setEdd} disabled={busy}/>}</Field>
  <p className="help" role="status">GA จากวันเก็บตัวอย่างใน HIS และ EDD: {ga?`${ga.weeks} สัปดาห์ ${ga.days} วัน`:'ยังคำนวณไม่ได้จากข้อมูลที่มี'}</p>
  <fieldset role="radiogroup" className="stack"><legend>ประเภทครรภ์</legend>{([['Singleton','ครรภ์เดี่ยว (Singleton)'],['Twins','ครรภ์แฝด (Twins)'],['Unknown','ยังไม่ทราบ']] as const).map(([value,label])=><label className="check-label" key={value}><input type="radio" name="lab-pregnancy" value={value} checked={pregnancy===value} disabled={busy} onChange={()=>setPregnancy(value)}/>{label}</label>)}</fieldset>
  <ErrorNotice error={error}/><button className="button" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึก'}</button>
 </form></Dialog>;
}
