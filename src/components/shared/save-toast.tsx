"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {SAVE_NOTICE_EVENT} from "./save-notice";
import styles from "./save-toast.module.css";

/** Manual popover stays visible above native form dialogs without taking focus. */
export function SaveToast(){
 const [notice,setNotice]=useState(0),[paused,setPaused]=useState(false),[container,setContainer]=useState<Element|null>(null),host=useRef<HTMLDivElement>(null);
 useEffect(()=>{let sequence=0;const locate=()=>{const dialogs=document.querySelectorAll('dialog:modal');setContainer(dialogs.item(dialogs.length-1)??document.body);};const saved=()=>{locate();setPaused(false);setNotice(++sequence);};locate();const observer=new MutationObserver(locate);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["open"]});window.addEventListener(SAVE_NOTICE_EVENT,saved);return()=>{observer.disconnect();window.removeEventListener(SAVE_NOTICE_EVENT,saved);};},[]);
 useLayoutEffect(()=>{const el=host.current;if(!el?.isConnected)return;if(notice){el.showPopover();}else if(el.matches(":popover-open")){el.hidePopover();}},[notice,container]);
 useEffect(()=>{if(!notice||paused)return;const timer=setTimeout(()=>setNotice(0),3000);return()=>clearTimeout(timer);},[notice,paused]);
 return container?createPortal(<div ref={host} popover="manual" className={styles.toast} role="status" aria-live="polite" aria-atomic="true"
  onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocusCapture={()=>setPaused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false);}}>
  {notice>0&&<><svg className={styles.check} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg><span key={notice}>บันทึกสำเร็จ</span><button type="button" className={styles.close} aria-label="ปิดแจ้งเตือนบันทึกสำเร็จ" onClick={()=>setNotice(0)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></>}
 </div>,container):null;
}
