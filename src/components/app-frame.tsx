"use client";
import Image from "next/image";

import {useRef, useSyncExternalStore} from "react";
import {usePathname} from "next/navigation";

const routeNames:Record<string,string>={"/":"ภาพรวม","/cases":"ทะเบียนกลาง","/inbound":"รับใบสั่งจาก HIS","/lab":"งาน Lab","/lab/batches":"Batch / Task List","/results":"ผลตรวจ NIPT","/historical":"นำเข้าย้อนหลัง","/doctors":"ทะเบียนแพทย์จำลอง","/settings":"ตั้งค่าระบบ","/health":"สถานะระบบ"};

function subscribeTheme(notify:()=>void){window.addEventListener("nipt-theme-change",notify);return ()=>window.removeEventListener("nipt-theme-change",notify);}
export function ThemeButton(){
 const dark=useSyncExternalStore(subscribeTheme,()=>document.documentElement.dataset.theme==="dark",()=>false);
 return <button type="button" className="theme-button" aria-label={dark?"เปลี่ยนเป็นธีมสว่าง":"เปลี่ยนเป็นธีมมืด"} aria-pressed={dark} onClick={()=>{document.documentElement.dataset.theme=dark?"light":"dark";window.dispatchEvent(new Event("nipt-theme-change"));}}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{dark?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>}</svg></button>;
}

export function AppFrame({sidebar,children}:{sidebar:React.ReactNode;children:React.ReactNode}){
 const menu=useRef<HTMLDialogElement>(null);
 const path=usePathname();
 const route=Object.keys(routeNames).sort((a,b)=>b.length-a.length).find(key=>path===key||(key!=="/"&&path.startsWith(key+"/")))??"/";
 return <div className="app-shell"><aside className="sidebar desktop-sidebar">{sidebar}</aside><div className="shell-content"><header className="app-topbar"><div className="topbar-context"><button type="button" className="mobile-menu-button" aria-label="เปิดเมนูหลัก" aria-haspopup="dialog" onClick={()=>menu.current?.showModal()}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><Image unoptimized className="mobile-product-logo" src="/brand/ui-logo.png" width="30" height="30" alt="NIPT-CBH"/><strong>{routeNames[route]}</strong><span className="muted">ระบบปฏิบัติงาน NIPT</span></div><div className="row"><ThemeButton/>{/* Supplied hospital artwork has its original 3:2 ratio. */}<Image unoptimized className="hospital-logo" src="/brand/hospital.png" width="66" height="44" alt="โรงพยาบาลชลบุรี"/></div></header>{children}</div><dialog ref={menu} className="mobile-navigation" aria-label="เมนูหลัก"><div className="mobile-menu-heading"><strong>เมนูหลัก</strong><button type="button" className="button secondary small" onClick={()=>menu.current?.close()}>ปิดเมนู</button></div><aside className="sidebar" onClick={event=>{if((event.target as HTMLElement).closest("a"))menu.current?.close();}}>{sidebar}</aside></dialog></div>;
}
