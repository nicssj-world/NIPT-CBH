"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useCallback,useEffect,useRef,useState} from "react";
import {labApi,failureText,bkk,LabFailure} from "../p4/lab-api";
import {csrf} from "../p2/shared";
import {BATCH_TEXT} from "./labels";
import {Pager} from "../shared/pager";

type BatchRow={id:string;state:string;table_name:string;row_count:number|null;error_code:string|null;created_at:string;submitted:number;promoted:number;needs_attention:number};
type Home={batches:BatchRow[];page:{number:number;size:number;total:number;totalPages:number};ready:boolean;maxRows:number;limits:{files:number}};

/** Step 1 of the bulk historical import: one table + the PDF / ZIP files. Everything else happens in the background and on the next page. */
export function HistoricalHome({canImport}:{canImport:boolean}){
 const router=useRouter();
 const [data,setData]=useState<Home|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [tableName,setTableName]=useState(""),[fileCount,setFileCount]=useState(0),[list,setList]=useState({page:1,pageSize:25});
 const table=useRef<HTMLInputElement>(null),files=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{try{setData(await labApi<Home>(`/api/p5h/batches?page=${list.page}&pageSize=${list.pageSize}`));setError("");}catch(e){setError(failureText(e));}},[list]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 async function upload(){
  const t=table.current?.files?.[0];if(!t){setError("เลือกไฟล์ตาราง (.xlsx หรือ .csv) ก่อน");return;}
  setBusy(true);setError("");
  try{
   const form=new FormData();form.set("table",t);for(const f of Array.from(files.current?.files??[]))form.append("files",f);form.set("idempotencyKey",crypto.randomUUID());
   const r=await fetch("/api/p5h/batches",{method:"POST",headers:{"x-csrf-token":csrf()},body:form});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new LabFailure(d.code??"REQUEST_FAILED",d.error??"อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง",d.details,r.status);
   router.push(`/historical/${d.batchId}`);
  }catch(e){setError(failureText(e));setBusy(false);}
 }
 return <>
  <h1>นำเข้าข้อมูลย้อนหลัง</h1>
  <p className="muted">ชุดละประมาณ 47 เคส — 3 ขั้นตอน: ① อัปโหลดตารางและ PDF → ② ตรวจสอบและแก้เฉพาะแถวที่มีปัญหา → ③ ผู้ตรวจอีกคนตรวจกับต้นฉบับแล้วยืนยันเป็นชุด ข้อมูลย้อนหลังไม่ถูกส่งไป HIS และไม่สร้างการรับรองผลใหม่</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {data&&!data.ready&&<div className="panel" role="status"><strong>ยังยืนยันนำเข้าข้อมูลเป็นชุดไม่ได้</strong><p>เกณฑ์หลักฐานและวันที่เริ่มใช้ระบบยังไม่มีข้อกำหนดที่ยืนยันแล้ว จึงตรวจและเตรียมข้อมูลได้ แต่ระบบยังไม่นำเข้ารายการใด</p></div>}
  <section className="panel" aria-labelledby="hist-upload"><h2 id="hist-upload">① อัปโหลด</h2>
   {canImport?<>
    <div className="form-grid">
     <div className="field"><label htmlFor="hist-table">ไฟล์ตาราง (Excel .xlsx หรือ CSV)</label><input id="hist-table" ref={table} type="file" accept=".xlsx,.csv" onChange={e=>setTableName(e.target.files?.[0]?.name??"")}/><p className="hint">{tableName||"ยังไม่ได้เลือกไฟล์"} · ไม่เกิน {data?.maxRows??100} แถว</p></div>
     <div className="field"><label htmlFor="hist-files">ไฟล์ PDF ผลเดิม (เลือกได้หลายไฟล์) หรือ ZIP</label><input id="hist-files" ref={files} type="file" accept=".pdf,.zip" multiple onChange={e=>setFileCount(e.target.files?.length??0)}/><p className="hint">{fileCount?`เลือกแล้ว ${fileCount} ไฟล์`:"ไม่บังคับ — ระบุชื่อไฟล์ในคอลัมน์ pdf_file หรือให้ระบบจับคู่ด้วย LN ใน PDF"} · สูงสุด {data?.limits.files??150} ไฟล์</p></div>
    </div>
    <div className="button-row"><button className="button" onClick={()=>void upload()} disabled={busy}>{busy?"กำลังอัปโหลด…":"อัปโหลดและตรวจสอบ"}</button><a className="button secondary" href="/api/p5h/template" download>ดาวน์โหลดแบบฟอร์มตาราง (CSV)</a></div>
    <p className="hint">ปีในตารางใช้ ค.ศ. รูปแบบ YYYY-MM-DD (ไม่ทราบวันที่ให้เว้นว่างหรือพิมพ์ unknown) ชื่อต้องเป็นข้อมูลจำลอง</p>
   </>:<p>บัญชีนี้ดูรายการได้ แต่ไม่มีสิทธิ์นำเข้า (ต้องมีสิทธิ์ HISTORICAL_ENTRY)</p>}
  </section>
  <section className="panel" aria-labelledby="hist-list"><h2 id="hist-list">ชุดนำเข้า</h2>
   {!data?<p role="status">กำลังโหลด…</p>:!data.page.total?<p>ยังไม่มีชุดนำเข้า</p>:<>
    <div className="table-wrap" role="region" aria-label="ชุดนำเข้าข้อมูลย้อนหลัง" tabIndex={0}><table className="data-table"><caption className="sr-only">ชุดนำเข้าข้อมูลย้อนหลัง</caption><thead><tr><th scope="col">ไฟล์ตาราง</th><th scope="col">สถานะ</th><th scope="col">แถว</th><th scope="col">ต้องแก้</th><th scope="col">รอรับรอง</th><th scope="col">นำเข้าแล้ว</th><th scope="col">อัปโหลดเมื่อ</th></tr></thead>
     <tbody>{data.batches.map(b=><tr key={b.id}><td><Link href={`/historical/${b.id}`}>{b.table_name}</Link></td><td>{BATCH_TEXT[b.state]??b.state}{b.error_code?` (${b.error_code})`:""}</td><td>{b.row_count??"—"}</td><td>{b.needs_attention}</td><td>{b.submitted}</td><td>{b.promoted}</td><td>{bkk(b.created_at)}</td></tr>)}</tbody></table></div>
    <Pager label="ชุดนำเข้าข้อมูลย้อนหลัง" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} onPage={n=>setList(l=>({...l,page:n}))} onSize={n=>setList({page:1,pageSize:n})}/></>}
  </section>
 </>;
}
