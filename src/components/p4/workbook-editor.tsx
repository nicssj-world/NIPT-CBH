'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {csrf} from '../p2/shared';
import {labApi} from './lab-api';
import type {workbookWorkspace} from '../../../packages/workbook/service';
import type {Binding} from '../../../packages/workbook/master';
import {poolDilutionReady,POOL_DILUTION_NOTICE} from '../../../packages/workbook/dilution';
type Data=Awaited<ReturnType<typeof workbookWorkspace>>;
const label=(field:Binding,text:string)=>field.dataType==='checkbox'?text.replace('☐','').trim():field.key.endsWith('.date')?'วันที่ปฏิบัติงาน':field.key.endsWith('.operator')?'ผู้ปฏิบัติงาน':field.key.endsWith('.run')?'หมายเลข Run':field.key.endsWith('.printedSampleId')?'รหัสตัวอย่าง / Control':field.key.endsWith('.extractionLotExp')?'Extraction LOT / EXP':field.key.endsWith('.libraryLotExp')?'Library LOT / EXP':field.key.endsWith('.libraryQc')?'ความเข้มข้น Library (ng/µL)':field.key.endsWith('.extractionQc')?'ความเข้มข้น Extraction (ng/µL)':field.key.endsWith('.transferChecked')?'ยืนยันรหัสบนหลอดตรงใบงาน':field.key.includes('standard1')?'ค่าที่วัด Standard 1':field.key.includes('standard2Concentration')?'ความเข้มข้น Standard 2':field.key.includes('standard2')?'ค่าที่วัด Standard 2':field.key==='pool.instrumentCsvFileStem'?'ชื่อไฟล์เครื่อง (ไม่รวม .CSV)':field.key==='pool.dilutionC1'?'ความเข้มข้นก่อนเจือจาง (ng/µL)':field.key==='seq.dnbId'?'DNB ID':field.key==='seq.instrument'?'หมายเลขเครื่อง Sequencer':field.key==='seq.barcodeType'?'ชนิด Barcode':field.key==='seq.negativePressureKpa'?'Negative Pressure (kPa)':field.key==='seq.driveMemoryTb'?'พื้นที่ Drive (TB)':text||field.source;
export function WorkbookEditor({batchId,canWrite}:{batchId:string;canWrite:boolean}) {
  const [data,setData]=useState<Data|null>(null),[values,setValues]=useState<Record<string,unknown>>({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<string|null>(null),[sheet,setSheet]=useState('Ext. & Prep. Task List 1');
  const api=`/api/workbook/batches/${batchId}`;
  async function reload(){const next=await labApi<Data>(api);setData(next);setValues(next.values);}
  useEffect(()=>{let active=true;labApi<Data>(api).then(next=>{if(active){setData(next);setValues(next.values);}}).catch(e=>{if(active)setMessage(String(e));});return()=>{active=false;};},[api]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function save(){if(!data)return;setBusy(true);try{await labApi(api,{action:'saveDraft',expectedVersion:data.version,expectedRevision:data.draft?.revision??0,values});await reload();setMessage('บันทึก Draft แล้ว สามารถกลับมาเปิดต่อได้');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function output(format:'XLSX'|'PDF',view=false){if(!data?.draft)return;setBusy(true);try{
    const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf()},body:JSON.stringify({action:'export',revision:data.draft.revision,format,...(format==='PDF'?{sheet}:{})})});
    if(!response.ok){const error=await response.json();throw new Error(`${error.error} (${error.code})`);}
    const url=URL.createObjectURL(await response.blob());
    if(view)setPreview(url);else{const a=document.createElement('a');a.href=url;a.download=`Task-${data.draft.revision}.${format==='PDF'?'pdf':'xlsx'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    await reload();setMessage(Number(response.headers.get('X-Task-Formula-Errors'))>0?'ออกเอกสารและบันทึกประวัติแล้ว — พบข้อผิดพลาดสูตรใน Master โปรดตรวจผลคำนวณก่อนใช้งาน':'ออกเอกสารและบันทึกประวัติแล้ว');
  }catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="panel"><p><Link href={`/lab/batches/${batchId}`}>กลับ Batch / Task List</Link></p><h1>แบบฟอร์ม Excel ต้นฉบับ</h1>
    {message&&<p role="status">{message}</p>}
    {data&&<>
      <p>Draft ฉบับ {data.draft?.revision??0} · สูตร Excel {data.matrix.formulaCount} สูตร</p>
      {!poolDilutionReady(values)&&<p role="alert" id="pool-dilution-notice">{POOL_DILUTION_NOTICE}</p>}
      {data.sourceStale&&<p role="alert">ข้อมูล Lab หรือ Excel Master เปลี่ยนหลังบันทึก Draft กรุณาตรวจค่าและบันทึกฉบับใหม่ก่อนออกเอกสาร</p>}
      <p>รหัสตัวอย่างและค่าที่มีบันทึกใน Lab อ่านจากข้อมูลต้นทาง ช่องอื่นบันทึกเป็น Draft ของใบงาน</p>
      {[...new Set(data.matrix.bindings.map(f=>f.sheet))].map(name=><details key={name}><summary>{name}</summary><div className="form-grid">{data.matrix.bindings.filter(f=>f.sheet===name).map(field=>{
        const value=values[field.key],automatic=field.key in data.automaticValues||/^slot\.\d+\.printedSampleId$/.test(field.key)||/^task\.\d+\.run$/.test(field.key);
        const cell=data.matrix.cells.find(c=>c.sheet===name&&c.cell===field.cell);
        return <label key={field.key}>{label(field,cell?.text??'')} <span className="muted">({field.cell}){automatic?' · จากข้อมูล Lab':''}</span>
          {field.dataType==='checkbox'?<input type="checkbox" checked={value===true} disabled={!canWrite||busy||automatic} onChange={e=>setValues(v=>({...v,[field.key]:e.target.checked}))}/>:<input type={field.dataType==='number'?'number':'text'} step={field.dataType==='number'?'any':undefined} value={value===null||value===undefined?'':String(value)} disabled={!canWrite||busy||automatic} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value===''?null:field.dataType==='number'?Number(e.target.value):e.target.value}))}/>}
        </label>;
      })}</div></details>)}
      {canWrite&&<div className="actions"><button className="button" disabled={busy} onClick={()=>void save()}>บันทึก Draft / ผูกข้อมูลล่าสุด</button><button className="button secondary" disabled={busy||!data.draft||data.sourceStale} onClick={()=>void output('XLSX')}>Export XLSX</button><label>ชีต PDF<select value={sheet} onChange={e=>setSheet(e.target.value)}>{[...new Set(data.matrix.bindings.map(f=>f.sheet))].map(name=><option key={name}>{name}</option>)}</select></label><button className="button secondary" disabled={busy||!data.draft||data.sourceStale} onClick={()=>void output('PDF',true)}>ออกเอกสาร / ดู PDF</button></div>}
      <h2>ประวัติเอกสาร</h2><ul>{data.exports.map((entry)=>{const item=entry as {id:string;format:string;sheet:string|null;revision:number};return <li key={item.id}><a href={`/api/workbook/exports/${item.id}`}>ฉบับ {item.revision} · {item.format}{item.sheet?` · ${item.sheet}`:''}</a></li>;})}</ul>
    </>}
    {preview&&<div className="p5-original"><button className="button secondary" onClick={()=>setPreview(null)}>ปิด PDF</button><iframe title="PDF จาก Excel ต้นฉบับ" src={preview} className="pdf-frame"/></div>}
  </section>;
}
