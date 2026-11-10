"use client";
import {useState,type InputHTMLAttributes} from "react";

/** A password field with an eye button that shows or hides what was typed (Owner 2026-11-10). Same look as the login page. */
export function PasswordInput({label,...input}:{label:string}&Omit<InputHTMLAttributes<HTMLInputElement>,"type">){
 const [show,setShow]=useState(false);
 return <div className="password-field"><input {...input} type={show?"text":"password"}/>
  <button type="button" className="password-toggle" aria-label={show?`ซ่อน${label}`:`แสดง${label}`} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show
   ?<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.3 6.4C3.7 8.1 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
   :<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>}</button></div>;
}
