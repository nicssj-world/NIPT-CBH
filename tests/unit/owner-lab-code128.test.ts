import {it,expect} from 'vitest';
import {CODE128_PATTERNS,code128Values,code128Modules} from '../../packages/lab/code128';
import {buildTubeLabelsHtml} from '../../packages/lab/labels';

// OWNER-LAB-004/026 tube-label barcode. Structural verification only: a physical scanner test is still required on site.
it('Code 128 table: 106 data/start symbols of 6 elements summing to 11 modules, a 13-module stop, all distinct',()=>{
 expect(CODE128_PATTERNS).toHaveLength(107);
 for(const p of CODE128_PATTERNS.slice(0,106)){expect(p).toMatch(/^[1-4]{6}$/);expect([...p].reduce((a,b)=>a+Number(b),0)).toBe(11);
  // bars (even positions) always total an even number of modules in Code 128
  expect([0,2,4].reduce((a,i)=>a+Number(p[i]),0)%2).toBe(0);}
 expect(CODE128_PATTERNS[106]).toBe('2331112');
 expect(new Set(CODE128_PATTERNS).size).toBe(107);
});

/** Independent decoding from bar/space widths back to text, following the subset switches and the mod-103 check. */
function decode(widths:number[]){
 const symbols:number[]=[];
 for(let i=0;i<widths.length;){const len=widths.length-i===7?7:6,pattern=widths.slice(i,i+len).join('');const v=CODE128_PATTERNS.indexOf(pattern as never);if(v<0)throw Error('UNKNOWN_PATTERN '+pattern);symbols.push(v);i+=len;}
 if(symbols.at(-1)!==106)throw Error('NO_STOP');
 const data=symbols.slice(0,-2),check=symbols.at(-2)!;
 if(data.reduce((s,v,i)=>s+v*(i===0?1:i),0)%103!==check)throw Error('CHECK_DIGIT');
 let set=data[0]===105?'C':data[0]===104?'B':'?',out='';
 for(const v of data.slice(1)){if(v===99){set='C';continue;}if(v===100){set='B';continue;}out+=set==='C'?String(v).padStart(2,'0'):String.fromCharCode(v+32);}
 return out;
}
const CODES=['26B261025001','26B261025001-1','26B261025001-2','26B261025001-3','26B261025003D','26B261025003D-3','26B261025004R','26B261025004DR','26B261025004DR-3','2629870101'];
it('encodes and decodes every printed-code form, with a valid check digit and digit-pair compression',()=>{
 for(const code of CODES)expect(decode(code128Modules(code))).toBe(code);
 // Digit runs are packed in subset C: the 10-digit HIS LN is start C + 5 pairs + check.
 expect(code128Values('2629870101')).toHaveLength(7);
 expect(()=>code128Values('ไทย')).toThrow('CODE128_VALUE_INVALID');
});
it('the printed label SVG bars decode to the half\'s own code for all eight halves',()=>{
 const html=buildTubeLabelsHtml([{ln:'2629870103',lnHalos:'26B261025003D',patientName:null}]);
 const svgs=[...html.matchAll(/<svg class="bc" data-code="([^"]*)" viewBox="0 0 (\d+) 1"[^>]*>([\s\S]*?)<\/svg>/g)];
 expect(svgs).toHaveLength(8);
 for(const [,code,total,body] of svgs){
  const rects=[...body.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map(m=>({x:Number(m[1]),w:Number(m[2])}));
  const widths:number[]=[];rects.forEach((r,i)=>{widths.push(r.w);if(i<rects.length-1)widths.push(rects[i+1].x-(r.x+r.w));});
  expect(decode(widths)).toBe(code);
  expect(rects[0].x).toBe(10);expect(Number(total)-(rects.at(-1)!.x+rects.at(-1)!.w)).toBe(10);
 }
 expect(svgs.map(m=>m[1])).toEqual(['26B261025003D','26B261025003D','26B261025003D','26B261025003D','26B261025003D','26B261025003D-1','26B261025003D-2','26B261025003D-3']);
});
