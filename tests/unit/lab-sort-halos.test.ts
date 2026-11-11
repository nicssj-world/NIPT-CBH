import {describe,expect,it} from "vitest";
import {byLnHalosAsc,LAB_SCREEN_DEFAULT_SORT} from "../../src/components/p4/lab-sort";

describe("Lab screen ordering (Owner 2026-11-11)",()=>{
 it("opens newest LN Halos first",()=>expect(LAB_SCREEN_DEFAULT_SORT).toBe("desc"));
 it("print/batch order is LN Halos ascending even when HIS LN order differs; no-Halos last",()=>{
  const rows=[
   {lnHalos:"26B261106064",hisLn:"2631070026"},
   {lnHalos:null,hisLn:"2631070001"},
   {lnHalos:"26B261106062",hisLn:"2631070025"},
   {lnHalos:"26B261106063",hisLn:"2631070016"},
  ];
  expect([...rows].sort(byLnHalosAsc).map(r=>r.lnHalos)).toEqual(["26B261106062","26B261106063","26B261106064",null]);
 });
});
