'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {failureText,LabFailure,labApi,labPdf} from './p4/lab-api';
import {csrf} from './p2/shared';
import {Pager} from './shared/pager';
import type {storageSearch,StorageType,StorageBoxType} from '../../packages/lab/sample-storage';
import styles from './sample-storage.module.css';

type Data=Awaited<ReturnType<typeof storageSearch>>;
type StorageRow=Data['rows'][number];
type Box=Data['boxes'][number];
type AutoPlan={storageTypes:StorageType[];waiting:number;selected:number;batchSize:number;remaining:number;planned:number;unplaced:number;planHash:string;placements:{roundId:string;ln:string;hn:string|null;lnHalos:string;roundNumber:number;receivedAt:string;storageType:StorageType;storageLabel:string;boxUuid:string;boxId:string;slot:number;position:string}[]};
type DragPayload={kind:'waiting'|'stored';roundId:string;storageType:StorageType;fromBoxId?:string;fromSlot?:number};
type BoxFilter='ALL'|StorageType;
const TYPE_LABEL:Record<StorageType,string>={BACKUP:'Backup Box',BUFFY_COAT:'Buffy Coat Box'};
const TYPE_SHORT:Record<StorageBoxType,string>={BACKUP:'Backup',BUFFY_COAT:'Buffy Coat',LEGACY_UNCLASSIFIED:'ข้อมูลเดิม'};
const rowKey=(row:StorageRow)=>`${row.roundId}:${row.storageType}`;
const displayStorageDate=(value:string|null)=>value?new Intl.DateTimeFormat('th-TH-u-ca-buddhist',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)):'—';

async function postStorage<T>(body:Record<string,unknown>):Promise<T>{
 const response=await fetch('/api/sample-storage',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new LabFailure(data.code??'REQUEST_FAILED',data.error??'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง',data.details,response.status);
 return data as T;
}

export function SampleStorage({canWrite,canPrint}:{canWrite:boolean;canPrint:boolean}){
 const [query,setQuery]=useState(''),[boxQuery,setBoxQuery]=useState(''),[page,setPage]=useState(1),[boxPage,setBoxPage]=useState(1),[boxFilter,setBoxFilter]=useState<BoxFilter>('ALL');
 const [activeBoxId,setActiveBoxId]=useState(''),[data,setData]=useState<Data|null>(null),[refresh,setRefresh]=useState(0);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selectedKeys,setSelectedKeys]=useState<string[]>([]),[selectedWaiting,setSelectedWaiting]=useState<StorageRow|null>(null);
 const [selectedPosition,setSelectedPosition]=useState<{roundId:string;storageType:StorageBoxType;boxId:string;slot:number;storageLabel:string}|null>(null);
 const [targetBoxId,setTargetBoxId]=useState(''),[targetSlot,setTargetSlot]=useState(1);
 const [autoPlan,setAutoPlan]=useState<AutoPlan|null>(null),[autoRoundIds,setAutoRoundIds]=useState<string[]|undefined>();
 const [dragTarget,setDragTarget]=useState('');
 const gridScrollerRef=useRef<HTMLDivElement>(null);

 useEffect(()=>{
  let current=true;
  const timer=setTimeout(()=>{
   setLoading(true);
   postStorage<Data>({action:'search',q:query,page,boxType:boxFilter,boxQuery,boxPage,...(activeBoxId?{activeBoxId}:{})})
    .then(result=>{
     if(!current)return;
     setData(result);setError('');
      const activeStillVisible=activeBoxId&&result.activeBox?.id===activeBoxId;
     if(!activeStillVisible){
      const preferred=boxFilter==='ALL'?result.boxes.find(box=>box.boxType==='BACKUP')??result.boxes.find(box=>box.boxType==='BUFFY_COAT'):result.boxes[0];
      if(preferred){setActiveBoxId(preferred.id);setTargetBoxId(preferred.id);if(preferred.nextSlot)setTargetSlot(preferred.nextSlot);}
     }
    })
    .catch(reason=>{if(current)setError(failureText(reason));})
    .finally(()=>{if(current)setLoading(false);});
  },250);
  return()=>{current=false;clearTimeout(timer);};
  },[query,page,boxFilter,boxQuery,boxPage,activeBoxId,refresh]);

 const visibleBoxes=data?.boxes??[];
 const activeBox=data?.activeBox??null;
 const activeType:StorageType=activeBox?.boxType==='BUFFY_COAT'?'BUFFY_COAT':boxFilter==='BUFFY_COAT'?'BUFFY_COAT':'BACKUP';
 const waitingCount=boxFilter==='BACKUP'?data?.summary.waitingBackup??0:boxFilter==='BUFFY_COAT'?data?.summary.waitingBuffy??0:(data?.summary.waitingBackup??0)+(data?.summary.waitingBuffy??0);
 const selectedRows=useMemo(()=>data?.rows.filter(row=>row.waiting&&selectedKeys.includes(rowKey(row)))??[],[data?.rows,selectedKeys]);
 const selectedType=selectedRows[0]?.storageType;
 const mixedSelection=selectedRows.some(row=>row.storageType!==selectedType);
 const targetBox=visibleBoxes.find(box=>box.id===targetBoxId);
 const waitingRows=data?.rows??[];
 const usedBoxCount=data?.boxInUse??0;
 const selectedCell=selectedPosition&&activeBox?.id===selectedPosition.boxId?activeBox.grid.find(cell=>cell.slot===selectedPosition.slot&&cell.roundId===selectedPosition.roundId):null;

 useEffect(()=>{
  if(!selectedPosition||activeBox?.id!==selectedPosition.boxId)return;
  const target=gridScrollerRef.current?.querySelector<HTMLButtonElement>(`[data-storage-slot="${selectedPosition.slot}"]`);
  if(!target)return;
  target.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
  target.focus({preventScroll:true});
 },[activeBox?.id,activeBox?.grid,selectedPosition]);

 async function command<T=Record<string,unknown>>(body:Record<string,unknown>):Promise<T|null>{
  setBusy(true);setError('');setNotice('');
  try{const result=await labApi<T>('/api/sample-storage',body);setRefresh(value=>value+1);return result;}
  catch(reason){setError(failureText(reason));return null;}
  finally{setBusy(false);}
 }

 async function openBox(){
  const result=await command<{id:string;boxId:string;boxType:StorageType}>({action:'createBox',boxType:activeType});
  if(result){setBoxFilter(activeType);setBoxQuery('');setBoxPage(1);setActiveBoxId(result.id);setTargetBoxId(result.id);setPage(1);setNotice(`เปิด ${TYPE_LABEL[result.boxType]} ${result.boxId} แล้ว`);}
 }

 async function printBox(boxId:string){
  setBusy(true);setError('');
  try{await labPdf('/api/sample-storage',{action:'printLabel',boxId});}
  catch(reason){setError(failureText(reason));}
  finally{setBusy(false);}
 }

 async function printSample(roundId:string,storageType:StorageType){
  setBusy(true);setError('');
  try{await labPdf('/api/sample-storage',{action:'printSampleLabel',roundId,storageType});}
  catch(reason){setError(failureText(reason));}
  finally{setBusy(false);}
 }

 function printRowSample(row:StorageRow){
  if(row.storageType==='LEGACY_UNCLASSIFIED')return;
  void printSample(row.roundId,row.storageType);
 }

 function locateRow(row:StorageRow){
  if(!row.boxUuid||!row.slot)return;
  setBoxQuery(row.boxId??'');setBoxPage(1);setActiveBoxId(row.boxUuid);setTargetBoxId(row.boxUuid);
  setSelectedPosition({roundId:row.roundId,storageType:row.storageType,boxId:row.boxUuid,slot:row.slot,storageLabel:row.storageLabel??'ข้อมูลเดิม'});
  setSelectedWaiting(null);
 }

 async function previewAutoFill(){
  if(mixedSelection){setError('เลือกประเภทเดียวก่อนสร้าง Auto-fill Preview');return;}
  const storageTypes=selectedType?[selectedType]:boxFilter==='ALL'?['BACKUP','BUFFY_COAT'] as StorageType[]:[boxFilter],roundIds=selectedRows.length?selectedRows.map(row=>row.roundId):undefined;
  setBusy(true);setError('');setNotice('');
  try{const result=await postStorage<AutoPlan>({action:'autoFillPreview',storageTypes,...(roundIds?{roundIds}:{})});setAutoPlan(result);setAutoRoundIds(roundIds);}
  catch(reason){setError(failureText(reason));}
  finally{setBusy(false);}
 }

 async function confirmAutoFill(){
  if(!autoPlan)return;
  const result=await command<{stored:number;storageTypes:StorageType[]}>({action:'autoFillConfirm',storageTypes:autoPlan.storageTypes,planHash:autoPlan.planHash,...(autoRoundIds?{roundIds:autoRoundIds}:{})});
  if(result){setNotice(`จัดเก็บ ${result.stored} ตัวอย่างตาม FIFO แล้ว`);setAutoPlan(null);setAutoRoundIds(undefined);setSelectedKeys([]);}
 }

 function toggleSelection(row:StorageRow){
  const key=rowKey(row);
  setSelectedKeys(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
 }

 function startWaitingDrag(event:React.DragEvent, row:StorageRow){
  if(!canWrite||row.storageType==='LEGACY_UNCLASSIFIED')return;
  const payload:DragPayload={kind:'waiting',roundId:row.roundId,storageType:row.storageType};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(payload));
 }

 function startStoredDrag(event:React.DragEvent, cell:NonNullable<Data['activeBox']>['grid'][number]){
  if(!canWrite||!activeBox||!cell.occupied||cell.storageType==='LEGACY_UNCLASSIFIED'||!cell.roundId)return;
  const payload:DragPayload={kind:'stored',roundId:cell.roundId,storageType:cell.storageType,fromBoxId:activeBox.id,fromSlot:cell.slot};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(payload));
 }

 function finishDrag(){setSelectedWaiting(null);setSelectedPosition(null);}

 function decodeDrag(event:React.DragEvent):DragPayload|null{
  try{const value=JSON.parse(event.dataTransfer.getData('text/plain'));if(value&&['waiting','stored'].includes(value.kind)&&typeof value.roundId==='string')return value as DragPayload;}
  catch{}
  return null;
 }

 async function dropIntoCell(event:React.DragEvent,slot:number,occupied:boolean){
  event.preventDefault();setDragTarget('');
  if(occupied){setError('ตำแหน่งนี้มีตัวอย่างอยู่แล้ว กรุณาเลือกช่องว่าง');return;}
  const payload=decodeDrag(event);
  if(!payload||!activeBox)return;
  if(payload.storageType!==activeBox.boxType){setError('ประเภทกล่องไม่ตรงกับชนิดตัวอย่าง');return;}
  const result=payload.kind==='waiting'
   ?await command({action:'place',roundId:payload.roundId,storageType:payload.storageType,boxId:activeBox.id,slot})
   :await command({action:'move',roundId:payload.roundId,storageType:payload.storageType,fromBoxId:payload.fromBoxId,fromSlot:payload.fromSlot,toBoxId:activeBox.id,toSlot:slot});
  if(result){setSelectedWaiting(null);setSelectedPosition(null);setSelectedKeys(current=>current.filter(key=>!key.startsWith(`${payload.roundId}:`)));}
 }

 async function dropIntoBox(event:React.DragEvent,box:Box){
  event.preventDefault();setDragTarget('');
  if(!box.nextSlot){setError('กล่องเต็มแล้ว กรุณาเปิดกล่องใหม่');return;}
  const payload=decodeDrag(event);if(!payload)return;
  if(box.boxType!==payload.storageType){setError('ประเภทกล่องไม่ตรงกับชนิดตัวอย่าง');return;}
  const result=payload.kind==='waiting'
   ?await command({action:'place',roundId:payload.roundId,storageType:payload.storageType,boxId:box.id,slot:box.nextSlot})
   :await command({action:'move',roundId:payload.roundId,storageType:payload.storageType,fromBoxId:payload.fromBoxId,fromSlot:payload.fromSlot,toBoxId:box.id,toSlot:box.nextSlot});
  if(result){setActiveBoxId(box.id);setTargetBoxId(box.id);setSelectedWaiting(null);setSelectedPosition(null);setSelectedKeys(current=>current.filter(key=>!key.startsWith(`${payload.roundId}:`)));}
 }

 async function placeOrMoveByKeyboard(){
  if(!targetBox||!targetBox.nextSlot)return;
  if(selectedWaiting){
   if(selectedWaiting.storageType!==targetBox.boxType){setError('ประเภทกล่องไม่ตรงกับชนิดตัวอย่าง');return;}
   const result=await command({action:'place',roundId:selectedWaiting.roundId,storageType:selectedWaiting.storageType,boxId:targetBox.id,slot:targetSlot});
   if(result){setSelectedWaiting(null);setSelectedKeys(current=>current.filter(key=>key!==rowKey(selectedWaiting)));}
   return;
  }
  if(selectedPosition){
   if(selectedPosition.storageType==='LEGACY_UNCLASSIFIED')return;
   if(selectedPosition.storageType!==targetBox.boxType){setError('ประเภทกล่องไม่ตรงกับชนิดตัวอย่าง');return;}
   const result=await command({action:'move',roundId:selectedPosition.roundId,storageType:selectedPosition.storageType,fromBoxId:selectedPosition.boxId,fromSlot:selectedPosition.slot,toBoxId:targetBox.id,toSlot:targetSlot});
   if(result)setSelectedPosition(null);
  }
 }

 const targetSlots=targetBox&&activeBox?.id===targetBox.id?activeBox.grid.filter(cell=>!cell.occupied).map(cell=>cell.slot):targetBox?.nextSlot?[targetBox.nextSlot]:[];

 return <section className={styles.storage}>
  <header className={styles.hero}>
   <div className={styles.titleBlock}><h1>จัดเก็บตัวอย่าง</h1><p>Sample Storage</p><span>จัดเก็บตัวอย่างลงในกล่อง 9×9 และค้นหาตำแหน่งได้ทันที</span></div>
   <div className={styles.searchBlock}>
    <label htmlFor="sample-storage-search">ค้นหา LN / HN / LN Halos / Box ID</label>
    <div className={styles.searchInput}><span aria-hidden="true">⌕</span><input id="sample-storage-search" type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} autoComplete="off" placeholder="ค้นหา LN / HN / LN Halos / Box ID" /></div>
    <span className={styles.helper}>ค้นหาในข้อมูลจัดเก็บที่ผู้ใช้มีสิทธิ์เข้าถึง</span>
   </div>
   <button className={styles.autoButton} type="button" disabled={!canWrite||busy||mixedSelection} onClick={()=>void previewAutoFill()}><span aria-hidden="true">▶</span> Auto-fill {selectedRows.length?`${selectedRows.length} ตัวอย่างที่เลือก`:`${waitingCount} ตัวอย่าง`}</button>
  </header>

  {error&&<p role="alert" className={styles.alert}>{error}</p>}
  {notice&&<p role="status" className={styles.notice}>{notice}</p>}

  <div className={styles.metrics} aria-label="สรุปข้อมูลจัดเก็บจากฐานข้อมูล">
   <article className={styles.metric}><span className={styles.metricIcon} aria-hidden="true">◷</span><div><span>รอจัดเก็บ</span><strong>{waitingCount}</strong><small>ตัวอย่าง</small></div></article>
   <article className={styles.metric}><span className={styles.metricIcon} aria-hidden="true">▣</span><div><span>กล่องที่กำลังใช้งาน</span><strong>{usedBoxCount}/{data?.boxTotal??0}</strong><small>กล่อง</small></div></article>
   <article className={styles.metric}><span className={styles.metricIcon} aria-hidden="true">▤</span><div><span>ตัวอย่างที่จัดเก็บแล้ว</span><strong>{(data?.summary.storedBackup??0)+(data?.summary.storedBuffy??0)}</strong><small>ตัวอย่าง</small></div></article>
   <article className={styles.metric}><span className={styles.metricIcon} aria-hidden="true">◇</span><div><span>รายการจัดเก็บเดิม</span><strong>{data?.summary.legacyStored??0}</strong><small>ยังไม่ระบุประเภท</small></div></article>
  </div>

  <nav className={styles.typeTabs} aria-label="กรองประเภทกล่อง">
   {([{id:'ALL',label:'ทั้งหมด'},{id:'BACKUP',label:'Backup Box'},{id:'BUFFY_COAT',label:'Buffy Coat Box'}] as const).map(tab=><button key={tab.id} type="button" aria-pressed={boxFilter===tab.id} className={boxFilter===tab.id?styles.tabActive:styles.tab} onClick={()=>{setBoxFilter(tab.id);setActiveBoxId('');setTargetBoxId('');setTargetSlot(1);setPage(1);setSelectedKeys([]);setSelectedWaiting(null);setSelectedPosition(null);}}>{tab.label}{tab.id==='BACKUP'&&<span>{data?.summary.storedBackup??0}</span>}{tab.id==='BUFFY_COAT'&&<span>{data?.summary.storedBuffy??0}</span>}</button>)}
  </nav>

  <div className={styles.dashboard}>
   <aside className={styles.boxPanel}>
    <div className={styles.panelHeading}><div><h2>กล่องจัดเก็บตัวอย่าง</h2><p>เลือกกล่องเพื่อดูรายละเอียด · {data?.boxTotal??0} กล่อง · หน้า {data?.boxPage??1}/{data?.boxTotalPages??1}</p></div>{canWrite&&<button type="button" className={styles.iconButton} aria-label={`เปิด ${TYPE_LABEL[activeType]} ใหม่`} onClick={()=>void openBox()} disabled={busy}>＋</button>}</div>
    <label className={styles.boxSearchLabel} htmlFor="box-list-search">ค้นหากล่อง</label>
   <input className={styles.boxSearch} id="box-list-search" type="search" placeholder="ค้นหา Box ID" onChange={event=>{setBoxQuery(event.target.value);setBoxPage(1);}} value={boxQuery} autoComplete="off" />
    <ul className={styles.boxList} aria-label="รายการกล่อง">
     {visibleBoxes.map(box=><li key={box.id}>
       <button type="button" className={`${styles.boxCard} ${activeBoxId===box.id?styles.boxCardActive:''} ${dragTarget===`box:${box.id}`?styles.dropTarget:''}`} onClick={()=>{setActiveBoxId(box.id);setTargetBoxId(box.id);if(box.nextSlot)setTargetSlot(box.nextSlot);}} onDragOver={event=>{if(canWrite)event.preventDefault();}} onDragEnter={()=>setDragTarget(`box:${box.id}`)} onDragLeave={()=>setDragTarget('')} onDrop={event=>void dropIntoBox(event,box)}>
       <span className={`${styles.boxIcon} ${box.boxType==='BUFFY_COAT'?styles.buffyIcon:''}`} aria-hidden="true">▣</span>
       <span className={styles.boxInfo}><strong>{box.boxId}</strong><span className={styles.badge}>{box.boxType==='LEGACY_UNCLASSIFIED'?'ข้อมูลเดิม':TYPE_SHORT[box.boxType]}</span><small>{box.used}/81 ช่อง {box.nextSlot?`· ช่องว่างถัดไป ${'ABCDEFGHI'[(box.nextSlot-1)%9]}${Math.floor((box.nextSlot-1)/9)+1}`:'· กล่องเต็ม'}</small><span className={styles.progress}><i style={{width:`${Math.min(100,box.used/81*100)}%`}} /></span></span>
       <span className={styles.boxStatus}>{box.status==='FULL'?'เต็ม':box.status==='IN_USE'?'กำลังใช้':'ว่าง'}</span>
      </button>
     </li>)}
     {!visibleBoxes.length&&<li className={styles.emptyState}>{boxQuery?'ไม่พบ Box ID ที่ค้นหา':'ยังไม่มีกล่องประเภทนี้ เปิดกล่องใหม่เพื่อเริ่มจัดเก็บ'}</li>}
    </ul>
    {data&&data.boxTotal>50&&<Pager label="กล่องจัดเก็บ" page={data.boxPage} pageSize={50} sizes={[50]} total={data.boxTotal} totalPages={data.boxTotalPages} onPage={setBoxPage} onSize={()=>{}}/>}
   </aside>

   <main className={styles.activePanel}>
    <div className={styles.activeHeading}>
     <div><h2>{activeBox?.boxId??'เลือกกล่องจัดเก็บ'}</h2><p>{activeBox?`${activeBox.used}/81 ช่อง · ${Math.round(activeBox.used/81*100)}%`: 'เลือกกล่องจากรายการ หรือเปิดกล่องใหม่'}{activeBox&&<span className={styles.badge}>{activeBox.boxType==='LEGACY_UNCLASSIFIED'?'ข้อมูลเดิม':TYPE_LABEL[activeBox.boxType]}</span>}</p></div>
     <div className={styles.actions}>{canWrite&&<button type="button" className={styles.secondaryButton} onClick={()=>void openBox()} disabled={busy}>＋ เปิดกล่องใหม่</button>}{canPrint&&activeBox&&<button type="button" className={styles.secondaryButton} onClick={()=>void printBox(activeBox.id)} disabled={busy}>▤ พิมพ์ / พิมพ์ซ้ำฉลากกล่อง</button>}</div>
    </div>
    {activeBox&&<div className={styles.boxProgress}><span style={{width:`${Math.min(100,activeBox.used/81*100)}%`}} /></div>}
    {activeBox?<>
     <div className={styles.boxFacts}><span><small>ประเภท</small><strong>{activeBox.boxType==='LEGACY_UNCLASSIFIED'?'ข้อมูลเดิมที่ยังไม่ระบุ':TYPE_LABEL[activeBox.boxType]}</strong></span><span><small>การใช้งาน</small><strong>{activeBox.used}/81 ช่อง</strong></span><span><small>สถานะ</small><strong>{activeBox.status==='FULL'?'เต็ม':activeBox.status==='IN_USE'?'กำลังใช้งาน':'ว่าง'}</strong></span></div>
     {(selectedWaiting||selectedCell)&&<section className={styles.retentionDetails} aria-label="รายละเอียดตัวอย่างและกำหนดเก็บรักษา"><strong>{selectedWaiting?.storageLabel??selectedCell?.storageLabel??'ข้อมูลเดิม'}{selectedCell?` · ${selectedCell.position}`:''}</strong><span>LN {selectedWaiting?.ln??selectedCell?.ln??'—'} · HN {selectedWaiting?.hn??selectedCell?.hn??'—'} · LN Halos {selectedWaiting?.lnHalos??selectedCell?.lnHalos??'—'} · รอบ {selectedWaiting?.roundNumber??selectedCell?.roundNumber??'—'}</span><span>รับจาก HIS (PET): {(selectedWaiting?.retentionVerified??selectedCell?.retentionVerified)?displayStorageDate(selectedWaiting?.receivedAt??selectedCell?.receivedAt??null):'ไม่มีวันที่รับจาก PET ที่ยืนยันได้'}</span><span>ครบกำหนดเก็บรักษา: {displayStorageDate(selectedWaiting?.retentionDueAt??selectedCell?.retentionDueAt??null)=== '—'?'ยังคำนวณไม่ได้จากข้อมูลที่ยืนยัน':displayStorageDate(selectedWaiting?.retentionDueAt??selectedCell?.retentionDueAt??null)}</span></section>}
     <div className={styles.gridScroller} ref={gridScrollerRef} role="region" aria-label="ตารางตำแหน่ง 9 คูณ 9" tabIndex={0}>
      <div className={styles.grid} role="grid" aria-label={`ตำแหน่งใน ${activeBox.boxId}`}>
       <div className={styles.columnHeaders} role="row"><span role="presentation" />{'ABCDEFGHI'.split('').map(letter=><span key={letter} role="columnheader">{letter}</span>)}</div>
       {Array.from({length:9},(_,rowIndex)=><div className={styles.gridRow} role="row" key={rowIndex}><span className={styles.rowHeader} role="rowheader">{rowIndex+1}</span>{activeBox.grid.slice(rowIndex*9,rowIndex*9+9).map(cell=><button key={cell.slot} type="button" role="gridcell" data-storage-slot={cell.slot} aria-selected={selectedPosition?.roundId===cell.roundId&&selectedPosition.storageType===cell.storageType} draggable={canWrite&&cell.occupied&&cell.storageType!=='LEGACY_UNCLASSIFIED'} aria-label={`${cell.position}${cell.occupied?cell.roundId?`, ${cell.storageLabel??'ข้อมูลเดิม'}, LN ${cell.ln??''}, HN ${cell.hn??''}`:', มีตัวอย่าง แต่ไม่มีสิทธิ์แสดงรายละเอียด':', ว่าง'}`} className={`${styles.slot} ${cell.occupied?styles.slotOccupied:styles.slotEmpty} ${selectedPosition?.roundId===cell.roundId&&selectedPosition.storageType===cell.storageType?styles.slotSelected:''} ${dragTarget===`slot:${cell.slot}`?styles.dropTarget:''}`} onClick={()=>{if(cell.occupied&&cell.roundId){setSelectedPosition({roundId:cell.roundId,storageType:cell.storageType,boxId:activeBox.id,slot:cell.slot,storageLabel:cell.storageLabel??'ข้อมูลเดิม'});setSelectedWaiting(null);}else if(selectedWaiting&&!cell.occupied)void command({action:'place',roundId:selectedWaiting.roundId,storageType:selectedWaiting.storageType,boxId:activeBox.id,slot:cell.slot}).then(result=>{if(result){setSelectedWaiting(null);setSelectedKeys(current=>current.filter(key=>key!==rowKey(selectedWaiting)));}});}} onDragStart={event=>startStoredDrag(event,cell)} onDragEnd={finishDrag} onDragOver={event=>{if(!cell.occupied){event.preventDefault();setDragTarget(`slot:${cell.slot}`);}}} onDragLeave={()=>setDragTarget('')} onDrop={event=>void dropIntoCell(event,cell.slot,cell.occupied)} disabled={busy||!canWrite&& !cell.occupied}>
        {cell.occupied?<><strong className={styles.cellCode}>{cell.roundId?cell.storageLabel??'ข้อมูลเดิม':'มีตัวอย่าง'}</strong><span>{cell.roundId?`LN ${cell.ln??'—'}`:'รายละเอียดถูกจำกัดสิทธิ์'}</span>{cell.roundId&&<><small>HN {cell.hn??'—'}</small>{cell.lnHalos&&<small className={styles.cellHalos}>{cell.lnHalos}</small>}</>}</>:<><span>ว่าง</span><small>ลากตัวอย่างมาวาง</small></>}
       </button>)}</div>)}
      </div>
     </div>
     <div className={styles.legend}><span><i className={styles.legendFilled} />ตัวอย่างจัดเก็บแล้ว</span><span><i className={styles.legendEmpty} />ช่องว่าง</span><span>ตำแหน่ง A1–I9 · แถวละ 9 ช่อง</span></div>
    </>:<div className={styles.emptyGrid}>เลือกหรือเปิดกล่องเพื่อแสดงตำแหน่งจัดเก็บ 9×9</div>}
    {canWrite&&(selectedWaiting||selectedPosition&&selectedPosition.storageType!=='LEGACY_UNCLASSIFIED')&&<section className={styles.keyboardMove} aria-label="จัดเก็บหรือย้ายด้วยแป้นพิมพ์">
     <div><strong>{selectedWaiting?`เลือก ${selectedWaiting.storageLabel} เพื่อจัดเก็บ`: `เลือก ${selectedPosition?.storageLabel} เพื่อย้าย`}</strong><p>ใช้ตัวเลือกกล่องและช่องว่าง แล้วกดปุ่มเพื่อบันทึกตำแหน่ง</p></div>
     <label>กล่องปลายทาง<select value={targetBoxId} onChange={event=>{const box=visibleBoxes.find(item=>item.id===event.target.value);setTargetBoxId(event.target.value);if(box?.nextSlot)setTargetSlot(box.nextSlot);}}>{visibleBoxes.filter(box=>box.boxType===(selectedWaiting?.storageType??selectedPosition?.storageType)&&box.nextSlot!==null).map(box=><option key={box.id} value={box.id}>{box.boxId} · {box.used}/81</option>)}</select></label>
     <label>ช่องปลายทาง<select value={targetSlot} onChange={event=>setTargetSlot(Number(event.target.value))}>{targetSlots.map(slot=><option key={slot} value={slot}>{'ABCDEFGHI'[(slot-1)%9]}{Math.floor((slot-1)/9)+1}</option>)}</select></label>
     <button type="button" className={styles.secondaryButton} onClick={()=>void placeOrMoveByKeyboard()} disabled={busy||!targetSlots.includes(targetSlot)}>{selectedWaiting?'จัดเก็บ':'ย้ายตำแหน่ง'}</button>
     <button type="button" className={styles.textButton} onClick={()=>{setSelectedWaiting(null);setSelectedPosition(null);}}>ยกเลิก</button>
    </section>}
   </main>

   <aside className={styles.waitingPanel}>
    <div className={styles.panelHeading}><div><h2>{query?'ผลค้นหาตัวอย่าง':'ตัวอย่างรอจัดเก็บ'}</h2><p>{loading?'กำลังค้นหา…':query?`${data?.total??0} รายการในผลค้นหา`:`${data?.total??0} รายการรอจัดเก็บ`}</p></div><button className={styles.smallIconButton} type="button" onClick={()=>setRefresh(value=>value+1)} aria-label="โหลดข้อมูลใหม่" disabled={loading}>↻</button></div>
    <div className={styles.waitingLegend}><span>ประเภทจัดเก็บ: <strong>{selectedType?TYPE_SHORT[selectedType]:TYPE_SHORT[activeType]}</strong></span><span>FIFO ตามเวลารับจริง</span></div>
    {selectedRows.length>0&&<div className={styles.selectionBar}><span>เลือกแล้ว {selectedRows.length} รายการ</span><button type="button" onClick={()=>setSelectedKeys([])}>ล้าง</button></div>}
    <div className={styles.sampleList} aria-label="รายการตัวอย่างค้นหา">
     {waitingRows.map(row=><article key={rowKey(row)} className={`${styles.sampleRow} ${row.waiting?styles.sampleWaiting:''}`} draggable={canWrite&&row.waiting&&row.storageType!=='LEGACY_UNCLASSIFIED'} onDragStart={event=>startWaitingDrag(event,row)} onDragEnd={finishDrag}>
      {canWrite&&row.waiting&&row.storageType!=='LEGACY_UNCLASSIFIED'?<input className={styles.sampleCheck} type="checkbox" aria-label={`เลือก ${row.storageLabel}`} checked={selectedKeys.includes(rowKey(row))} onChange={()=>toggleSelection(row)} />:<span className={styles.sampleMarker} aria-hidden="true">{row.waiting?'○':'▣'}</span>}
      <div className={styles.sampleContent}>
       <div className={styles.sampleTop}><strong className={styles.mono}>{row.storageLabel??`LN ${row.ln}`}</strong><span className={`${styles.typeBadge} ${row.storageType==='BUFFY_COAT'?styles.buffyBadge:row.storageType==='LEGACY_UNCLASSIFIED'?styles.legacyBadge:''}`}>{row.storageType==='LEGACY_UNCLASSIFIED'?'ข้อมูลเดิม':TYPE_SHORT[row.storageType]}</span></div>
       <span>LN {row.ln} · HN {row.hn??'—'}</span><small>LN Halos {row.lnHalos??'—'} · รอบ {row.roundNumber}</small>
       {row.waiting?<div className={styles.sampleActions}><button type="button" className={styles.textButton} onClick={()=>{setSelectedWaiting(row);setSelectedPosition(null);const target=visibleBoxes.find(box=>box.boxType===row.storageType&&box.nextSlot!==null);if(target){setTargetBoxId(target.id);setTargetSlot(target.nextSlot??1);}}} disabled={!canWrite}>เลือกเพื่อจัดเก็บ</button>{canPrint&&row.storageType!=='LEGACY_UNCLASSIFIED'&&<button type="button" className={styles.textButton} onClick={()=>printRowSample(row)} disabled={busy}>พิมพ์ฉลากตัวอย่าง</button>}<span>รอจัดเก็บ</span></div>:<div className={styles.sampleActions}><button type="button" className={styles.locationButton} onClick={()=>locateRow(row)}>{row.boxId} · {row.position}</button>{canPrint&&row.storageType!=='LEGACY_UNCLASSIFIED'&&<button type="button" className={styles.textButton} onClick={()=>printRowSample(row)} disabled={busy}>พิมพ์ฉลากตัวอย่าง</button>}{canPrint&&row.boxUuid&&<button type="button" className={styles.textButton} onClick={()=>void printBox(row.boxUuid!)} disabled={busy}>ฉลากกล่อง</button>}</div>}
      </div>
     </article>)}
     {!waitingRows.length&&!loading&&<p className={styles.emptyState}>ไม่พบตัวอย่างที่ตรงกับการค้นหา</p>}
     {loading&&!waitingRows.length&&<p className={styles.emptyState} role="status">กำลังโหลดรายการ…</p>}
    </div>
    {data&&data.total>25&&<Pager label="ตัวอย่างจัดเก็บ" page={data.page} pageSize={25} sizes={[25]} total={data.total} totalPages={data.totalPages} onPage={setPage} onSize={()=>{}}/>}
   </aside>
  </div>

  {autoPlan&&<div className={styles.dialogBackdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget){setAutoPlan(null);setAutoRoundIds(undefined);}}}>
   <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="storage-autofill-title">
    <div className={styles.dialogHeading}><div><h2 id="storage-autofill-title">Preview Auto-fill</h2><p>{autoPlan.storageTypes.map(type=>TYPE_LABEL[type]).join(' · ')} · FIFO ตามเวลารับตัวอย่าง</p></div><button type="button" className={styles.smallIconButton} onClick={()=>{setAutoPlan(null);setAutoRoundIds(undefined);}} aria-label="ปิด Preview">×</button></div>
    <dl className={styles.previewFacts}><div><dt>รายการรอทั้งหมด</dt><dd>{autoPlan.waiting}</dd></div><div><dt>ชุด FIFO นี้</dt><dd>{autoPlan.selected}</dd></div><div><dt>ตำแหน่งที่จัดได้</dt><dd>{autoPlan.planned}</dd></div><div><dt>รอเปิดกล่องเพิ่มในชุดนี้</dt><dd>{autoPlan.unplaced}</dd></div><div><dt>เหลือสำหรับชุดถัดไป</dt><dd>{autoPlan.remaining}</dd></div></dl>
    {autoPlan.planned>0?<div className={styles.previewList}><strong>ตำแหน่งที่เสนอ</strong><ul>{autoPlan.placements.slice(0,8).map((item,index)=><li key={`${item.roundId}:${item.storageType}:${index}`}><span>{item.storageLabel} · {TYPE_SHORT[item.storageType]}</span><span>{item.boxId} · {item.position}</span></li>)}</ul>{autoPlan.planned>8&&<p>และอีก {autoPlan.planned-8} ตำแหน่งตามลำดับ FIFO</p>}</div>:<p className={styles.emptyState}>{autoPlan.waiting?'ไม่มีช่องว่างในกล่องประเภทนี้ กรุณาเปิดกล่องใหม่ก่อน':'ไม่มีตัวอย่างรอจัดเก็บ'}</p>}
    <p className={styles.previewNote}>Preview แสดงตำแหน่งที่เสนอเรียงตาม FIFO ชุดละไม่เกิน {autoPlan.batchSize.toLocaleString('th-TH')} รายการ การบันทึกเกิดขึ้นเมื่อกดยืนยันเท่านั้น{autoPlan.remaining>0?` หลังยืนยันแล้วให้สร้าง Preview อีกครั้งเพื่อดำเนินการ ${autoPlan.remaining.toLocaleString('th-TH')} รายการที่เหลือ`:''}</p>
    <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={()=>{setAutoPlan(null);setAutoRoundIds(undefined);}}>ยกเลิก</button><button type="button" className={styles.confirmButton} onClick={()=>void confirmAutoFill()} disabled={busy||autoPlan.planned===0}>ยืนยันจัดเก็บ {autoPlan.planned} ตัวอย่าง</button></div>
   </section>
  </div>}
 </section>;
}
