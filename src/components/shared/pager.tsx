"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useId,useState,type ReactNode} from "react";

/** Shared pager for every paginated list. It never decides what is shown: the server answers one page and reports the total, this
 * only renders "แสดง X–Y จาก Z", page-size choice, first/previous/next/last and a jump-to-page box.
 * Two modes, same markup: state mode (client lists: callbacks) and URL mode (server-rendered pages: ordinary links, deep-linkable). */
export const PAGER_SIZES=[25,50,100] as const;
type Common={page:number;pageSize:number;total:number;totalPages:number;label:string;sizes?:readonly number[];busy?:boolean;pageParam?:string;sizeParam?:string};
export type PagerProps=Common&({onPage:(page:number)=>void;onSize:(size:number)=>void;basePath?:undefined;params?:undefined}|{basePath:string;params:Record<string,string|undefined>;onPage?:undefined;onSize?:undefined});

export function pagerRange(page:number,pageSize:number,total:number){return total===0?{from:0,to:0}:{from:(page-1)*pageSize+1,to:Math.min(total,page*pageSize)};}

export function Pager(p:PagerProps){
 const router=useRouter(),sizeId=useId(),jumpId=useId(),sizes=p.sizes??PAGER_SIZES;
 const [jump,setJump]=useState("");
 const href=(page:number,size=p.pageSize)=>{const q=new URLSearchParams();for(const [k,v] of Object.entries(p.params??{}))if(v)q.set(k,v);q.set(p.pageParam??"page",String(page));q.set(p.sizeParam??"pageSize",String(size));return `${p.basePath}?${q}`;};
 const go=(page:number)=>{const n=Math.min(Math.max(1,page),p.totalPages);if(p.onPage)p.onPage(n);else router.push(href(n));};
 const size=(n:number)=>{if(p.onSize)p.onSize(n);else router.push(href(1,n));};
 const {from,to}=pagerRange(p.page,p.pageSize,p.total),first=p.page<=1,last=p.page>=p.totalPages;
 const nav=(label:string,target:number,disabled:boolean,aria:string):ReactNode=>p.basePath&&!disabled
  ?<Link className="button secondary small" href={href(target)} aria-label={aria}>{label}</Link>
  :<button type="button" className="button secondary small" disabled={disabled||p.busy} onClick={()=>go(target)} aria-label={aria}>{label}</button>;
 return <nav className="pager" aria-label={`การแบ่งหน้า${p.label}`}>
  <p className="pager-summary" role="status" aria-live="polite">{p.total===0?"ไม่มีรายการ":`แสดง ${from}–${to} จาก ${p.total} รายการ · หน้า ${p.page} จาก ${p.totalPages}`}</p>
  <div className="pager-controls">
   <label className="pager-size" htmlFor={sizeId}>แสดงต่อหน้า<select id={sizeId} aria-label="แสดงต่อหน้า" value={p.pageSize} disabled={p.busy} onChange={e=>size(Number(e.target.value))}>{sizes.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
   <div className="pager-buttons">
    {nav("«",1,first,"หน้าแรก")}{nav("ก่อนหน้า",p.page-1,first,"หน้าก่อนหน้า")}{nav("ถัดไป",p.page+1,last,"หน้าถัดไป")}{nav("»",p.totalPages,last,"หน้าสุดท้าย")}
   </div>
   {p.totalPages>3&&<form className="pager-jump" onSubmit={e=>{e.preventDefault();const n=Number(jump);if(Number.isInteger(n)&&n>=1&&n<=p.totalPages){go(n);setJump("");}}}>
    <label htmlFor={jumpId}>ไปหน้า</label><input id={jumpId} type="number" inputMode="numeric" min={1} max={p.totalPages} value={jump} onChange={e=>setJump(e.target.value)} aria-describedby={`${jumpId}-of`}/>
    <span id={`${jumpId}-of`} className="muted">จาก {p.totalPages}</span><button type="submit" className="button secondary small" disabled={p.busy}>ไป</button></form>}
  </div>
 </nav>;
}
