"use client";
import {useEffect,useRef,useState} from "react";
import {Dialog} from "../p2/shared";
import {labApi,failureText} from "./lab-api";

type Sample={roundId:string;hisLn:string;lnHalos:string|null;labelCode:string|null;roundNumber:number;printed:number};
/**
 * Owner Lock §5 tube labels: 4 stickers (50 × 20 mm) / 8 halves per sample, LN Halos over `LN: <HIS LN>`, no barcode.
 * The preview and the printed sheet are the same server HTML; printing creates an audited job first and never issues a number.
 */
export function LabelDialog({samples,onClose,onPrinted}:{samples:Sample[];onClose:()=>void;onPrinted?:()=>void}){
 const [includeName,setIncludeName]=useState(false),[reason,setReason]=useState(""),[sheet,setSheet]=useState<string|null>(null),[mode,setMode]=useState<"preview"|"print">("preview"),[busy,setBusy]=useState(true),[error,setError]=useState(""),[done,setDone]=useState("");
 const frame=useRef<HTMLIFrameElement>(null);
 const reprint=samples.some(s=>s.printed>0);
 const body=(name=includeName)=>({roundIds:samples.map(s=>s.roundId),includeName:name,...(reprint&&reason.trim()?{reason:reason.trim()}:{})});
 const fetchPreview=(name:boolean)=>labApi<{sheetId:string}>("/api/p4/labels",{action:"preview",...body(name)});
 useEffect(()=>{let live=true;fetchPreview(false).then(r=>{if(live)setSheet(r.sheetId);}).catch(e=>{if(live)setError(failureText(e));}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function changeName(name:boolean){setIncludeName(name);setBusy(true);setError("");try{setSheet((await fetchPreview(name)).sheetId);setMode("preview");}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 async function print(){setBusy(true);setError("");try{const r=await labApi<{sheetId:string;kind:string}>("/api/p4/labels",{action:"print",...body()});setMode("print");setSheet(r.sheetId);setDone(r.kind==="REPRINT"?"บันทึกการพิมพ์ซ้ำแล้ว — เลข LN Halos เดิม":"บันทึกการพิมพ์แล้ว");onPrinted?.();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 return <Dialog title={`พิมพ์ฉลากหลอด ${samples.length} ตัวอย่าง`} onClose={onClose}>
  <div className="stack">
   <p className="help">หนึ่งตัวอย่าง = 4 ดวง (50 × 20 มม.) แบ่ง 8 ช่อง: (BASE,BASE) (BASE,BASE) (BASE,BASE-1) (BASE-2,BASE-3) — ไม่มีบาร์โค้ด/QR · การพิมพ์และพิมพ์ซ้ำไม่ออกเลขใหม่</p>
   <ul className="label-list" aria-label="ตัวอย่างที่จะพิมพ์">{samples.map(s=><li key={s.roundId}><span className="mono strong">{s.labelCode??s.lnHalos??"ยังไม่มี LN Halos"}</span> · LN {s.hisLn} · รอบที่ {s.roundNumber}{s.printed>0?<span className="badge warning">เคยพิมพ์ {s.printed} ครั้ง</span>:null}</li>)}</ul>
   <label className="check-label"><input type="checkbox" checked={includeName} onChange={e=>changeName(e.target.checked)} disabled={busy||mode==="print"}/> พิมพ์ชื่อผู้รับบริการจำลองบรรทัดที่ 3 (เฉพาะที่มีสิทธิ์เห็น)</label>
   {reprint&&<div><label htmlFor="reprint-reason">เหตุผลการพิมพ์ซ้ำ (จำเป็น)</label><input id="reprint-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} aria-describedby="reprint-help"/><p id="reprint-help" className="help">อย่างน้อย 8 ตัวอักษร เช่น สติ๊กเกอร์เสียหาย</p></div>}
   <p className="notice">ยังไม่ได้ทดสอบกับเครื่องพิมพ์ฉลากจริง (Q-I7) — ตรวจขนาด/ตำแหน่งตัดกับกระดาษจริงก่อนใช้งานจริง</p>
   {error&&<p className="notice" role="alert">{error}</p>}{done&&<p className="notice success" role="status">{done}</p>}
   <div className="label-preview">{sheet?<iframe ref={frame} key={sheet} title={mode==="print"?"แผ่นฉลากสำหรับพิมพ์":"ตัวอย่างฉลากก่อนพิมพ์"} src={`/api/p4/label-sheet/${sheet}`} onLoad={()=>{if(mode==="print")frame.current?.contentWindow?.print();}}/>:<p className="help">{busy?"กำลังเตรียมตัวอย่างฉลาก…":"ไม่มีตัวอย่าง"}</p>}</div>
   <div className="dialog-actions"><button className="button" type="button" disabled={busy||mode==="print"||(reprint&&reason.trim().length<8)} onClick={print}>{reprint?"บันทึกและพิมพ์ซ้ำ":"บันทึกและพิมพ์"}</button><button className="button secondary" type="button" onClick={onClose}>ปิด</button></div>
  </div>
 </Dialog>;
}
