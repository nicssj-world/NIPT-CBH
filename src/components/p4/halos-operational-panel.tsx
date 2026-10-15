"use client";
import {useState} from 'react';
import {csrf} from '../p2/shared';
import {labApi,failureText} from './lab-api';
import {BARCODE_ORDER} from '../../../packages/halos-export/barcodes';
type Member={slot:number;kind:string;attemptId?:string|null;printedSampleId?:string|null;printedControlId?:string|null;lnHalos?:string|null};
export function HalosOperationalPanel({batchId,version,snapshotId,members,exports,canWrite,canVerify,onDone}:{batchId:string;version:number;snapshotId:string;members:Member[];exports:Record<string,unknown>[];canWrite:boolean;canVerify:boolean;onDone:()=>Promise<void>}){
 const [mapping,setMapping]=useState<Record<number,number>>({}),[date,setDate]=useState(''),[reference,setReference]=useState(''),[barcodeType,setBarcodeType]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const api=`/api/p4b/batches/${batchId}`;
 async function generate(){setBusy(true);setError('');try{
  const rows=members.map(m=>({memberKey:m.attemptId??`${m.kind}:${m.slot}`,physicalPosition:m.slot,role:m.kind,printedSampleId:m.printedSampleId??m.printedControlId,exportSampleId:m.printedSampleId??m.printedControlId,lnHalos:m.lnHalos??m.printedControlId,barcodeIndex:mapping[m.slot],barcodeType}));
  const r=await fetch(api,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify({action:'exportHalos',poolSnapshotId:snapshotId,expectedVersion:version,dnbDate:date,mappingReference:reference,members:rows})});
  if(!r.ok){const d=await r.json();throw Error(d.error??'ออกไฟล์ไม่สำเร็จ');}
  const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='HALOS-Task-Import.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);await onDone();
 }catch(e){setError(failureText(e));}finally{setBusy(false);}}
 async function verify(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');try{const f=new FormData(e.currentTarget),file=f.get('observed');if(!(file instanceof File)||file.size>100000)throw Error('กรุณาเลือกไฟล์หลักฐาน Readback');const observedRows=JSON.parse(await file.text());await labApi(api,{action:'verifyHalos',expectedVersion:version,exportId:f.get('exportId'),fileHash:f.get('fileHash'),observedDnbId:f.get('dnbId'),observedRows,evidenceReference:f.get('evidenceReference'),evidenceHash:f.get('evidenceHash')});await onDone();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 return <section><h2>HALOS Task Import จาก Accepted Pool</h2>{members.length!==47?<p role="alert">Pool นี้มี {members.length} สมาชิก ต้องมีข้อกำหนด Partial Batch ที่ยืนยันแล้วก่อนออกไฟล์ ไม่มีการเติมตัวอย่างให้ครบแถว</p>:canWrite&&<>
  <label>วันที่เตรียม DNB ที่ตั้งใจใช้<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>หลักฐานการยืนยัน Barcode Mapping<input value={reference} onChange={e=>setReference(e.target.value)} minLength={8}/></label>
  <label>ชนิด Barcode ตามน้ำยาที่ใช้งาน<input value={barcodeType} onChange={e=>setBarcodeType(e.target.value)}/></label>
  <div className="table-wrap" role="region" aria-label="จับคู่ Barcode HALOS" tabIndex={0}><table><thead><tr><th>ตำแหน่ง</th><th>Sample / Control ID</th><th>Barcode HALOS</th></tr></thead><tbody>{members.map(m=><tr key={m.slot}><td>{m.slot}</td><td>{m.printedSampleId??m.printedControlId}</td><td><select aria-label={`Barcode ตำแหน่ง ${m.slot}`} value={mapping[m.slot]??''} onChange={e=>setMapping({...mapping,[m.slot]:Number(e.target.value)})}><option value="">เลือกจากหลักฐาน</option>{BARCODE_ORDER.map(n=><option key={n} value={n}>{n}</option>)}</select></td></tr>)}</tbody></table></div>
  <button className="button" disabled={busy||!date||!barcodeType.trim()||reference.trim().length<8||members.some(m=>!mapping[m.slot])} onClick={()=>void generate()}>ตรวจ Readback และดาวน์โหลด XLSX</button></>}
  <ul>{exports.map(e=><li key={String(e.id)}><a href={`/api/halos/exports/${e.id}`}>ฉบับ {String(e.revision)} · DNB {String(e.dnb_date).slice(0,10)}</a> · {e.verified?'ตรวจการนำเข้าแล้ว':'รอตรวจการนำเข้า'}</li>)}</ul>
  {canVerify&&exports.length>0&&<form onSubmit={verify}><h3>ตรวจหลักฐานการนำเข้า HALOS</h3><label>ฉบับไฟล์<select name="exportId">{exports.map(e=><option key={String(e.id)} value={String(e.id)}>{String(e.id)}</option>)}</select></label><label>SHA-256 ของไฟล์ที่นำเข้า<input name="fileHash" required pattern="[a-f0-9]{64}"/></label><label>DNB ID ที่เห็นใน HALOS<input name="dnbId" required/></label><label>ไฟล์ Readback ที่ตรวจจริง<input name="observed" type="file" accept="application/json,.json" required/></label><label>ที่เก็บหลักฐาน<input name="evidenceReference" required minLength={8}/></label><label>SHA-256 หลักฐาน<input name="evidenceHash" required pattern="[a-f0-9]{64}"/></label><button className="button" disabled={busy}>ยืนยันข้อมูลที่ตรวจพบจริง</button></form>}{error&&<p role="alert">{error}</p>}
 </section>;
}
