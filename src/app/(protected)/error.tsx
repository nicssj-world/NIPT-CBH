"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="panel"><h1>ยังโหลดข้อมูลไม่ได้</h1><p role="alert">ระบบเชื่อมต่อข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง หากยังพบปัญหาให้แจ้งผู้ดูแล</p><button className="button" onClick={reset}>ลองอีกครั้ง</button></section>;}
