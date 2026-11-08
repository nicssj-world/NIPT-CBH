"use client";
import {useState} from "react";
import {createPortal} from "react-dom";
import {Dialog,Ln} from "../p2/shared";
import {CaseActionIcon} from "../shared/case-action-icon";
import {AncResults} from "./anc-results";

/**
 * "ดูผลตรวจ" (Owner 2026-11-09): opens only the NIPT result panel, exactly as in the full case page (same component, so the same
 * table, supplementary values and the three buttons เปิดรายงาน PDF / ดาวน์โหลด PDF / พิมพ์). Rows show it only where a result exists
 * (hasResult, which includes migrated historical results), never for a case that has none.
 */
export function ViewResultButton({caseId,ln,hn,name,className="button secondary"}:{caseId:string;ln:string;hn?:string|null;name?:string;className?:string}){
 const [open,setOpen]=useState(false);
 return <>
  <button type="button" className={className+" view-result-button"} aria-haspopup="dialog" onClick={()=>setOpen(true)}><CaseActionIcon released/> ดูผลตรวจ<span className="sr-only"> LN {ln}</span></button>
  {open&&createPortal(<Dialog title="ดูผลตรวจ" onClose={()=>setOpen(false)}><div className="result-popup">
   <p className="result-popup-id">{name&&<strong>{name}</strong>}{name&&" · "}HN {hn??"ยังไม่ยืนยัน"} · LN <Ln value={ln}/></p>
   <AncResults caseId={caseId}/>
  </div></Dialog>,document.body)}
 </>;
}
