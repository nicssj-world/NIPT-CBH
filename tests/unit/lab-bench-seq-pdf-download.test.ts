import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// Owner 2026-11-18: a "ดาวน์โหลด PDF" button on the Sequencing step, next to "ดูตัวอย่าง / พิมพ์", exactly like the Pooling one.
const src=readFileSync('src/components/p4/lab-bench.tsx','utf8');
it('Sequencing has a PDF download button right after the print preview button, enabled like it',()=>{
 const start=src.indexOf("{data&&tab==='SEQ'&&<section");expect(start).toBeGreaterThan(-1);
 const seq=src.slice(start,src.indexOf('</section>}',start));
 const print=seq.indexOf("onClick={()=>openPdf('SEQ','Seq Task-G50')}"),download=seq.indexOf("onClick={()=>void downloadPdf('SEQ','Seq Task-G50')}");
 expect(print).toBeGreaterThan(-1);expect(download).toBeGreaterThan(print);
 expect(seq.slice(print,download)).not.toMatch(/<button[^>]*onClick=\{\(\)=>(?!void downloadPdf\('SEQ')/);
 const button=seq.slice(seq.lastIndexOf('<button',download),seq.indexOf('</button>',download));
 expect(button).toContain('disabled={busy||!saved}');expect(button).toContain('ดาวน์โหลด PDF');
});
