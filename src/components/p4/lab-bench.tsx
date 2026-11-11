'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {Dialog} from '../p2/shared';
import {PdfPreview} from '../shared/pdf-preview';
import {csrf} from '../p2/shared';
import {labApi,failureText,LabFailure} from './lab-api';
import {VendorExportNotice} from './vendor-export-notice';
import type {VendorExportIssue} from '../../../packages/sequencing/owner-export';
import type {benchWorkspace,benchPooling} from '../../../packages/lab/bench';
import {LabIcon,type LabIconName} from '../shared/lab-icons';
import {BatchStepper} from './batch-stepper';
import {actualPoolingMembers,isPooled} from './pooling-members';
import {RepeatBadge} from './repeat-badge';
import {QC_STANDARDS,benchSteps,qcMissingCount,type StepKey,type StepStatus} from './bench-progress';
import {SampleActionCenter,type ActionCenterSubject} from './action-center';
import './lab-bench.css';
import {OperatorPicker} from './operator-picker';
type Data=Awaited<ReturnType<typeof benchWorkspace>>;
type Pool=Awaited<ReturnType<typeof benchPooling>>;
type Slot=Data['slots'][number];
type Transfer={slot:number;pooled:boolean;actualVolume?:number;reason?:string};
type SeqFiles={id:string;revision:number;files:{id:string;kind:string;filename:string;sha256:string}[]};
type Stage='QC'|'POOL'|'SEQ';
const STAGE_PATH:Record<Stage,string>={QC:'bench',POOL:'pooling',SEQ:'sequencing'};
/** OWNER-LAB-049: Seq Task-G50 groups exactly as the Owner Excel Master (rows 4, 15–23, 34–37, 39–42). The on-bench
 *  "Confirm (√)" cells (B26, F28–F31) stay blank on the printed worksheet for handwriting and are not entered here. */
const SEQ_GROUPS:{title:string;icon:LabIconName;fields:{key:string;label:string;hint?:string;type:'text'|'number'|'signed'}[]}[]=[
 {title:'ข้อมูลการปฏิบัติงาน',icon:'clipboard',fields:[{key:'seq.date',label:'วันที่ปฏิบัติงาน',hint:'วว/ดด/ปปปป (พ.ศ.)',type:'text'},{key:'seq.operator',label:'ผู้ปฏิบัติงาน',type:'text'},{key:'seq.instrument',label:'DNBSEQ-G50 no.',type:'number'},{key:'seq.barcodeType',label:'Barcode type',type:'number'}]},
 {title:'QC3 measurements',icon:'flask',fields:[{key:'seq.standard1',label:'Standard 1',type:'number'},{key:'seq.standard2',label:'Standard 2',type:'number'},{key:'seq.standard2Concentration',label:'Standard 2 Conc. (ng/µL)',hint:'ref. 19.9 ng/µL',type:'number'},{key:'seq.dnbConcentration',label:'DNB concentration (ng/µL)',hint:'Ref. 8–40 ng/µL',type:'number'},{key:'seq.dilutedConcentration',label:'กรณี dilute conc. (ng/µL)',type:'number'}]},
 {title:'Sequencing',icon:'cpu',fields:[{key:'seq.dnbId',label:'DNB ID',hint:'DNBYYYYMMDD',type:'text'},{key:'seq.driveMemoryTb',label:'Hard Drive Memory (TB)',hint:'ควรมากกว่า 500 GB',type:'number'},{key:'seq.negativePressureKpa',label:'Negative Pressure (kPa)',type:'signed'}]},
 {title:'First Cycle',icon:'activity',fields:[{key:'seq.loadedDnb',label:'Loaded DNB',type:'number'},{key:'seq.q30',label:'Q30%',type:'number'},{key:'seq.bic',label:'BIC',type:'number'},{key:'seq.fit',label:'Fit',type:'number'}]},
];
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
 const [poolAmount,setPoolAmount]=useState<string|null>(null);
 const [seqFiles,setSeqFiles]=useState<SeqFiles|null>(null);
 const [exportIssues,setExportIssues]=useState<VendorExportIssue[]>([]);
 const [center,setCenter]=useState<ActionCenterSubject|null>(null);
 // OWNER-LAB-047: a saved actual-pooling record from an older QC/placement source is never re-applied over the recomputed table.
 const setTab=(next:Stage)=>{setTabState(next);const url=new URL(window.location.href);url.pathname=`/lab/batches/${batchId}/${STAGE_PATH[next]}`;window.history.replaceState(window.history.state,'',url);};
 const reload=async()=>{const next=await labApi<Data>(api);setData(next);setValues(next.values);setDirty(false);return next;};
 useEffect(()=>{let active=true;labApi<Data>(api).then(d=>{if(active){setData(d);setValues(d.values);}}).catch(e=>{if(active)setError(failureText(e));});return()=>{active=false;};},[api]);
 useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
 // Pool volumes use only placements and QC source values; QC2/Seq edits do not discard the calculated table.
 const change=(key:string,value:unknown)=>{setSeqFiles(null);setValues(v=>({...v,[key]:value}));setDirty(true);setNotice('');if(/^slot\.\d+\.libraryQc$|^qc\.[123]\.|^pool\.amount$/.test(key))setPool(null);};
 const saved=!!data?.revision&&!dirty&&!data.sourceStale;
 async function saveDraft(draftValues=values){if(!data)return null;await labApi(workbookApi,{action:'saveDraft',expectedVersion:data.version,expectedRevision:data.revision,values:draftValues});setSeqFiles(null);return reload();}
 async function run(work:()=>Promise<void>){setBusy(true);setError('');setExportIssues([]);setNotice('');try{await work();}catch(e){setError(failureText(e));if(e instanceof LabFailure&&e.code==='VENDOR_EXPORT_VALIDATION_FAILED'){setExportIssues((e.details as {issues:VendorExportIssue[]}).issues);setSeqFiles(null);}}finally{setBusy(false);}}
 const calculate=async()=>{setPool(await labApi<Pool>(api,{action:'pool'}));};
 // Load the saved calculation when Pooling opens on a saved, finalized source (no button press needed to see the table).
 useEffect(()=>{if(tab==='POOL'&&saved&&data?.finalized&&!pool&&!busy)void Promise.resolve().then(()=>run(calculate));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tab,saved,data?.finalized,pool]);
 const qcRows=data?.slots.filter(s=>s.kind!=='EMPTY')??[];
 const qcMissing=qcMissingCount(qcRows,values);
 /** OWNER-LAB-044: save QC → validate → calculate → open Pooling, only when every step succeeds. */
 const saveAndCalculate=()=>{
  setError('');
  if(qcMissing){setError(`กรอกค่า QC ให้ครบก่อนคำนวณ Pooling (ยังขาด ${qcMissing} ช่อง)`);return;}
  if(!data?.finalized){setError('พิมพ์ Task List 1–3 ก่อน เพื่อใช้รหัสตัวอย่างจริงทุกช่อง');return;}
  setPoolAmount(String(values['pool.amount']??16));
 };
 const confirmPoolAmount=()=>run(async()=>{
  if(poolAmount===null||!/^\d+(?:\.\d{1,12})?$/.test(poolAmount)||Number(poolAmount)<=0||Number(poolAmount)>=1000000){setError('กรอก Pooling amount มากกว่า 0 และน้อยกว่า 1,000,000 pmol');return;}
  await saveDraft({...values,'pool.amount':Number(poolAmount)});await calculate();setPoolAmount(null);setTab('POOL');setNotice('บันทึก QC และคำนวณ Pooling แล้ว');
 });
 const saveDraftOnly=(message:string)=>run(async()=>{await saveDraft();setNotice(message);});
 /** Owner 2026-11-09: pooling is done on the machine from the exported PDF/CSV, so there is nothing to tick. Saving QC2 (measured after pooling) records the actual pooling by the same rule as the CSV: patients, PC and NC with a volume of at least 2 µL. */
 const saveQc2=()=>run(async()=>{
  let revision=data!.revision;
  if(dirty){const next=await saveDraft();revision=next?.revision??revision;}
  const members:Transfer[]=actualPoolingMembers(pool!.calculation.rows,poolable);
  await labApi(api,{action:'recordActualPooling',revision,members,note:''});await reload();setSeqFiles(null);setNotice('บันทึก QC2 และ Pooling แล้ว');
 });
 const exportPair=()=>run(async()=>{const result=await labApi<SeqFiles>(api,{action:'exportSeqPair',revision:data!.revision,idempotencyKey:crypto.randomUUID()});if(result.files.length!==2)throw Error('สร้างไฟล์ไม่ครบสองไฟล์');setSeqFiles(result);setNotice('สร้างไฟล์ครบ 2 ไฟล์แล้ว');});
 async function fetchExport(kind:'POOL_CSV'|'NIFTY_XLSX'|'QC'|'POOL'|'SEQ'){
  const isWorkbook=kind!=='POOL_CSV'&&kind!=='NIFTY_XLSX',sheet=kind==='QC'?'QC measurements':kind==='POOL'?'Pooling Table':'Seq Task-G50';
  const response=await fetch(isWorkbook?workbookApi:api,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(isWorkbook?{action:'export',revision:data!.revision,format:'PDF',sheet}:{action:'export',revision:data!.revision,kind})});
  if(!response.ok){const e=await response.json().catch(()=>({}));throw new LabFailure(e.code??'REQUEST_FAILED',e.error??'ออกเอกสารไม่สำเร็จ',e.details,response.status);}
  return response.blob();
 }
 /** OWNER-LAB-046 / LEGACY-025: the PDF opens in the modal from the exact response bytes; failures stay in the modal with Retry. */
 function openPdf(kind:'QC'|'POOL'|'SEQ',title:string){
  const load=()=>{setPreview(p=>p&&{...p,url:null,error:undefined});fetchExport(kind).then(blob=>setPreview(p=>p?{...p,url:URL.createObjectURL(blob)}:p)).catch(e=>setPreview(p=>p?{...p,error:e instanceof LabFailure?e.text:e instanceof Error?e.message:'ออกเอกสารไม่สำเร็จ'}:p));};
  setPreview({title,url:null,retry:load});load();
 }
 /** Owner 2026-11-11: the QC and Pooling steps also offer the same worksheet PDF as a file download (the preview/print button stays). */
 const downloadPdf=(kind:'QC'|'POOL',name:string)=>run(async()=>{const url=URL.createObjectURL(await fetchExport(kind));const a=document.createElement('a');a.href=url;a.download=`${data!.runLabel.replace('/','-')}-${name}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});
 const downloadCsv=()=>run(async()=>{const url=URL.createObjectURL(await fetchExport('POOL_CSV'));const a=document.createElement('a');a.href=url;a.download=`${data!.runLabel.replace('/','-')}-POOL_CSV.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});
 /** Sample-info (NIFTY Test Request) file: needs only the saved task, not finalized QC or recorded actual pooling. Owner 2026-11-09: the button lives only on the Sequencing step, where the vendor file is made. The HALOS file stays in the two-file pair because it lists the positions actually pooled. */
 const downloadNifty=()=>run(async()=>{const url=URL.createObjectURL(await fetchExport('NIFTY_XLSX'));const a=document.createElement('a');a.href=url;a.download=`${data!.runLabel.replace('/','-')}-NIFTY-Test-Request.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('สร้างไฟล์ข้อมูลตัวอย่าง (NIFTY) แล้ว');});
 const subjectOf=(row:Slot):ActionCenterSubject|null=>row.kind==='PATIENT'&&row.attemptId&&row.caseId&&row.roundId&&row.hisLn&&row.roundNumber?{attemptId:row.attemptId,caseId:row.caseId,roundId:row.roundId,hisLn:row.hisLn,hn:row.hn,roundNumber:row.roundNumber,sampleId:row.sampleId,attemptState:row.attemptState??'',overallOrdinal:row.overallOrdinal,attemptNumber:row.attemptNumber,outcomeStatus:row.outcomeStatus}:null;
 const sampleCell=(row:Slot)=>{const subject=subjectOf(row);
  return <>{subject?<button type="button" className={`bench-sample-button mono${row.exceptional?' bench-exceptional':''}`} onClick={()=>setCenter(subject)} aria-haspopup="dialog">{row.sampleId}</button>
   :<strong className="mono">{row.sampleId||'ว่าง'}</strong>}
   {row.kind==='PATIENT'&&<RepeatBadge kind={row.repeatBadge}/>}
   {row.kind==='PATIENT'?<small>LN {row.hisLn} · HN {row.hn??'—'} · รอบที่ {row.roundNumber}</small>:row.kind!=='EMPTY'&&<small>{kindLabel(row.kind)}</small>}
   {row.outcomeStatus&&<small className="bench-status-text">{row.outcomeStatus}</small>}</>;};
 // One shared definition (bench-progress.ts) so the Task List page and this page can never disagree about a step.
 const stepStatus=useMemo<Record<StepKey,StepStatus>>(()=>{
  const known=!!data,b=data?benchSteps(data,{values,dirty}):{QC:false,POOL:false,SEQ:false};
  return {TASK:{done:!!data?.finalized,known},QC:{done:b.QC,known},POOL:{done:b.POOL,known},SEQ:{done:b.SEQ,known}};
 },[data,values,dirty]);
 const status=busy?'กำลังบันทึก…':dirty?'มีค่าที่ยังไม่บันทึก':data?.sourceStale?'ข้อมูลต้นทางเปลี่ยน — บันทึกเพื่อผูกข้อมูลล่าสุด':data?.revision?`บันทึกแล้ว · ฉบับ ${data.revision}`:'ยังไม่บันทึก';
 const poolable=(row:{slot:number;sampleId:string})=>{const s=data?.slots.find(x=>x.slot===row.slot),k=s?.kind;return !!row.sampleId&&(k==='PATIENT'||k==='PC'||k==='NC')&&!['QcFailed','Superseded','Stopped','BatchCancelled'].includes(s?.attemptState??'');};
 const pooledCount=pool?pool.calculation.rows.filter(r=>isPooled(r,poolable)).length:0;
 const poolConc=num(values['pool.concentration']),poolOut=poolConc!==null&&(poolConc<3||poolConc>3.6),poolHigh=poolConc!==null&&poolConc>3.6,basis=pool?.dilutionBasis?{target:Number(pool.dilutionBasis.target),total:Number(pool.dilutionBasis.total)}:null,dilutionPreview=poolHigh&&basis&&poolConc!==null?(()=>{const v1=basis.target*basis.total/poolConc;return {v1,eb:basis.total-v1};})():null;

 return <section className="panel lab-bench" data-enter-navigation>
  <nav className="bench-breadcrumb" aria-label="เส้นทางใบงาน"><Link href="/lab/batches">Batch / Task List</Link><span aria-hidden="true">/</span><Link href={`/lab/batches/${batchId}`}>{data?.runLabel??'Run'}</Link></nav>
  <header className="bench-header"><h1>{data?.runLabel??'ใบงาน Lab'}</h1>
   <Link className="button secondary bench-workbook-link" href={`/lab/batches/${batchId}/workbook`}><LabIcon name="file"/>ใบงาน Excel / PDF</Link></header>
  {/* OWNER-LAB-041, extended 2026-11-09 to four steps (Task List first). The three bench steps switch in place; Task List is a link back to the Run page. */}
  <BatchStepper batchId={batchId} current={tab} status={stepStatus} onSelect={setTab}/>
  {exportIssues.length>0?<VendorExportNotice issues={exportIssues}/>:error&&<p role="alert" className="notice danger">{error}</p>}{notice&&!error&&<p role="status" className="notice success">{notice}</p>}
  {!data&&!error&&<p role="status">กำลังโหลดใบงาน…</p>}
  {data&&tab==='QC'&&<section aria-labelledby="qc-title" className="bench-section">
   <div className="bench-section-head"><h2 id="qc-title"><LabIcon name="flask"/>QC Measurements</h2>
    <div className="bench-actions"><button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>openPdf('QC','QC measurements')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์ QC</button>
     <button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>void downloadPdf('QC','QC')}><LabIcon name="download"/>ดาวน์โหลด PDF</button></div></div>
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
    <div className="bench-actions"><button className="button secondary" type="button" disabled={busy||!saved||!pool} onClick={()=>openPdf('POOL','Pooling Table')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์ Pooling Table</button><button className="button secondary" type="button" disabled={busy||!saved||!pool} onClick={()=>void downloadPdf('POOL','Pooling')}><LabIcon name="download"/>ดาวน์โหลด PDF</button><button className="button secondary" type="button" disabled={busy||!saved||!pool} onClick={()=>void downloadCsv()}><LabIcon name="download"/>ส่งออก Pooling CSV</button></div></div>
   {!saved&&<p className="notice" role="note">บันทึกค่า QC ก่อน แล้วระบบจะคำนวณ Pooling จากค่าที่บันทึก</p>}
   {data.actualPooling&&!data.actualPooling.current&&<p role="alert" className="notice warning-notice">ค่า QC หรือตำแหน่งเปลี่ยน — คำนวณใหม่แล้ว กรุณากด “บันทึก QC2” อีกครั้ง</p>}
   {pool&&<>
    <p>Pooling amount {pool.calculation.formula.amount} pmol · Desired Total Volume {Number(pool.calculation.desired).toFixed(2)} µL</p>
    <div className="bench-totals" aria-label="ปริมาตรรวม"><div><span>Total</span><strong>{Number(pool.calculation.total).toFixed(2)}<small>µL</small></strong></div><div><span>EB</span><strong>{Number(pool.calculation.buffer).toFixed(2)}<small>µL</small></strong></div></div>
    <div className="bench-pool-toolbar"><span>ตัวอย่างที่เข้า Pooling {pooledCount} ตำแหน่ง · Blank, Re-xxx และตำแหน่งที่ปริมาตรต่ำกว่า 2 µL ไม่ถูกดูด</span></div>
    <div className="table-wrap" role="region" aria-label="ปริมาตร Pooling" tabIndex={0}><table className="bench-table pool-table"><colgroup><col className="col-slot"/><col/><col className="col-value"/></colgroup>
     <thead><tr><th scope="col">ตำแหน่ง</th><th scope="col">Sample ID</th><th scope="col">Volume (µL)</th></tr></thead>
     <tbody>{pool.calculation.rows.map(row=>{const slot=data.slots.find(s=>s.slot===row.slot)!;
      const shown=row.volume===null?null:Number(row.volume),low=shown!==null&&shown<2;
      return <tr key={row.slot} className={KIND_CLASS[slot?.kind??'']??(slot?.kind==='EMPTY'?'row-empty':undefined)}><th scope="row">{row.slot}</th><td>{slot?sampleCell(slot):row.sampleId}</td>
       <td className={`bench-volume${low?' bench-volume-low':''}`}>{shown===null?'—':shown.toFixed(2)}</td></tr>;})}</tbody></table></div>
   </>}
   <h3 className="bench-subhead">QC2 หลัง Pooling</h3>
   <div className="lab-bench-qc2">{[['pool.standard1','Ref.Std dsDNA Standard 1'],['pool.standard2','Ref.Std dsDNA Standard 2'],['pool.standard2Concentration','Standard 2 Conc.'],['pool.concentration','Pool Library concentration (ng/µL)']].map(([key,label])=><label key={key} className="lab-bench-qc2-field"><span>{label}</span>
    <NumberField label={label} value={values[key]} invalid={key==='pool.concentration'&&poolOut} describedBy={key==='pool.concentration'?'pool-criterion':undefined} disabled={!canWrite||busy||data.automaticKeys.includes(key)} onChange={v=>change(key,v)}/>
    {key==='pool.concentration'&&<span id="pool-criterion" className="bench-criterion-note">เกณฑ์ของความเข้มข้น Pooling DNA Library คือ 3.00–3.60 ng/µL{poolOut&&<strong className="bench-out"> · ค่านอกเกณฑ์</strong>}</span>}</label>)}</div>
   {poolHigh&&<fieldset className="bench-dilution"><legend>Pooling DNA Library Dilution</legend>
    {/* Owner 2026-11-11: C1 is the Pool Library concentration typed above (nothing to type twice); V1 = C2 × V2 ÷ C1. The saved value also fills E52 of the Pooling Table, so the PDF shows the same V1 and EB. */}
    <p>C1 = <strong>{poolConc} ng/µL</strong> (ค่า Pool Library concentration ที่กรอกด้านบน) · C2 = {basis?basis.target:"3.33"} ng/µL · V2 = {basis?basis.total:"100"} µL ตาม Master</p>
    {dilutionPreview&&<p role="status" className="bench-dilution-result">C1 × V1 = C2 × V2 → <strong>V1 = {dilutionPreview.v1.toFixed(2)} µL</strong> · EB {dilutionPreview.eb.toFixed(2)} µL (รวม {basis!.total} µL)</p>}
    <p className="help">กด “บันทึกร่าง QC2” หรือ “บันทึก QC2” แล้วค่านี้จะอยู่ใน Pooling Table (PDF) ด้วย</p></fieldset>}
  </section>}
  {data&&tab==='SEQ'&&<section aria-labelledby="seq-title" className="bench-section">
   <div className="bench-section-head"><h2 id="seq-title"><LabIcon name="dna"/>Seq Task-G50</h2>
    <div className="bench-actions"><button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>openPdf('SEQ','Seq Task-G50')}><LabIcon name="printer"/>ดูตัวอย่าง / พิมพ์</button>
     <button className="button secondary" type="button" disabled={busy||!saved} onClick={()=>void downloadNifty()}><LabIcon name="download"/>ส่งออกไฟล์ข้อมูล (NIFTY)</button>
     <button className="button" type="button" disabled={busy||!saved} onClick={()=>void exportPair()}><LabIcon name="download"/>ส่งออก XLSX 2 ไฟล์</button>
     <Link className="button secondary" href="/results"><LabIcon name="upload"/>นำเข้า PDF Result</Link></div></div>
   <div className="seq-groups">{SEQ_GROUPS.map(g=><fieldset key={g.title} className="seq-group"><legend><LabIcon name={g.icon}/>{g.title}</legend><div className="seq-fields">{g.fields.map(f=>{const id=`seq-${f.key}`;
    return <div key={f.key} className="field"><label htmlFor={id}>{f.label}</label>{f.key==='seq.operator'?<OperatorPicker id={id} value={String(values[f.key]??'')} disabled={!canWrite||busy||data.automaticKeys.includes(f.key)} onChange={v=>change(f.key,v)}/>:f.type==='text'?<input id={id} type="text" disabled={!canWrite||busy||data.automaticKeys.includes(f.key)} value={String(values[f.key]??'')} onChange={e=>change(f.key,e.target.value)} aria-describedby={f.hint?`${id}-hint`:undefined}/>
     :<NumberField id={id} label={f.label} signed={f.type==='signed'} value={values[f.key]} disabled={!canWrite||busy||data.automaticKeys.includes(f.key)} describedBy={f.hint?`${id}-hint`:undefined} onChange={v=>change(f.key,v)}/>}{f.hint&&<small id={`${id}-hint`} className="muted">{f.hint}</small>}</div>;})}</div></fieldset>)}</div>
   {data.slots.some(r=>r.kind==='PATIENT')&&<details className="bench-failures"><summary>ผลไม่สำเร็จ / ตรวจซ้ำหลัง Sequencing</summary><ul>{data.slots.filter(r=>r.kind==='PATIENT').map(row=><li key={row.slot}><span className="muted">ตำแหน่ง {row.slot}</span> {sampleCell(row)}</li>)}</ul></details>}
   {seqFiles&&<div className="notice success bench-files" role="region" aria-label="ไฟล์ XLSX จากฉบับเดียวกัน"><p>ใบงานฉบับ {seqFiles.revision} · หาก Browser ไม่ดาวน์โหลดอัตโนมัติ ให้เลือกแต่ละไฟล์</p><div className="bench-actions">{seqFiles.files.map((file,i)=><a key={file.id} className="button secondary" href={`/api/lab-bench/seq-exports/${seqFiles.id}/${file.id}`} download><LabIcon name="download"/>{i+1}. {file.kind==='NIFTY_XLSX'?'NIFTY Test Request':'HALOS Task Import'}</a>)}
    <a className="button secondary" href={`/api/lab-bench/seq-exports/${seqFiles.id}/fallback`} download><LabIcon name="archive"/>3. ชุดสำรองสำหรับ ReadyGen</a></div>
    <p className="help">ชุดสำรองใช้เมื่อระบบ NIPT-CBH ขัดข้องเท่านั้น — มีข้อมูลผู้ป่วย เก็บในสื่อเข้ารหัสของโรงพยาบาลตาม SOP</p></div>}
  </section>}
  {data&&<footer className="worksheet-save-bar"><p role="status" className={dirty?'save-state dirty':'save-state'}>{status}</p><div className="bench-actions">
   {tab==='QC'&&<><button type="button" className="button secondary" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึกร่าง QC แล้ว')}><LabIcon name="save"/>บันทึกร่าง</button>
    <button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!data.finalized} onClick={()=>void saveAndCalculate()}>บันทึกและคำนวณ Pooling<LabIcon name="chevronRight"/></button></>}
   {tab==='POOL'&&<><button type="button" className="button secondary" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึกร่าง QC2 แล้ว')}><LabIcon name="save"/>บันทึกร่าง QC2</button>
    <button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!data.finalized||!pool||typeof values['pool.concentration']!=='number'} title={typeof values['pool.concentration']!=='number'?'กรอกความเข้มข้น Pool Library ก่อน':undefined} onClick={()=>void saveQc2()}><LabIcon name="save"/>บันทึก QC2</button></>}
   {tab==='SEQ'&&<button data-worksheet-save type="button" className="button" disabled={!canWrite||busy||!dirty} onClick={()=>void saveDraftOnly('บันทึก Seq Task-G50 แล้ว')}><LabIcon name="save"/>บันทึก</button>}
  </div></footer>}
  {center&&<SampleActionCenter subject={center} can={{repeat:!!data?.canRepeat,redraw:!!data?.canRedraw,noCall:!!data?.canNoCall}} onClose={()=>setCenter(null)} onDone={async message=>{setNotice(message);await reload();}}/>}
  {poolAmount!==null&&<Dialog title="Pooling amount (pmol)" onClose={()=>{if(!busy)setPoolAmount(null);}}><form className="stack" onSubmit={e=>{e.preventDefault();void confirmPoolAmount();}}>
   <label className="field"><span>Pooling amount (pmol)</span><input autoFocus type="text" inputMode="decimal" value={poolAmount} disabled={busy} onChange={e=>{if(/^\d*(\.\d*)?$/.test(e.target.value))setPoolAmount(e.target.value);}} required aria-describedby="pool-amount-help"/></label>
   <p id="pool-amount-help" className="help">ค่าเริ่มต้น 16 pmol ใช้คำนวณ Volume และ Desired Total Volume</p>
   {error&&<p role="alert" className="notice">{error}</p>}
   <div className="dialog-actions"><button type="submit" className="button" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึกและคำนวณ Pooling'}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setPoolAmount(null)}>ยกเลิก</button></div>
  </form></Dialog>}
  {preview&&(preview.url?<PdfPreview src={preview.url} title={preview.title} onClose={()=>setPreview(null)}/>
   :<Dialog title={preview.title} onClose={()=>setPreview(null)}>{preview.error?<div className="stack"><p role="alert" className="notice">โหลด PDF ไม่สำเร็จ: {preview.error}</p><div className="dialog-actions"><button type="button" className="button" onClick={preview.retry}><LabIcon name="refresh"/>ลองอีกครั้ง</button></div></div>:<p role="status">กำลังสร้าง PDF จาก Excel Master…</p>}</Dialog>)}
 </section>;
}
