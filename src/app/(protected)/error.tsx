"use client";
import {useRouter} from "next/navigation";
import {startTransition} from "react";
export default function ErrorPage({reset}:{reset:()=>void}){
 const router=useRouter();
 // The failure happens in a Server Component, so reset() alone only re-renders the cached error; refresh the server data first.
 const retry=()=>startTransition(()=>{router.refresh();reset();});
 return <section className="panel"><h1>ยังโหลดข้อมูลไม่ได้</h1><p role="alert">ระบบเชื่อมต่อข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง หากยังพบปัญหาให้แจ้งผู้ดูแล</p><button className="button" onClick={retry}>ลองอีกครั้ง</button></section>;
}
