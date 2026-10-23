'use client';
import {useEffect,useState} from 'react';
import {labApi,failureText} from './p4/lab-api';
import {Pager} from './shared/pager';
import {PdfPreview} from './shared/pdf-preview';
import type {storageSearch} from '../../packages/lab/sample-storage';
type Data=Awaited<ReturnType<typeof storageSearch>>;
export function SampleStorage({canWrite,canPrint}:{canWrite:boolean;canPrint:boolean}){
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[box,setBox]=useState(''),[slot,setSlot]=useState('1'),[preview,setPreview]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let current=true;const timer=setTimeout(()=>{labApi<Data>(`/api/sample-storage?${new URLSearchParams({q,page:String(page)})}`).then(d=>{if(current){setData(d);setError('');}}).catch(e=>{if(current)setError(failureText(e));});},250);return()=>{current=false;clearTimeout(timer);};},[q,page,refresh]);
 async function run(body:Record<string,unknown>){setBusy(true);setError('');try{await labApi('/api/sample-storage',body);setRefresh(n=>n+1);}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 return <section className="panel"><h1>จัดเก็บตัวอย่าง</h1><label>ค้นหา LN / HN / LN Halos / Box ID<input type="search" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} autoComplete="off"/></label>{error&&<p role="alert" className="form-error">{error}</p>}
 {canWrite&&<div className="action-bar"><button type="button" className="button secondary" disabled={busy} onClick={()=>void run({action:'createBox'})}>เปิดกล่องใหม่</button><label>กล่อง<select value={box} onChange={e=>setBox(e.target.value)}><option value="">เลือกกล่อง</option>{data?.boxes.map(b=><option key={b.id} value={b.id}>{b.box_id} ({b.used}/81)</option>)}</select></label><label>ตำแหน่ง<select value={slot} onChange={e=>setSlot(e.target.value)}>{Array.from({length:81},(_,i)=><option key={i} value={i+1}>{'ABCDEFGHI'[i%9]}{Math.floor(i/9)+1}</option>)}</select></label>{canPrint&&box&&<button type="button" className="button secondary" onClick={()=>setPreview('/api/sample-storage?label='+box)}>พิมพ์ / พิมพ์ซ้ำฉลากกล่อง</button>}</div>}
 {data?<><div className="table-wrap" role="region" aria-label="ตำแหน่งจัดเก็บตัวอย่าง" tabIndex={0}><table className="data-table"><thead><tr>{['LN','HN','LN Halos','รอบที่','Box ID','ตำแหน่ง','จัดเก็บ'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.round_id}><td>{r.ln}</td><td>{r.hn}</td><td>{r.ln_halos??'—'}</td><td>{r.round_number}</td><td>{r.box_id??'ยังไม่จัดเก็บ'}</td><td>{r.position??'—'}</td><td>{canWrite&&!r.box_id&&<button type="button" className="button secondary small" disabled={busy||!box} onClick={()=>void run({action:'store',roundId:r.round_id,boxId:box,slot:Number(slot)})}>จัดเก็บ LN {r.ln}</button>}{canPrint&&r.box_id&&<button type="button" className="button secondary small" onClick={()=>{if(r.box_uuid)setPreview('/api/sample-storage?label='+r.box_uuid);}}>ฉลาก {r.box_id}</button>}</td></tr>)}</tbody></table></div><Pager label="ตัวอย่างจัดเก็บ" page={data.page} pageSize={25} total={data.total} totalPages={data.totalPages} onPage={setPage} onSize={()=>{}}/></>:<p role="status">กำลังค้นหา…</p>}
 {preview&&<PdfPreview src={preview} title="ฉลากกล่องจัดเก็บ" onClose={()=>setPreview('')}/>}
 </section>;
}
