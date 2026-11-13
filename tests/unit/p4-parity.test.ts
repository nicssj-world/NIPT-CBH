import {describe,it,expect} from "vitest";
import fc from "fast-check";
import * as legacy from "../fixtures/genomic-cbh/rules";
import * as lab from "../../packages/lab/rules";

// AT-IDPAR-01/04/05/06/08: same synthetic inputs through the vendored legacy source and the NIPT CBH port.
describe("Genomic-CBH identifier parity (vendored legacy oracle @44ce3f4)",()=>{
 it("LN Halos: Bangkok date, zero padding, 001/999 bounds and midnight rollover (AT-IDPAR-01)",()=>{
  expect(lab.formatLnHalos(5,new Date("2026-05-31T17:00:00.000Z"))).toBe("26B260601005");
  expect(lab.formatLnHalos(5,new Date("2026-05-31T16:59:59.000Z"))).toBe("26B260531005");
  expect(lab.formatLnHalos(1,new Date("2026-10-12T00:00:00+07:00"))).toBe("26B261012001");
  expect(lab.formatLnHalos(999,new Date("2026-12-31T23:59:59+07:00"))).toBe("26B261231999");
  expect(lab.formatLnHalos(1,new Date("2026-12-31T17:00:00Z"))).toBe("27B270101001");
  for(const bad of [0,1000,1.5,-1,Number.NaN])expect(()=>lab.formatLnHalos(bad)).toThrow();
  expect(lab.LN_HALOS_PATTERN.test("26B261012001")).toBe(true);
 });
 it("monthly continuation changes NNN only, retaining the legacy YYBYYMMDD rendering",()=>{
  expect(lab.formatLnHalos(10,new Date("2026-10-12T00:00:00+07:00"))).toBe("26B261012010");
  expect(lab.formatLnHalos(11,new Date("2026-10-14T00:00:00+07:00"))).toBe("26B261014011");
  expect(lab.formatLnHalos(42,new Date("2026-10-31T23:59:59+07:00"))).toBe("26B261031042");
  expect(lab.formatLnHalos(1,new Date("2026-11-01T00:00:00+07:00"))).toBe("26B261101001");
 });
 it("LN Halos is byte-identical to legacy for any sequence and instant (AT-IDPAR-08)",()=>{
  fc.assert(fc.property(fc.integer({min:1,max:999}),fc.date({min:new Date("2000-01-01T00:00:00Z"),max:new Date("2098-12-31T00:00:00Z"),noInvalidDate:true}),(n,d)=>lab.formatLnHalos(n,d)===legacy.formatLnHalos(n,d)),{numRuns:500});
 });
 it("run-type suffixes, twin D and Printed Sample ID keep the legacy formats (AT-IDPAR-03/04)",()=>{
  for(const t of ["Normal","Re-Library","Re-Sampling"] as const)expect(lab.formatRunSampleId("26B260601005",t)).toBe(legacy.formatRunSampleId("26B260601005",t));
  expect(lab.RUN_SUFFIX).toEqual(legacy.RUN_SUFFIX);
  expect(lab.effectiveLnHalos("26B260601005","Twins")).toBe("26B260601005D");
  expect(lab.effectiveLnHalos("26B260601005","Singleton")).toBe("26B260601005");
  expect(()=>lab.effectiveLnHalos("26B260601005D","Twins")).toThrow(); // base never carries D, so D is never doubled
  const base="26B260601005";
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0})).toBe("26B260601005-1");
  expect(lab.printedSampleId({base,pregnancy:"Twins",attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0})).toBe("26B260601005D-1");
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:2,repeatLevel:"RE_LIBRARY",earlierReLibraryCount:0})).toBe("26B260601005-2");
 });
 it("Task1 repeat rule; Owner 2026-11-13: the first round repeats up to attempt 3 (printed -3), a fourth attempt has no S1 ID",()=>{
  const base="26B260601005";
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:3,repeatLevel:"RE_LIBRARY",earlierReLibraryCount:1})).toBe(base+"-3");
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:3,repeatLevel:"RE_EXTRACTION",earlierReLibraryCount:0})).toBe(base+"-3");
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:4,repeatLevel:"RE_LIBRARY",earlierReLibraryCount:2})).toBeNull();
  expect(lab.printedSampleId({base,pregnancy:"Singleton",attemptNumber:2,repeatLevel:"RE_EXTRACTION",earlierReLibraryCount:0})).toBe(base+"-2");
 });
 it("control codes, printed control -1, PC1/NC25/Blank40, plate positions, sheets and run labels (AT-IDPAR-05/06)",()=>{
  for(const t of ["positive","negative","blank"] as const){expect(lab.formatControlCode(t,"2026-06-01")).toBe(legacy.formatControlCode(t,"2026-06-01"));expect(lab.formatControlCode(t,"bad")).toBe(legacy.formatControlCode(t,"bad"));}
  expect(lab.formatPrintedControlId("positive","2026-06-01")).toBe("26N120260601-1");
  expect(lab.formatPrintedControlId("blank","")).toBe("");
  expect(lab.CONTROL_SLOTS).toEqual(legacy.CONTROL_SLOTS);
  expect(lab.PATIENT_SLOTS).toEqual(legacy.PATIENT_SLOTS);
  expect(lab.SHEET_SLOT_RANGES).toEqual(legacy.SHEET_SLOT_RANGES);
  for(let s=1;s<=48;s++){expect(lab.getPlatePosition(s)).toBe(legacy.getPlatePosition(s));expect(lab.getSheetNumber(s)).toBe(legacy.getSheetNumber(s));expect(lab.getBarcodeIndex(s)).toBe(s);}
  for(const bad of [0,49])expect(()=>lab.getPlatePosition(bad)).toThrow();
  expect(lab.formatRunLabel(1,2026)).toBe("Run001/2026");
  expect(lab.formatRunLabel(1234,2026)).toBe("Run1234/2026");
  expect(lab.stripLabels("Run007/2026",2)).toEqual({s1:"Run007 S1-2/3",s2:"Run007 S2-2/3"});
 });
});
it("Owner 2026-11-13: the NIFTY vendor ID drops -3 like -1/-2, and nothing else",async()=>{
 const {niftySampleId}=await import("../../packages/sequencing/owner-export");
 expect(niftySampleId("26B261102017-1")).toBe("26B261102017");expect(niftySampleId("26B261102017-2")).toBe("26B261102017");expect(niftySampleId("26B261102017-3")).toBe("26B261102017");
 expect(niftySampleId("26B261102017DR-3")).toBe("26B261102017DR");expect(niftySampleId("26B261102017-4")).toBe("26B261102017-4");expect(niftySampleId("26N120261109-1")).toBe("26N120261109");
});
it("Owner 2026-11-13: an S1 third attempt (-3) heads the Task fill queue ahead of earlier LN Halos; the rest keep LN Halos order",async()=>{
 const {fifo}=await import("../../packages/lab/core");
 const row=(id:string,lnHalos:string,round:number,attempt:number)=>({attempt_id:id,ln:id,ln_halos:lnHalos,round_number:round,attempt_number:attempt,received_at:new Date("2026-11-01T00:00:00Z")}) as never;
 const rows=[row("a","26B261101001",1,1),row("b","26B261101002",1,2),row("c","26B261102017",1,3),row("d","26B261101003",2,3),row("e","26B261101000",1,1)];
 expect([...rows].sort(fifo).map((r:{attempt_id:string})=>r.attempt_id)).toEqual(["c","e","a","b","d"]);
});
