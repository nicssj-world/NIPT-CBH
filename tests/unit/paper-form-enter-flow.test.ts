import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p2/paper-form.tsx','utf8');
// Owner 2026-11-09: in the short paper request check Enter moves on (GA weeks → GA days → ครรภ์ที่ → pregnancy type, Singleton chosen if none) and the last Enter saves.
// Verified in a real browser (Playwright, keyboard only); this guards the wiring.
it('Enter chain: GA weeks → GA days → ครรภ์ที่ → pregnancy type, and each field carries its marker in form order',()=>{
 expect(src).toContain('const ENTER_NEXT:Record<string,string>={gaWeeks:"gaDays",gaDays:"gravida",gravida:"type"}');
 // the markers as they appear on the inputs themselves (helper code also mentions them)
 const order=['required data-enter="gaWeeks"','required data-enter="gaDays"','data-enter="gravida" value','name="paper-pregnancyType" data-enter="type"'].map(m=>src.indexOf(m));
 expect(order.every(i=>i>0)).toBe(true);expect([...order].sort((a,b)=>a-b)).toEqual(order);
});
it('Enter on ครรภ์ที่ picks Singleton only when nothing is chosen; the last Enter saves through requestSubmit (browser required-checks still run) and not while busy',()=>{
 expect(src).toMatch(/step==="gravida"&&panel\.pregnancyType!=="Singleton"&&panel\.pregnancyType!=="Twins"\)update\("pregnancyType","Singleton"\)/);
 expect(src).toContain('if(!busy)formRef.current?.requestSubmit()');
 expect(src).toContain('e.nativeEvent.isComposing');   // never steal Enter from a Thai IME composition
});
it('checks made in the form show their own message, not "เชื่อมต่อไม่สำเร็จ"',()=>{
 expect(src).toContain('class FormError extends Error{}');
 for(const text of ['กรุณาเลือกแพทย์จากทะเบียน','กรุณาเลือกประเภทครรภ์','ครรภ์ที่ ต้องเป็นจำนวนเต็ม 1–50'])expect(src).toContain(`throw new FormError("${text}`);
 expect(src).toContain('setError(e instanceof FormError?e.message:message(e))');
});
