import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {BatchStepper} from "../../src/components/p4/batch-stepper";
import type {StepKey,StepStatus} from "../../src/components/p4/bench-progress";

const st=(o:Partial<Record<StepKey,StepStatus>>={}):Record<StepKey,StepStatus>=>({TASK:{done:false,known:true},QC:{done:false,known:true},POOL:{done:false,known:true},SEQ:{done:false,known:true},...o});
const render=(current:StepKey,status=st(),onSelect?:(k:Exclude<StepKey,"TASK">)=>void)=>renderToStaticMarkup(createElement(BatchStepper,{batchId:"b1",current,status,onSelect}));

describe("Run step header",()=>{
 it("shows four steps in workflow order with Task List first",()=>{
  const html=render("TASK");
  const names=[...html.matchAll(/<strong>([^<]+)<\/strong>/g)].map(m=>m[1]);
  expect(names).toEqual(["Task List","QC Measurements","Pooling","Sequencing"]);
  expect([...html.matchAll(/ขั้นที่ (\d)/g)].map(m=>m[1])).toEqual(["1","2","3","4"]);
 });
 it("every step draws a real icon (no empty <path>)",()=>{
  const html=render("TASK",st({QC:{done:true,known:true}}));
  expect(html).not.toMatch(/<path\/>/);
  expect(html.match(/<path d="[^"]+"/g)).toHaveLength(4);
 });
 it("marks only the current step, names each step by its label and describes it with the status",()=>{
  const html=render("POOL",st({TASK:{done:true,known:true},QC:{done:true,known:true}}));
  expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-label="Pooling"[^>]*aria-describedby="run-step-b1-POOL"[^>]*aria-current="step"/);
  expect(html).toContain("ล็อกตำแหน่งครบแล้ว");
  expect(html).toContain("กำลังทำ");
 });
 it("links to the real pages: the Run page for Task List, the bench routes for the others",()=>{
  const html=render("TASK");
  expect(html).toContain('href="/lab/batches/b1"');expect(html).toContain('href="/lab/batches/b1/bench"');
  expect(html).toContain('href="/lab/batches/b1/pooling"');expect(html).toContain('href="/lab/batches/b1/sequencing"');
 });
 it("on the bench page the three bench steps are buttons (switch in place) and Task List stays a link",()=>{
  const html=render("QC",st(),()=>undefined);
  expect(html.match(/<button/g)).toHaveLength(3);expect(html.match(/<a /g)).toHaveLength(1);
 });
 it("unknown and loading statuses are stated, never shown as done",()=>{
  const html=render("TASK",st({QC:{done:false,known:false,pending:true},POOL:{done:true,known:false}}));
  expect(html).toContain("กำลังโหลดสถานะ…");expect(html).toContain("ไม่ทราบสถานะ");
  expect(html.match(/ บันทึกครบแล้ว/g)).toBeNull();
 });
});
