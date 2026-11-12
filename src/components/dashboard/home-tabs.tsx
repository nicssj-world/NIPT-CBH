"use client";
import {useEffect,useId,useRef,useState,type KeyboardEvent,type ReactNode} from "react";
import "./dashboard.css";

export type HomeTab={id:string;label:string;content:ReactNode};

/**
 * Overview / statistics tabs on the home dashboards. Only the open tab is rendered. The open tab is kept in the URL hash (no patient data),
 * so a reload or a link returns to the same tab. Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
 */
export function HomeTabs({tabs,label}:{tabs:HomeTab[];label:string}){
 const base=useId(),[open,setOpen]=useState(tabs[0].id),refs=useRef<Record<string,HTMLButtonElement|null>>({});
 useEffect(()=>{const t=setTimeout(()=>{const h=window.location.hash.slice(1);if(tabs.some(x=>x.id===h))setOpen(h);},0);return()=>clearTimeout(t);},[tabs]);
 const choose=(id:string,focus=false)=>{setOpen(id);try{history.replaceState(null,"",id===tabs[0].id?window.location.pathname+window.location.search:`#${id}`);}catch{/* hash is a convenience only */}if(focus)refs.current[id]?.focus();};
 const onKey=(e:KeyboardEvent)=>{const i=tabs.findIndex(t=>t.id===open),n=tabs.length;
  const to=e.key==="ArrowRight"?(i+1)%n:e.key==="ArrowLeft"?(i-1+n)%n:e.key==="Home"?0:e.key==="End"?n-1:-1;
  if(to>=0){e.preventDefault();choose(tabs[to].id,true);}};
 const current=tabs.find(t=>t.id===open)??tabs[0];
 if(tabs.length===1)return <>{current.content}</>;
 return <>
  <div className="home-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>{tabs.map(t=><button key={t.id} ref={el=>{refs.current[t.id]=el;}} type="button" role="tab" id={`${base}-${t.id}`} aria-selected={t.id===current.id} aria-controls={`${base}-p-${t.id}`} tabIndex={t.id===current.id?0:-1} className="home-tab" onClick={()=>choose(t.id)}>{t.label}</button>)}</div>
  <div className="home-tabpanel" role="tabpanel" id={`${base}-p-${current.id}`} aria-labelledby={`${base}-${current.id}`}>{current.content}</div>
 </>;
}
