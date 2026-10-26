'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {Dialog} from '../p2/shared';
import {PdfPreview} from '../shared/pdf-preview';
import {csrf} from '../p2/shared';
import {labApi,failureText} from './lab-api';
import type {benchWorkspace,benchPooling} from '../../../packages/lab/bench';
import {LabIcon,type LabIconName} from '../shared/lab-icons';
import {SampleActionCenter,type ActionCenterSubject} from './action-center';
import './lab-bench.css';
type Data=Awaited<ReturnType<typeof benchWorkspace>>;
type Pool=Awaited<ReturnType<typeof benchPooling>>;
type Slot=Data['slots'][number];
type Transfer={slot:number;pooled:boolean;actualVolume?:number;reason?:string};
type SeqFiles={id:string;revision:number;files:{id:string;kind:string;filename:string;sha256:string}[]};
type Stage='QC'|'POOL'|'SEQ';
const STAGE_PATH:Record<Stage,string>={QC:'bench',POOL:'pooling',SEQ:'sequencing'};
const STEPS:{key:Stage;label:string;icon:LabIconName}[]=[{key:'QC',label:'QC Measurements',icon:'flask'},{key:'POOL',label:'Pooling',icon:'layers'},{key:'SEQ',label:'Sequencing',icon:'dna'}];
/** OWNER-LAB-049: Seq Task-G50 groups exactly as the Owner Excel Master (rows 4, 15–23, 34–37, 39–42). The on-bench
 *  "Confirm (√)" cells (B26, F28–F31) stay blank on the printed worksheet for handwriting and are not entered here. */
const SEQ_GROUPS:{title:string;icon:LabIconName;fields:{key:string;label:string;hint?:string;type:'text'|'number'|'signed'}[]}[]=[
 {title:'ข้อมูลการปฏิบัติงาน',icon:'clipboard',fields:[{key:'seq.date',label:'วันที่ปฏิบัติงาน',hint:'วว/ดด/ปปปป (พ.ศ.)',type:'text'},{key:'seq.operator',label:'ผู้ปฏิบัติงาน',type:'text'},{key:'seq.instrument',label:'DNBSEQ-G50 no.',type:'number'},{key:'seq.barcodeType',label:'Barcode type',type:'number'}]},
 {title:'QC3 measurements',icon:'flask',fields:[{key:'seq.standard1',label:'Standard 1',type:'number'},{key:'seq.standard2',label:'Standard 2',type:'number'},{key:'seq.standard2Concentration',label:'Standard 2 Conc. (ng/µL)',hint:'ref. 19.9 ng/µL',type:'number'},{key:'seq.dnbConcentration',label:'DNB concentration (ng/µL)',hint:'Ref. 8–40 ng/µL',type:'number'},{key:'seq.dilutedConcentration',label:'กรณี dilute conc. (ng/µL)',type:'number'}]},
 {title:'Sequencing',icon:'cpu',fields:[{key:'seq.dnbId',label:'DNB ID',hint:'DNBYYYYMMDD',type:'text'},{key:'seq.driveMemoryTb',label:'Hard Drive Memory (TB)',hint:'ควรมากกว่า 500 GB',type:'number'},{key:'seq.negativePressureKpa',label:'Negative Pressure (kPa)',type:'signed'}]},
 {title:'First Cycle',icon:'activity',fields:[{key:'seq.loadedDnb',label:'Loaded DNB',type:'number'},{key:'seq.q30',label:'Q30%',type:'number'},{key:'seq.bic',label:'BIC',type:'number'},{key:'seq.fit',label:'Fit',type:'number'}]},
];
const QC_STANDARDS=[['standard1','Standard 1'],['standard2','Standard 2'],['standard2Concentration','Standard 2 Conc.']] as const;
/** OWNER-LAB-042 reference criteria: patient, PC and NC ≥ 2.0 ng/µL; Blank ≤ 0.6 ng/µL. Display only — never an action. */
function qcCriterion(kind:string,value:unknown){
 if(typeof value!=='number'||kind==='EMPTY')return null;
 if(kind==='BLANK')return value<=0.6?'pass':'high';
 return value>=2?'pass':'low';
}
const KIND_CLASS:Record<string,string>={PC:'row-pc',NC:'row-nc',BLANK:'row-blank'};
const kindLabel=(kind:string)=>kind==='PC'?'Positive control':kind==='NC'?'Negative control':kind==='BLANK'?'Blank':'';
const num=(v:unknown)=>typeof v==='number'?v:null;

/** Text input with decimal keyboard: no spinner and no wheel change (LEGACY-019); keeps partial input like "2." while typing. */
function NumberField({id,label,value,onChange,disabled,signed,invalid,describedBy}:{id?:string;label:string;value:unknown;onChange:(v:number|null)=>void;disabled?:boolean;signed?:boolean;invalid?:boolean;describedBy?:string}){
 const [text,setText]=useState(typeof value==='number'?String(value):'');
 // Follow an externally changed value without an effect: adjust state during render when the prop changed (React's recommended pattern).
 const [seen,setSeen]=useState(value);
 if(seen!==value){setSeen(value);setText(t=>Number(t)===value&&t.trim()!==''?t:typeof value==='number'?String(value):'');}
 const pattern=signed?/^-?\d*(\.\d*)?$/:/^\d*(\.\d*)?$/;
 return <input id={id} aria-label={label} aria-invalid={invalid||undefined} aria-describedby={describedBy} className={invalid?'bench-input-alert':undefined} type="text" inputMode="decimal" autoComplete="off" disabled={disabled} value={text}
  onChange={e=>{const v=e.target.value.trim();if(!pattern.test(v))return;setText(v);if(v===''){onChange(null);return;}if(/^-?\d+(\.\d+)?$/.test(v))onChange(Number(v));}}/>;
}

export function LabBench({batchId,canWrite,initialStage="QC"}:{batchId:string;canWrite:boolean;initialStage?:Stage}){
 const api=`/api/lab-bench/batches/${batchId}`,workbookApi=`/api/workbook/batches/${batchId}`;
 const [data,setData]=useState<Data|null>(null),[values,setValues]=useState<Record<string,unknown>>({}),[tab,setTabState]=useState<Stage>(initialStage),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pool,setPool]=useState<Pool|null>(null);
 const [preview,setPreview]=useState<null|{title:string;url:string|null;retry:()=>void;error?:string}>(null);
 const [transfers,setTransfers]=useState<Transfer[]|null>(null),[seqFiles,setSeqFiles]=useState<SeqFiles|null>(null);
 const [center,setCenter]=useState<ActionCenterSubject|null>(null),[override,setOverride]=useState<{slot:number;value:string}|null>(null);
 // OWNER-LAB-047: a saved actual-pooling record from an older QC/placement source is never re-applied over the recomputed table.
 const savedMembers=data?.actualPooling?.current?data.actualPooling.members:data?.actualPooling?.members.map(({slot,pooled})=>({slot,pooled}));
 const currentTransfers:Transfer[]=transfers??savedMembers?.map(({slot,pooled,actualVolume,reason}:Transfer)=>({slot,pooled,actualVolume,reason}))??Array.from({length:48},(_,i)=>({slot:i+1,pooled:false}));
 const transfersDirty=transfers!==null;
 const setTab=(next:Stage)=>{setTabState(next);const url=new URL(window.location.href);url.pathname=`/lab/batches/${batchId}/${STAGE_PATH[next]}`;window.history.replaceState(window.history.state,'',url);};
 const updateTransfer=(slot:number,change:Partial<Transfer>)=>setTransfers(rows=>(rows??currentTransfers).map(r=>r.slot===slot?{...r,...change}:r));
 const reload=async()=>{const next=await labApi<Data>(api);setData(next);setValues(next.values);setDirty(false);return next;};
 useEffect(()=>{let active=true;labApi<Data>(api).then(d=>{if(active){setData(d);setValues(d.values);}}).catch(e=>{if(active)setError(failureText(e));});return()=>{active=false;};},[api]);
 useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
 // Pool volumes use only placements and QC source values; QC2/Seq edits do not discard the calculated table.
 const change=(key:string,value:unknown)=>{setSeqFiles(null);setValues(v=>({...v,[key]:value}));setDirty(true);setNotice('');if(/^slot\.\d+\.libraryQc$|^qc\.[123]\./.test(key))setPool(null);};
 const saved=!!data?.revision&&!dirty&&!data.sourceStale;
 async function saveDraft(){if(!data)return null;await labApi(workbookApi,{action:'saveDraft',expectedVersion:data.version,expectedRevision:data.revision,values});setSeqFiles(null);return reload();}
 async function run(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 const calculate=async()=>{setPool(await labApi<Pool>(api,{action:'pool'}));};
 // Load the saved calculation when Pooling opens on a saved, finalized source (no button press needed to see the table).
 useEffect(()=>{if(tab==='POOL'&&saved&&data?.finalized&&!pool&&!busy)void Promise.resolve().then(()=>run(calculate));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tab,saved,data?.finalized,pool]);
 const qcRows=data?.slots.filter(s=>s.kind!=='EMPTY')??[];
 const qcMissing=qcRows.filter(s=>num(values[`slot.${s.slot}.libraryQc`])===null).length+[1,2,3].flatMap(n=>QC_STANDARDS.map(([k])=>`qc.${n}.${k}`)).filter(k=>num(values[k])===null).length;
 /** OWNER-LAB-044: save QC → validate → calculate → open Pooling, only when every step succeeds. */
 const saveAndCalculate=()=>run(async()=>{
  if(qcMissing){setError(`กรอกค่า QC ให้ครบก่อนคำนวณ Pooling (ยังขาด ${qcMissing} ช่อง)`);return;}
  if(!data?.finalized){setError('พิมพ์ Task List 1–3 ก่อน เพื่อใช้รหัสตัวอย่างจริงทุกช่อง');return;}
  await saveDraft();await calculate();setTab('POOL');setNotice('บันทึก QC และคำนวณ Pooling แล้ว');
 });
 const saveDraftOnly=(message:string)=>run(async()=>{await saveDraft();setNotice(message);});
 const saveTransfers=()=>run(async()=>{
  let revision=data!.revision;
  if(dirty){const next=await saveDraft();revision=next?.revision??revision;}
  await labApi(api,{action:'recordActualPooling',revision,members:currentTransfers,note:''});await reload();setTransfers(null);setSeqFiles(null);setNotice('บันทึก Pooling จริงแล้ว');
 });
 const exportPair=()=>run(async()=>{const result=await labApi<SeqFiles>(api,{action:'exportSeqPair',revision:data!.revision,idempotencyKey:crypto.randomUUID()});if(result.files.length!==2)throw Error('สร้างไฟล์ไม่ครบสองไฟล์');setSeqFiles(result);setNotice('สร้างไฟล์ครบ 2 ไฟล์แล้ว');});
 async function fetchExport(kind:'POOL_CSV'|'QC'|'POOL'|'SEQ'){
  const isWorkbook=kind!=='POOL_CSV',sheet=kind==='QC'?'QC measurements':kind==='POOL'?'Pooling Table':'Seq Task-G50';
  const response=await fetch(isWorkbook?workbookApi:api,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(isWorkbook?{action:'export',revision:data!.revision,format:'PDF',sheet}:{action:'export',revision:data!.revision,kind})});
  if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.error??e.code??'ออกเอกสารไม่สำเร็จ');}
  return response.blob();
 }
 /** OWNER-LAB-046 / LEGACY-025: the PDF opens in the modal from the exact response bytes; failures stay in the modal with Retry. */
 function openPdf(kind:'QC'|'POOL'|'SEQ',title:string){
  const load=()=>{setPreview(p=>p&&{...p,url:null,error:undefined});fetchExport(kind).then(blob=>setPreview(p=>p?{...p,url:URL.createObjectURL(blob)}:p)).catch(e=>setPreview(p=>p?{...p,error:e instanceof Error?e.message:'ออกเอกสารไม่สำเร็จ'}:p));};
  setPreview({title,url:null,retry:load});load();
 }
 const downloadCsv=()=>run(async()=>{const url=URL.createObjectURL(await fetchExport('POOL_CSV'));const a=document.createElement('a');a.href=url;a.download=`${data!.runLabel.replace('/','-')}-POOL_CSV.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});
 const subjectOf=(row:Slot):ActionCenterSubject|null=>row.kind==='PATIENT'&&row.attemptId&&row.caseId&&row.roundId&&row.hisLn&&row.roundNumber?{attemptId:row.attemptId,caseId:row.caseId,roundId:row.roundId,hisLn:row.hisLn,hn:row.hn,roundNumber:row.roundNumber,sampleId:row.sampleId,attemptState:row.attemptState??'',overallOrdinal:row.overallOrdinal,attemptNumber:row.attemptNumber,outcomeStatus:row.outcomeStatus}:null;
 const sampleCell=(row:Slot)=>{const subject=subjectOf(row);
  return <>{subject?<button type="button" className={`bench-sample-button mono${row.exceptional?' bench-exceptional':''}`} onClick={()=>setCenter(subject)} aria-haspopup="dialog">{row.sampleId}</button>
   :<strong className="mono">{row.sampleId||'ว่าง'}</strong>}
   {row.kind==='PATIENT'?<small>LN {row.hisLn} · HN {row.hn??'—'} · รอบที่ {row.roundNumber}</small>:row.kind!=='EMPTY'&&<small>{kindLabel(row.kind)}</small>}
   {row.outcomeStatus&&<small className="bench-status-text">{row.outcomeStatus}</small>}</>;};
 const steps=useMemo(()=>{
  const qcDone=!!data?.revision&&!dirty&&qcMissing===0,poolDone=!!data?.actualPooling?.current,seqDone=poolDone&&!!data?.exports.some(e=>e.kind==='HALOS_TASK_XLSX');
  return {QC:qcDone,POOL:poolDone,SEQ:seqDone} as Record<Stage,boolean>;
 },[data,dirty,qcMissing]);
 const status=busy?'กำลังบันทึก…':dirty||transfersDirty?'มีค่าที่ยังไม่บันทึก':data?.sourceStale?'ข้อมูลต้นทางเปลี่ยน — บันทึกเพื่อผูกข้อมูลล่าสุด':data?.revision?`บันทึกแล้ว · ฉบับ ${data.revision}`:'ยังไม่บันทึก';
 const pooledCount=currentTransfers.filter(t=>t.pooled).length;
 const poolable=(row:{slot:number;sampleId:string})=>{const k=data?.slots.find(s=>s.slot===row.slot)?.kind;return !!row.sampleId&&(k==='PATIENT'||k==='PC'||k==='NC');};
 const poolConc=num(values['pool.concentration']),poolOut=poolConc!==null&&(poolConc<3||poolConc>3.6);

 return <section className="panel lab-bench" data-enter-navigation>
  <nav className="bench-breadcrumb" aria-label="เส้นทางใบงาน"><Link href="/lab/batches">Batch / Task List</Link><span aria-hidden="true">/</span><Link href={`/lab/batches/${batchId}`}>{data?.runLabel??'Run'}</Link></nav>
  <header className="bench-header"><h1>{data?.runLabel??'ใบงาน Lab'}</h1>
   <Link className="button secondary bench-workbook-link" href={`/lab/batches/${batchId}/workbook`}><LabIcon name="file"/>ใบงาน Excel / PDF</Link></header>
  {/* OWNER-LAB-041: icon-led three-step navigation with active and completed states (vertical on mobile). */}
  <ol className="bench-steps" aria-label="ขั้นตอนใบงาน">{STEPS.map((s,i)=><li key={s.key}>
   <button type="button" className={`bench-step${tab===s.key?' active':''}${steps[s.key]?' done':''}`} aria-current={tab===s.key?'step':undefined} onClick={()=>setTab(s.key)}>
    <span className="bench-step-icon">{steps[s.key]&&tab!==s.key?<LabIcon name="check"/>:<LabIcon name={s.icon}/>}</span>
    <span className="bench-step-text"><small>ขั้นที่ {i+1}</small><strong>{s.label}</strong><small>{steps[s.key]?'บันทึกครบแล้ว':tab===s.key?'กำลังทำ':'ยังไม่เสร็จ'}</small></span>
   </button></li>)}</ol>
  {error&&<p role="alert" className="notice danger">{error}</p>}{notice&&!error&&<p role="status" className="notice success">{notice}</p>}
  {!data&&!error&&<p role="status">กำลังโหลดใบงาน…</p>}
  {data&&tab==='QC'&&<section aria-labelledby="qc-title" className="bench-section">
   <div className="bench-section-head"><h2 id="qc-title"><LabIcon name="flask"/>QC Measurements</h2>
    <button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>openPdf('QC','QC measurements')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์ QC</button></div>
   <div className="bench-criteria" role="note"><p>ตัวอย่าง, Positive control และ Negative control ควรมีความเข้มข้น ≥ 2.0 ng/µL หากไม่เป็นไปตามเกณฑ์ให้เริ่มสกัดใหม่อีกครั้ง</p><p>Blank control ควรมีความเข้มข้น ≤ 0.6 ng/µL</p></div>
   <div className="lab-bench-standards">{[1,2,3].map(strip=><fieldset key={strip}><legend>Strip {strip}/3</legend>{QC_STANDARDS.map(([key,label])=><label key={key}><span>{label}</span><NumberField label={`Strip ${strip}/3 ${label}`} value={values[`qc.${strip}.${key}`]} disabled={!canWrite||busy} onChange={v=>change(`qc.${strip}.${key}`,v)}/></label>)}</fieldset>)}</div>
   <div className="table-wrap" role="region" aria-label="QC 48 ตำแหน่ง" tabIndex={0}><table className="bench-table qc-table"><colgroup><col className="col-slot"/><col/><col className="col-value"/><col className="col-flag"/></colgroup>
    <thead><tr><th scope="col">ตำแหน่ง</th><th scope="col">Sample ID</th><th scope="col">Concentration (ng/µL)</th><th scope="col">เกณฑ์</th></tr></thead>
    <tbody>{data.slots.map(row=>{const key=`slot.${row.slot}.libraryQc`,flag=qcCriterion(row.kind,values[key]);
     return <tr key={row.slot} className={KIND_CLASS[row.kind]??(row.kind==='EMPTY'?'row-empty':undefined)}><th scope="row">{row.slot}</th><td>{sampleCell(row)}</td>
      <td>{row.kind==='EMPTY'?<span className="muted">—</span>:<NumberField label={`ตำแหน่ง ${row.slot} Concentration ng/µL`} value={values[key]} invalid={flag==='low'||flag==='high'} disabled={!canWrite||busy||data.automaticKeys.includes(key)} onChange={v=>change(key,v)}/>}</td>
      <td>{flag==='pass'?<span className="status good">ผ่านเกณฑ์</span>:flag==='low'?<span className="status bad">ต่ำกว่า 2.0</span>:flag==='high'?<span className="status bad">สูงกว่า 0.6</span>:null}</td></tr>;})}</tbody></table></div>
  </section>}
  {data&&tab==='POOL'&&<section aria-labelledby="pool-title" className="bench-section">
   <div className="bench-section-head"><h2 id="pool-title"><LabIcon name="layers"/>Pooling Table</h2>
    <div className="bench-actions"><button className="button secondary" type="button" disabled={busy||!saved||!pool} onClick={()=>openPdf('POOL','Pooling Table')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์ Pooling Table</button><button className="button secondary" type="button" disabled={busy||!saved||!pool} onClick={()=>void downloadCsv()}><LabIcon name="download"/>ส่งออก Pooling CSV</button></div></div>
   {!saved&&<p className="notice" role="note">บันทึกค่า QC ก่อน แล้วระบบจะคำนวณ Pooling จากค่าที่บันทึก</p>}
   {data.actualPooling&&!data.actualPooling.current&&<p role="alert" className="notice warning-notice">ค่า QC หรือตำแหน่งเปลี่ยน — คำนวณใหม่แล้ว กรุณาตรวจและบันทึก Pooling จริงอีกครั้ง</p>}
   {pool&&<>
    <div className="bench-totals" aria-label="ปริมาตรรวม"><div><span>Total</span><strong>{Number(pool.calculation.total).toFixed(2)}<small>µL</small></strong></div><div><span>EB</span><strong>{Number(pool.calculation.buffer).toFixed(2)}<small>µL</small></strong></div></div>
    <div className="bench-pool-toolbar"><span>Pooling จริง {pooledCount} ตำแหน่ง</span>{canWrite&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>setTransfers((transfers??currentTransfers).map(t=>{const r=pool.calculation.rows.find(x=>x.slot===t.slot);return r&&poolable(r)?{...t,pooled:true}:t;}))}><LabIcon name="check"/>เลือกตัวอย่างที่ใช้ได้ทั้งหมด</button>}</div>
    <div className="table-wrap" role="region" aria-label="ปริมาตร Pooling" tabIndex={0}><table className="bench-table pool-table"><colgroup><col className="col-slot"/><col/><col className="col-value"/><col className="col-check"/><col className="col-edit"/></colgroup>
     <thead><tr><th scope="col">ตำแหน่ง</th><th scope="col">Sample ID</th><th scope="col">Volume (µL)</th><th scope="col">Pooling</th><th scope="col"><span className="sr-only">แก้ปริมาตร</span></th></tr></thead>
     <tbody>{pool.calculation.rows.map(row=>{const slot=data.slots.find(s=>s.slot===row.slot)!,transfer=currentTransfers.find(t=>t.slot===row.slot),modified=transfer?.actualVolume!==undefined&&transfer.actualVolume!==Number(row.volume);
      const shown=transfer?.actualVolume??(row.volume===null?null:Number(row.volume)),low=shown!==null&&shown<2;
      return <tr key={row.slot} className={KIND_CLASS[slot?.kind??'']??(slot?.kind==='EMPTY'?'row-empty':undefined)}><th scope="row">{row.slot}</th><td>{slot?sampleCell(slot):row.sampleId}</td>
       <td className={`bench-volume${low?' bench-volume-low':''}${modified?' bench-volume-override':''}`}>{shown===null?'—':shown.toFixed(2)}{modified&&<small>แก้จาก {row.volume===null?'—':Number(row.volume).toFixed(2)}</small>}</td>
       <td><input type="checkbox" aria-label={`Pooling จริง ตำแหน่ง ${row.slot}`} disabled={!canWrite||busy||!row.sampleId} checked={transfer?.pooled??false} onChange={e=>updateTransfer(row.slot,{pooled:e.target.checked})}/></td>
       <td>{row.sampleId&&canWrite&&<button type="button" className="button secondary small bench-icon-button" disabled={busy} aria-label={`แก้ปริมาตรตำแหน่ง ${row.slot}`} onClick={()=>setOverride({slot:row.slot,value:String(transfer?.actualVolume??row.volume??'')})}><LabIcon name="pencil" size={18}/></button>}</td></tr>;})}</tbody></table></div>
   </>}
   <h3 className="bench-subhead">QC2 หลัง Pooling</h3>
   <div className="lab-bench-qc2">{[['pool.standard1','Ref.Std dsDNA Standard 1'],['pool.standard2','Ref.Std dsDNA Standard 2'],['pool.standard2Concentration','Standard 2 Conc.'],['pool.concentration','Pool Library concentration (ng/µL)']].map(([key,label])=><label key={key} className="lab-bench-qc2-field"><span>{label}</span>
    <NumberField label={label} value={values[key]} invalid={key==='pool.concentration'&&poolOut} describedBy={key==='pool.concentration'?'pool-criterion':undefined} disabled={!canWrite||busy||data.automaticKeys.includes(key)} onChange={v=>change(key,v)}/>
    {key==='pool.concentration'&&<span id="pool-criterion" className="bench-criterion-note">เกณฑ์ของความเข้มข้น Pooling DNA Library คือ 3.00–3.60 ng/µL{poolOut&&<strong className="bench-out"> · ค่านอกเกณฑ์</strong>}</span>}</label>)}</div>
   {poolOut&&<fieldset className="bench-dilution"><legend>Pooling DNA Library Dilution</legend><p className="muted">C2 = 3.33 ng/µL · V2 = 100 µL ตาม Master</p><label><span>C1 ที่วัดได้ (ng/µL)</span><NumberField label="C1 ที่วัดได้ ng/µL" value={values['pool.dilutionC1']} disabled={!canWrite||busy} onChange={v=>change('pool.dilutionC1',v)}/></label>{pool?.dilution&&<p>V1 {Number(pool.dilution.v1).toFixed(2)} µL · EB {Number(pool.dilution.eb).toFixed(2)} µL</p>}{pool?.dilutionError&&<p role="alert">{pool.dilutionError==='DILUTION_NEGATIVE_EB'?'C1 ต่ำกว่าเป้าหมาย สูตร dilution ให้ EB ติดลบ จึงยังคำนวณใช้จริงไม่ได้':pool.dilutionError}</p>}</fieldset>}
  </section>}
  {data&&tab==='SEQ'&&<section aria-labelledby="seq-title" className="bench-section">
   <div className="bench-section-head"><h2 id="seq-title"><LabIcon name="dna"/>Seq Task-G50</h2>
    <div className="bench-actions"><button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>openPdf('SEQ','Seq Task-G50')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์</button>
     <button className="button" type="button" disabled={busy||!saved||!data.finalized||!data.actualPooling?.current} onClick={()=>void exportPair()}><LabIcon name="download"/>ส่งออก XLSX 2 ไฟล์</button>
     <Link className="button secondary" href="/results"><LabIcon name="upload"/>นำเข้า PDF Result</Link></div></div>
   <div className="seq-groups">{SEQ_GROUPS.map(g=><fieldset key={g.title} className="seq-group"><legend><LabIcon name={g.icon}/>{g.title}</legend><div className="seq-fields">{g.fields.map(f=>{const id=`seq-${f.key}`;
    return <div key={f.key} className="field"><label htmlFor={id}>{f.label}</label>{f.type==='text'?<input id={id} type="text" disabled={!canWrite||busy||data.automaticKeys.includes(f.key)} value={String(values[f.key]??'')} onChange={e=>change(f.key,e.target.value)} aria-describedby={f.hint?`${id}-hint`:undefined}/>
     :<NumberField id={id} label={f.label} signed={f.type==='signed'} value={values[f.key]} disabled={!canWrite||busy||data.automaticKeys.includes(f.key)} describedBy={f.hint?`${id}-hint`:undefined} onChange={v=>change(f.key,v)}/>}{f.hint&&<small id={`${id}-hint`} className="muted">{f.hint}</small>}</div>;})}</div></fieldset>)}</div>
   {data.slots.some(r=>r.kind==='PATIENT')&&<details className="bench-failures"><summary>ผลไม่สำเร็จ / ตรวจซ้ำหลัง Sequencing</summary><ul>{data.slots.filter(r=>r.kind==='PATIENT').map(row=><li key={row.slot}><span className="muted">ตำแหน่ง {row.slot}</span> {sampleCell(row)}</li>)}</ul></details>}
   {seqFiles&&<div className="notice success bench-files" role="region" aria-label="ไฟล์ XLSX จากฉบับเดียวกัน"><p>ใบงานฉบับ {seqFiles.revision} · หาก Browser ไม่ดาวน์โหลดอัตโนมัติ ให้เลือกแต่ละไฟล์</p><div className="bench-actions">{seqFiles.files.map((file,i)=><a key={file.id} className="button secondary" href={`/api/lab-bench/seq-exports/${seqFiles.id}/${file.id}`} download><LabIcon name="download"/>{i+1}. {file.kind==='NIFTY_XLSX'?'NIFTY Test Request':'HALOS Task Import'}</a>)}
    <a className="button secondary" href={`/api/lab-bench/seq-exports/${seqFiles.id}/fallback`} download><LabIcon name="archive"/>3. ชุดสำรองสำหรับ ReadyGen</a></div>
    <p className="help">ชุดสำรองใช้เมื่อระบบ NIPT-CBH ขัดข้องเท่านั้น — มีข้อมูลผู้ป่วย เก็บในสื่อเข้ารหัสของโรงพยาบาลตาม SOP</p></div>}
  </section>}
  {data&&<footer className="worksheet-save-bar"><p role="status" className={dirty||transfersDirty?'save-state dirty':'save-state'}>{status}</p><div className="bench-actions">
   {tab==='QC'&&<><button type="button" className="button secondary" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึกร่าง QC แล้ว')}><LabIcon name="save"/>บันทึกร่าง</button>
    <button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!data.finalized} onClick={()=>void saveAndCalculate()}>บันทึกและคำนวณ Pooling<LabIcon name="chevronRight"/></button></>}
   {tab==='POOL'&&<><button type="button" className="button secondary" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึก QC2 (ร่าง) แล้ว')}><LabIcon name="save"/>บันทึก QC2 (ร่าง)</button>
    <button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!data.finalized||!pool} onClick={()=>void saveTransfers()}><LabIcon name="save"/>บันทึก Pooling จริง</button></>}
   {tab==='SEQ'&&<button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึก Seq Task-G50 แล้ว')}><LabIcon name="save"/>บันทึก</button>}
  </div></footer>}
  {center&&<SampleActionCenter subject={center} can={{repeat:!!data?.canRepeat,redraw:!!data?.canRedraw,noCall:!!data?.canNoCall}} onClose={()=>setCenter(null)} onDone={async message=>{setNotice(message);await reload();}}/>}
  {override&&<Dialog title={`แก้ปริมาตรตำแหน่ง ${override.slot}`} onClose={()=>setOverride(null)}><div className="stack"><label className="field"><span>Volume ที่ใช้จริง (µL)</span><input type="text" inputMode="decimal" value={override.value} onChange={e=>{if(/^\d*(\.\d*)?$/.test(e.target.value))setOverride({...override,value:e.target.value});}}/></label>
   <p className="help">ค่าคำนวณยังเก็บไว้ ค่าที่แก้แสดงแยกและบันทึกเมื่อกด “บันทึก Pooling จริง”</p>
   <div className="dialog-actions"><button type="button" className="button" disabled={!Number.isFinite(Number(override.value))||Number(override.value)<=0} onClick={()=>{updateTransfer(override.slot,{actualVolume:Number(override.value)});setOverride(null);}}>ใช้ค่านี้</button><button type="button" className="button secondary" onClick={()=>{updateTransfer(override.slot,{actualVolume:undefined});setOverride(null);}}>ใช้ค่าคำนวณ</button></div></div></Dialog>}
  {preview&&(preview.url?<PdfPreview src={preview.url} title={preview.title} onClose={()=>setPreview(null)}/>
   :<Dialog title={preview.title} onClose={()=>setPreview(null)}>{preview.error?<div className="stack"><p role="alert" className="notice">โหลด PDF ไม่สำเร็จ: {preview.error}</p><div className="dialog-actions"><button type="button" className="button" onClick={preview.retry}><LabIcon name="refresh"/>ลองอีกครั้ง</button></div></div>:<p role="status">กำลังสร้าง PDF จาก Excel Master…</p>}</Dialog>)}
 </section>;
}
