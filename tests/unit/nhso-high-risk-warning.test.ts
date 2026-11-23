import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {NhsoHighRiskWarning,POSITIVE_LABEL} from "../../src/components/nhso/nhso-high-risk-warning";
import type {NhsoRow} from "../../packages/results/nhso-entry";

// Owner 2026-11-23: on ลงผลสปสช. a High Risk result shows a warning (which findings) before its details open; only LN opens it.
const row=(positive:NhsoRow["positive"]):NhsoRow=>({resultId:"r",caseId:"c",ln:"2630970030",lnHalos:null,hn:"1",name:"SYNTHETIC PATIENT",certifiedAt:"2026-11-20T03:00:00.000Z",reissued:false,positive,entitlement:"NHSO",entry:null});

describe("ลงผลสปสช. — High Risk warning",()=>{
 it("names the result, every finding, and the two choices",()=>{
  const m=renderToStaticMarkup(createElement(NhsoHighRiskWarning,{row:row(["t21","xo"]),onCancel:()=>{},onProceed:()=>{}}));
  expect(m).toContain("ผลตรวจผิดปกติ (High Risk)");
  expect(m).toContain("SYNTHETIC PATIENT");
  expect(m).toContain("พบ: Trisomy 21 High Risk, XO Detected");
  expect(m).toContain("โปรดตรวจสอบก่อนลงผลสปสช.");
  expect(m).toContain(">ยกเลิก<");expect(m).toContain(">รับทราบ เปิดรายละเอียด<");
 });
 it("has a name for every finding",()=>{
  expect(Object.keys(POSITIVE_LABEL).sort()).toEqual(["t13","t18","t21","xo","xxx","xxy","xyy"]);
 });
 it("the board sends a High Risk row to the warning first and shows the badge; the name stays plain text",()=>{
  const src=readFileSync("src/components/nhso/nhso-board.tsx","utf8");
  expect(src).toContain("const openRow=(r:NhsoRow)=>{if(r.positive.length)setWarn(r);else setOpen(r);}");
  expect(src).toContain("onClick={()=>openRow(r)}");
  expect(src).not.toContain("onClick={()=>setOpen(r)}");
  expect(src).toContain("onProceed={()=>{const r=warn;setWarn(null);setOpen(r);}}");
  expect(src).toMatch(/r\.positive\.length>0&&<span className="progress-badge tone-high-risk">/);
 });
});
