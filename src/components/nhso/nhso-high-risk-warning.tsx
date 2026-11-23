"use client";
import {Dialog,Ln} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import type {NhsoRow} from "../../../packages/results/nhso-entry";
import type {PositiveKey} from "../../../packages/results/query";
import "../shared/console.css";
import "./nhso.css";

/** How each High Risk finding is named, the same names the result tables use. */
export const POSITIVE_LABEL:Record<PositiveKey,string>={t13:"Trisomy 13 High Risk",t18:"Trisomy 18 High Risk",t21:"Trisomy 21 High Risk",xo:"XO Detected",xxx:"XXX Detected",xxy:"XXY Detected",xyy:"XYY Detected"};

/** Owner 2026-11-23: opening a High Risk result on ลงผลสปสช. first shows this warning; "รับทราบ เปิดรายละเอียด" opens the details. */
export function NhsoHighRiskWarning({row,onCancel,onProceed}:{row:NhsoRow;onCancel:()=>void;onProceed:()=>void}){
 return <Dialog title="ผลตรวจผิดปกติ (High Risk)" onClose={onCancel}>
  <div className="nhso-warning" role="alert">
   <p className="nhso-warning-who"><span className="progress-badge tone-high-risk"><Icon name="alert"/>High Risk</span> LN <Ln value={row.ln}/>{row.name&&<> · {row.name}</>}</p>
   <p className="nhso-warning-found">พบ: {row.positive.map(k=>POSITIVE_LABEL[k]).join(", ")}</p>
   <p>โปรดตรวจสอบก่อนลงผลสปสช.</p>
  </div>
  <div className="row nhso-warning-actions">
   <button type="button" className="button secondary" onClick={onCancel}>ยกเลิก</button>
   <button type="button" className="button" autoFocus onClick={onProceed}>รับทราบ เปิดรายละเอียด</button>
  </div>
 </Dialog>;
}
