"use client";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useState} from "react";
export function Navigation({canSeeCases,canSeeSettings,canSeeDoctors=false}:{canSeeCases:boolean;canSeeSettings:boolean;canSeeDoctors?:boolean}){const path=usePathname();return <nav aria-label="เมนูหลัก">{[["/","ภาพรวม"],["/health","สถานะระบบ"],...(canSeeCases?[["/cases","ทะเบียนกลาง"]]:[]),...(canSeeDoctors?[["/doctors","ทะเบียนแพทย์จำลอง"]]:[]),...(canSeeSettings?[["/settings","ตั้งค่าระบบ"]]:[])].map(([href,label])=><Link key={href} href={href} aria-current={path===href?"page":undefined}>{label}</Link>)}</nav>;}
export function LogoutButton(){const router=useRouter();const [error,setError]=useState("");return <><button className="button secondary" onClick={async()=>{try{const me=await fetch("/api/me").then(r=>r.json());const r=await fetch("/api/auth/logout",{method:"POST",headers:{"x-csrf-token":me.csrf}});if(!r.ok)throw new Error();router.replace("/login");router.refresh();}catch{setError("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");}}}>ออกจากระบบ</button>{error&&<p role="alert">{error}</p>}</>;}
