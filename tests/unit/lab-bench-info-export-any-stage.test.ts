import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/lab-bench.tsx','utf8');
const section=(tab:'QC'|'POOL'|'SEQ')=>{const start=src.indexOf(`{data&&tab==='${tab}'&&<section`);expect(start).toBeGreaterThan(-1);const next=src.indexOf('</section>}',start);return src.slice(start,next);};
it('the NIFTY info file has one button, on the Sequencing step only (Owner 2026-11-09); it and the two-file pair need only the saved task',()=>{
 expect(section('SEQ')).toContain('downloadNifty()');
 expect(section('QC')).not.toContain('downloadNifty');
 expect(section('POOL')).not.toContain('downloadNifty');
 const info=[...src.matchAll(/<button[^>]*onClick=\{\(\)=>void downloadNifty\(\)\}/g)].map(m=>m[0]);
 expect(info).toHaveLength(1);
 expect(info[0]).toContain('disabled={busy||!saved}');expect(info[0]).not.toMatch(/finalized|actualPooling/);
 const pair=src.match(/<button[^>]*onClick=\{\(\)=>void exportPair\(\)\}/)![0];
 expect(pair).toContain('disabled={busy||!saved}');expect(pair).not.toMatch(/finalized|actualPooling/);
});
it('automatic pooling records are excluded wherever operator-recorded pooling evidence is read',()=>{
 for(const file of ['bench','bench-review','bench-evidence'])expect(readFileSync(`packages/lab/${file}.ts`,'utf8')).toContain("note<>'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT'");
 expect(readFileSync('packages/lab/seq-export.ts','utf8')).toContain("'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT'");
});
