import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/lab-bench.tsx','utf8');
it('every export button on the bench needs only the saved task: the NIFTY info file at all three steps and the two-file pair at the Sequencing step',()=>{
 const info=[...src.matchAll(/<button[^>]*onClick=\{\(\)=>void downloadNifty\(\)\}/g)].map(m=>m[0]);
 expect(info).toHaveLength(3);
 for(const b of info){expect(b).toContain('disabled={busy||!saved}');expect(b).not.toMatch(/finalized|actualPooling/);}
 const pair=src.match(/<button[^>]*onClick=\{\(\)=>void exportPair\(\)\}/)![0];
 expect(pair).toContain('disabled={busy||!saved}');expect(pair).not.toMatch(/finalized|actualPooling/);
});
it('automatic pooling records are excluded wherever operator-recorded pooling evidence is read',()=>{
 for(const file of ['bench','bench-review','bench-evidence'])expect(readFileSync(`packages/lab/${file}.ts`,'utf8')).toContain("note<>'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT'");
 expect(readFileSync('packages/lab/seq-export.ts','utf8')).toContain("'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT'");
});
