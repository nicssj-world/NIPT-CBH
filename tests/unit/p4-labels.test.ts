import {describe,it,expect} from "vitest";
import fc from "fast-check";
import {buildTubeLabelsHtml as currentGenomicHtml} from "../fixtures/genomic-cbh/label-print-corners-20261015";
import {buildTubeLabelsHtml,tubeLabelStickers} from "../../packages/lab/labels";
import {RUN_SUFFIX} from "../../packages/lab/rules";

const sample={ln:"0012345678",lnHalos:"26B261012001",patientName:null};
const halves=(html:string)=>[...html.matchAll(/<div class="(left|right) half">\s*<div class="ln-halos">([^<]*)<\/div>\s*<div class="patient-ln">LN: ([^<]*)<\/div>/g)].map(m=>({side:m[1],code:m[2],ln:m[3]}));

describe("P4 tube labels — Owner Lock 2026-10-12 / Genomic-CBH label-print.ts",()=>{
 it("AT-LABEL-01: one sample = 4 stickers / 8 halves in exact order (BASE,BASE)(BASE,BASE)(BASE,BASE-1)(BASE-2,BASE-3)",()=>{
  const html=buildTubeLabelsHtml([sample]);
  expect(html.match(/class="sticker"/g)).toHaveLength(4);
  expect(halves(html).map(h=>h.side+":"+h.code)).toEqual(["left:26B261012001","right:26B261012001","left:26B261012001","right:26B261012001","left:26B261012001","right:26B261012001-1","left:26B261012001-2","right:26B261012001-3"]);
  expect(tubeLabelStickers("X")).toEqual([["X","X"],["X","X"],["X","X-1"],["X-2","X-3"]]);
  const codes=halves(html).map(h=>h.code);expect(codes.filter(c=>c==="26B261012001")).toHaveLength(5);for(const s of ["-1","-2","-3"])expect(codes.filter(c=>c==="26B261012001"+s)).toHaveLength(1);
 });
 it("AT-LABEL-02: print CSS is a 50×20 mm page with no margin, 25×20 mm halves and a dashed divider",()=>{
  const html=buildTubeLabelsHtml([sample]);
  expect(html).toContain("@page { size: 50mm 20mm; margin: 0; }");
  expect(html).toContain(".sticker { width: 50mm; height: 20mm; display: flex; page-break-after: always; overflow: hidden; }");
  expect(html).toContain(".half { position: relative; width: 25mm; height: 20mm;");
  expect(html).toContain("border-left: 0.5px dashed #555");
  expect(html).toContain("font-family: 'Courier New', Courier, monospace");
  expect(html).toContain(".ln-halos { font-size: 7pt; font-weight: 900;");
  expect(html).toContain(".patient-ln { font-size: 6pt; font-weight: 700;");
  expect(html).toContain(".name { font-size: 5pt;");
 });
 it("AT-LABEL-03: LN Halos first, `LN: <HIS LN>` second on all eight halves, leading zeros kept, optional name third, no barcode/QR",()=>{
  const html=buildTubeLabelsHtml([sample]);
  expect(halves(html).every(h=>h.ln==="0012345678")).toBe(true);
  expect(html.match(/LN: 0012345678/g)).toHaveLength(8);
  expect(html).not.toMatch(/class="name"/);
  const named=buildTubeLabelsHtml([{...sample,patientName:"นางสาวจำลอง ทดสอบ"}]);
  expect(named.match(/<div class="patient-ln">LN: 0012345678<\/div>\s*<div class="name">นางสาวจำลอง ทดสอบ<\/div>/g)).toHaveLength(8);
  for(const html2 of [html,named])expect(html2).not.toMatch(/barcode|qr|<svg|<img|<canvas|JsBarcode|data:image/i);
 });
 it("AT-LABEL-07: 4 vertical last-three-digit marks per half remain inside the original 50×20 mm sticker",()=>{
  const html=buildTubeLabelsHtml([sample]);
  expect(html.match(/class="corner-set" aria-hidden="true"/g)).toHaveLength(8);
  for(const c of ["tl","tr","bl","br"])
    expect(html.match(new RegExp(`class="corner ${c}">001`,"g"))).toHaveLength(8);
  expect(html).toContain("font-size: 6.5pt");
  expect(html).toContain("transform: rotate(-90deg)");
  expect(html).toContain(".left .corner.tr, .left .corner.br { right: 1.2mm; }");
  expect(html).toContain(".right .corner.tl, .right .corner.bl { left: 1.2mm; }");
  expect(html).toContain("@page { size: 50mm 20mm; margin: 0; }");
  expect(html).toContain("width: 25mm; height: 20mm");
  expect(html).toContain("min-width: 0; flex: 0 0 25mm");
  expect(html).not.toContain("60mm 20mm");
 });
 it("AT-LABEL-08: base digits don't come from label suffix or Twin D",()=>{
  const html=buildTubeLabelsHtml([{ln:"A",lnHalos:"26B261014011",patientName:null},{ln:"B",lnHalos:"26B261014042D",patientName:null}]);
  expect(html.match(/class="corner tl">011/g)).toHaveLength(8);
  expect(html.match(/class="corner tl">042/g)).toHaveLength(8);
  expect(html).toContain("26B261014042D-3");
  expect(buildTubeLabelsHtml([{ln:"A",lnHalos:"not-a-code",patientName:null}])).not.toContain('class="corner-set"');
 });
  it("AT-LABEL-04: two or more samples never mix LN or LN Halos and all text is HTML-escaped",()=>{
  const html=buildTubeLabelsHtml([sample,{ln:"0099999",lnHalos:"26B261012002",patientName:"<script>x</script>"}]);
  expect(html.match(/class="sticker"/g)).toHaveLength(8);
  const h=halves(html);
  expect(h.slice(0,8).every(x=>x.ln==="0012345678"&&x.code.startsWith("26B261012001"))).toBe(true);
  expect(h.slice(8).every(x=>x.ln==="0099999"&&x.code.startsWith("26B261012002"))).toBe(true);
  expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  expect(buildTubeLabelsHtml([{ln:"<LN&123>",lnHalos:"26B261012001",patientName:"\"q\" 'a'"}])).toContain("LN: &lt;LN&amp;123&gt;");
 });
 it("AT-LABEL-06: label suffixes are composition only, distinct from the run-type suffix domain",()=>{
  // The run-type Printed Sample ID suffixes (-1 Normal, -2 Re-Library, R Re-Sampling) are a different domain;
  // a label `-1` half is not a Normal attempt and `-2`/`-3` halves never create attempts or IDs.
  expect(RUN_SUFFIX).toEqual({Normal:"-1","Re-Library":"-2","Re-Sampling":"R"});
  expect(tubeLabelStickers("26B261012001").flat()).not.toContain("26B261012001R");
  expect(tubeLabelStickers("26B261012001").flat()).toContain("26B261012001-3");
 });
 it("matches the approved Genomic-CBH corner-label builder byte-for-byte for any synthetic batch",()=>{
  const text=fc.string({maxLength:24});
  fc.assert(fc.property(fc.array(fc.record({ln:text,lnHalos:text,patientName:fc.option(text,{nil:null})}),{maxLength:6}),samples=>buildTubeLabelsHtml(samples)===currentGenomicHtml(samples)),{numRuns:300});
  expect(buildTubeLabelsHtml([sample])).toBe(currentGenomicHtml([sample]));
 });
});
