import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/lab-bench.tsx','utf8');
it('the NIFTY sample-info export is offered at every stage with only the saved task as a precondition; the HALOS pair keeps its pooling gate',()=>{
 const info=[...src.matchAll(/<button[^>]*onClick=\{\(\)=>void downloadNifty\(\)\}/g)].map(m=>m[0]);
 expect(info).toHaveLength(3);                                   // QC, Pooling and Sequencing steps
 for(const b of info){expect(b).toContain('disabled={busy||!saved}');expect(b).not.toMatch(/finalized|actualPooling/);}
 const pair=src.match(/<button[^>]*onClick=\{\(\)=>void exportPair\(\)\}/)![0];
 expect(pair).toContain('data.actualPooling?.current');
});
