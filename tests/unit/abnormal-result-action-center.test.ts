import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {SampleActionCenter,actionCenterBody,presetReason,canCancelRepeat} from "../../src/components/p4/action-center";
import {QC_STAGE_LABEL} from "../../src/components/shared/qc-stages";
import {BOARD_REASON_TEXT} from "../../src/components/p5/labels";
import {reasonLabel} from "../../src/components/p5/release-board";

// Owner 2026-11-17: an abnormal result is repeated like any Re-xx; the stage is recorded for statistics. No step may be a dead end.
const subject=(attemptState:string)=>({attemptId:"00000000-0000-4000-8000-000000000001",caseId:"c",roundId:"r",hisLn:"2630970030",roundNumber:1,sampleId:"26B261105049-1",attemptState,overallOrdinal:1,attemptNumber:1});
const html=(attemptState:string)=>renderToStaticMarkup(createElement(SampleActionCenter,{subject:subject(attemptState),can:{repeat:true,redraw:true,noCall:true},onClose:()=>{},onDone:()=>{}}));
const radio=(markup:string,value:string)=>markup.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))![0];

describe("Sample Action Center — abnormal result",()=>{
 it("the stage list and the reasons offer it, in words",()=>{
  expect(QC_STAGE_LABEL.ABNORMAL_RESULT).toBe("ผลวิเคราะห์ผิดปกติ · หลัง Sequencing");
 });
 it("an analysed sample (report issued, not sent) can be repeated: Re-Library / Re-Extraction are enabled and say why",()=>{
  for(const state of ["AnalysisComplete","FinalQcAccepted"]){
   const m=html(state);
   for(const k of ["RE_LIBRARY","RE_EXTRACTION"])expect(radio(m,k)).not.toContain("disabled");
   expect(m).toContain("ผลผิดปกติ (ยังไม่ส่งผล) · ทำ Library ใหม่");expect(m).toContain("ผลผิดปกติ (ยังไม่ส่งผล) · สกัดใหม่");
  }
  // a sample in a batch keeps its ordinary wording
  expect(html("InProgress")).toContain("สิ่งส่งตรวจเดิม · ทำ Library ใหม่");
 });
 it("picking a repeat on an analysed sample preselects the abnormal reason; nothing else is preselected",()=>{
  expect(presetReason("FinalQcAccepted","RE_LIBRARY")).toBe("ABNORMAL_RESULT");
  expect(presetReason("AnalysisComplete","RE_EXTRACTION")).toBe("ABNORMAL_RESULT");
  expect(presetReason("FinalQcAccepted","RE_SAMPLING")).toBe("");
  expect(presetReason("InProgress","RE_LIBRARY")).toBe("");
 });
 it("the request carries stage ABNORMAL_RESULT for an analysed sample whatever the hidden stage state is, and the chosen stage for a live one",()=>{
  expect(actionCenterBody(subject("FinalQcAccepted"),"RE_LIBRARY","QC1","ABNORMAL_RESULT","")).toEqual({action:"actionCenter",attemptId:subject("x").attemptId,kind:"RE_LIBRARY",stage:"ABNORMAL_RESULT",reasonCode:"ABNORMAL_RESULT"});
  expect(actionCenterBody(subject("InProgress"),"RE_EXTRACTION","ABNORMAL_RESULT","ABNORMAL_RESULT"," note ")).toEqual({action:"actionCenter",attemptId:subject("x").attemptId,kind:"RE_EXTRACTION",stage:"ABNORMAL_RESULT",reasonCode:"ABNORMAL_RESULT",note:"note"});
  expect(actionCenterBody(subject("InProgress"),"RE_LIBRARY","QC2","LIBRARY_FAILURE","")).toMatchObject({stage:"QC2"});
  // Re-Sampling never sends a stage
  expect(actionCenterBody(subject("FinalQcAccepted"),"RE_SAMPLING","QC1","OTHER","")).not.toHaveProperty("stage");
 });
 it("ยกเลิกคำสั่งตรวจซ้ำ is offered only on a repeat that still waits for a Task List",()=>{
  const repeatSubject=(attemptState:string,state:string|null)=>({...subject(attemptState),repeat:{level:"RE_LIBRARY",state}});
  expect(canCancelRepeat(repeatSubject("Ready","RepeatPendingBatch"))).toBe(true);
  expect(canCancelRepeat(repeatSubject("Ready","RepeatRequested"))).toBe(true);
  expect(canCancelRepeat(repeatSubject("Assigned","RepeatInProgress"))).toBe(false);
  expect(canCancelRepeat({...subject("Ready"),repeat:null})).toBe(false);
  const m=renderToStaticMarkup(createElement(SampleActionCenter,{subject:repeatSubject("Ready","RepeatPendingBatch"),can:{repeat:true,redraw:true,noCall:true},onClose:()=>{},onDone:()=>{}}));
  expect(m).toContain("ยกเลิกคำสั่งตรวจซ้ำ");expect(m).toContain("ยังไม่ลง Task List");
  expect(html("Ready")).not.toContain("ยกเลิกคำสั่งตรวจซ้ำ");
 });
 it("the left-over report says in words what to do on the results board",()=>{
  expect(BOARD_REASON_TEXT.ATTEMPT_REPEATED).toContain("ทิ้งรายการนี้");
  expect(reasonLabel("ATTEMPT_REPEATED")).toBe(BOARD_REASON_TEXT.ATTEMPT_REPEATED);
 });
});
