"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
export function LoginForm(){
 const [csrf,setCsrf]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[show,setShow]=useState(false);const router=useRouter();
 useEffect(()=>{fetch("/api/auth/csrf").then(async r=>{if(!r.ok)throw new Error();setCsrf((await r.json()).csrf);}).catch(()=>setError("เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้านี้ใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแล"));},[]);
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const values=new FormData(e.currentTarget);
  try{const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:values.get("username"),password:values.get("password"),csrf})});const data=await r.json();if(!r.ok){setError(data.error);return;}router.replace("/");router.refresh();}
  catch{setError("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง");}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="stack"><div><label htmlFor="username">ชื่อผู้ใช้</label><input id="username" name="username" autoComplete="username" required maxLength={64} autoCapitalize="none" spellCheck={false}/></div><div><label htmlFor="password">รหัสผ่าน</label><input id="password" name="password" type={show?"text":"password"} autoComplete="current-password" required maxLength={128}/><label className="check-label"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>แสดงรหัสผ่าน</label></div><div aria-live="polite">{error&&<p role="alert" className="notice">{error}</p>}</div><button className="button" disabled={!csrf||busy}>{busy?"กำลังเข้าสู่ระบบ…":"เข้าสู่ระบบ"}</button></form>;
}
