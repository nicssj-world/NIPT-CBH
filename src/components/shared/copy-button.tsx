"use client";
import {useEffect,useRef,useState} from "react";
import {LabIcon} from "./lab-icons";
import "./copy-button.css";

/** Clipboard write that also works on a plain-HTTP hospital LAN origin, where navigator.clipboard is unavailable. */
export async function copyText(text:string):Promise<boolean>{
 try{if(typeof navigator!=="undefined"&&navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true;}}catch{/* fall through to the textarea route */}
 try{
  const area=document.createElement("textarea");area.value=text;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";area.style.pointerEvents="none";
  document.body.appendChild(area);area.select();const ok=document.execCommand("copy");area.remove();return ok;
 }catch{return false;}
}

/**
 * Icon button that copies one value. After a copy it turns into a check mark with the word "คัดลอกแล้ว" and stays that way for the
 * life of the component (so the user can see which values were already typed into the other system); the live region announces it once.
 * `value` null means nothing to copy: the button is disabled and says so.
 */
export function CopyButton({label,value,onCopied}:{label:string;value:string|null;onCopied?:()=>void}){
 const [state,setState]=useState<"idle"|"copied"|"failed">("idle"),[flash,setFlash]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const copy=async()=>{
  if(value===null)return;
  const ok=await copyText(value);setState(ok?"copied":"failed");setFlash(true);
  if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setFlash(false),1800);
  if(ok)onCopied?.();
 };
 const copied=state==="copied";
 return <span className="copy-wrap">
  <button type="button" className={"icon-btn copy-btn"+(copied?" copied":"")+(state==="failed"?" failed":"")} disabled={value===null}
   aria-label={value===null?`${label} — ไม่มีข้อมูลให้คัดลอก`:copied?`${label} — คัดลอกแล้ว (กดเพื่อคัดลอกอีกครั้ง)`:`คัดลอก${label}`} title={copied?"คัดลอกแล้ว":`คัดลอก${label}`} onClick={()=>void copy()}>
   <LabIcon name={copied?"check":state==="failed"?"alert":"copy"} size={20}/>
  </button>
  <span className={"copy-hint"+(flash?" show":"")+(state==="failed"?" failed":"")} role="status">{flash?(state==="failed"?"คัดลอกไม่สำเร็จ":"คัดลอกแล้ว"):""}</span>
 </span>;
}
