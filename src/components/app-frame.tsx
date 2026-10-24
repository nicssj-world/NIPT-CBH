/* eslint-disable @next/next/no-img-element -- static brand assets; next/image injects an inline style attribute that the CSP (style-src nonce) blocks */
"use client";

import {useRef, useSyncExternalStore} from "react";
import {InputSafety} from "./shared/input-safety";
import {usePathname} from "next/navigation";
import {LogoutButton} from "./navigation";

const routeNames:Record<string,string>={"/":"ภาพรวม","/cases":"ทะเบียนกลาง","/inbound":"รับใบสั่งจาก HIS","/lab":"งาน Lab","/lab/batches":"Batch / Task List","/sample-storage":"Sample Storage","/results":"ผลตรวจ NIPT","/historical":"นำเข้าย้อนหลัง","/doctors":"ทะเบียนแพทย์","/settings":"ตั้งค่าระบบ","/health":"สถานะระบบ"};

function subscribeTheme(notify:()=>void){window.addEventListener("nipt-theme-change",notify);return ()=>window.removeEventListener("nipt-theme-change",notify);}
export function ThemeButton(){
 const dark=useSyncExternalStore(subscribeTheme,()=>document.documentElement.dataset.theme==="dark",()=>false);
 return <button type="button" className="theme-button" aria-label={dark?"เปลี่ยนเป็นธีมสว่าง":"เปลี่ยนเป็นธีมมืด"} aria-pressed={dark} onClick={()=>{document.documentElement.dataset.theme=dark?"light":"dark";window.dispatchEvent(new Event("nipt-theme-change"));}}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{dark?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>}</svg></button>;
}

export function AppFrame({sidebar,ancNavigation,ancUserName,ancWorkspace=false,children}:{sidebar:React.ReactNode;ancNavigation?:React.ReactNode;ancUserName?:string;ancWorkspace?:boolean;children:React.ReactNode}){
 const menu=useRef<HTMLDialogElement>(null);
 const path=usePathname();
 const route=Object.keys(routeNames).sort((a,b)=>b.length-a.length).find(key=>path===key||(key!=="/"&&path.startsWith(key+"/")))??"/";
 const casesPath=path==="/cases"||path.startsWith("/cases/"),doctorsPath=path==="/doctors";
 const overviewPath=path==="/";
 const isAncPage=ancWorkspace&&(overviewPath||casesPath||doctorsPath);
 if(isAncPage)return <div className="app-shell anc-shell"><InputSafety/><div className="anc-shell-content"><header className="app-topbar anc-topbar"><div className="anc-brand"><img src="/brand/ui-logo.png" width="40" height="40" alt=""/><strong>NIPT-CBH</strong></div><div className="anc-navigation-slot">{ancNavigation}</div><div className="anc-account"><div className="anc-identity"><span>ผู้ใช้งาน</span><strong title={ancUserName??"บัญชีผู้ใช้"}>{ancUserName??"บัญชีผู้ใช้"}</strong></div><ThemeButton/><LogoutButton/></div></header><div className="shell-content">{children}</div></div></div>;
 return <div className="app-shell"><InputSafety/><aside className="sidebar desktop-sidebar">{sidebar}</aside><div className="shell-content"><header className="app-topbar"><div className="topbar-context"><button type="button" className="mobile-menu-button" aria-label="เปิดเมนูหลัก" aria-haspopup="dialog" onClick={()=>menu.current?.showModal()}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><img className="mobile-product-logo" src="/brand/ui-logo.png" width="30" height="30" alt="NIPT-CBH"/><strong>{routeNames[route]}</strong><span className="muted">ระบบปฏิบัติงาน NIPT</span></div><div className="row"><ThemeButton/>{/* Supplied hospital artwork has its original 3:2 ratio. */}<img className="hospital-logo" src="/brand/hospital.png" width="66" height="44" alt="โรงพยาบาลชลบุรี"/></div></header>{children}</div><dialog ref={menu} className="mobile-navigation" aria-label="เมนูหลัก"><div className="mobile-menu-heading"><strong>เมนูหลัก</strong><button type="button" className="button secondary small" onClick={()=>menu.current?.close()}>ปิดเมนู</button></div><aside className="sidebar" onClick={event=>{if((event.target as HTMLElement).closest("a"))menu.current?.close();}}>{sidebar}</aside></dialog></div>;
}
