import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {repeatBadgeOf} from "../../packages/lab/core";
import {RepeatBadge} from "../../src/components/p4/repeat-badge";

const f=(o:Record<string,unknown>)=>({parent_repeat_level:null,repeat_level:null,redraw_stopped:false,...o}) as Parameters<typeof repeatBadgeOf>[0];
describe("repeat badge follows the sample through every Run page",()=>{
 it("a re-sampling stop wins, then the repeat ordered on this attempt, then the repeat this attempt came from",()=>{
  expect(repeatBadgeOf(f({redraw_stopped:true,parent_repeat_level:"RE_EXTRACTION"}))).toBe("RE_SAMPLING");
  expect(repeatBadgeOf(f({parent_repeat_level:"RE_EXTRACTION"}))).toBe("RE_EXTRACTION");
  expect(repeatBadgeOf(f({repeat_level:"RE_LIBRARY"}))).toBe("RE_LIBRARY");
  expect(repeatBadgeOf(f({}))).toBeNull();
 });
 it("the pill always carries its words, and nothing is drawn for an ordinary sample",()=>{
  for(const [k,t] of [["RE_LIBRARY","Re-Library"],["RE_EXTRACTION","Re-Extraction"],["RE_SAMPLING","Re-Sampling"]])expect(renderToStaticMarkup(createElement(RepeatBadge,{kind:k}))).toContain(t);
  expect(renderToStaticMarkup(createElement(RepeatBadge,{kind:null}))).toBe("");
 });
});
