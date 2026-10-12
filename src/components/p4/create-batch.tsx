"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {labApi,failureText} from "./lab-api";
/** Legacy parity: returns the single Draft batch if one exists, otherwise issues the next RunNNN/YYYY. */
export function CreateBatchButton(){
 const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState("");
 return <><button className="button" type="button" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const r=await labApi<{batchId:string}>("/api/p4/batches",{});router.push(`/lab/batches/${r.batchId}`);}catch(e){setError(failureText(e));setBusy(false);}}}>สร้าง/เปิด Batch ร่าง</button>{error&&<p className="notice" role="alert">{error}</p>}</>;
}
