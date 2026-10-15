import {it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {labelNativeCopy} from '../../packages/workbook/controlled-copy';
import {extract} from '../../packages/results/extract';
it('adds visible copy identity/status, preserves both A4 pages and never mutates the issued original',async()=>{
 const document=await PDFDocument.create();for(let i=0;i<2;i++)document.addPage([595.28,841.89]).drawText('ORIGINAL MASTER CONTENT',{x:50,y:700,size:12});
 const original=Buffer.from(await document.save()),unchanged=Buffer.from(original),label={id:'00000000-0000-4000-8000-000000000001',kind:'STATUS_MARKED' as const,number:1,status:'StopUse',originalHash:'a'.repeat(64),actorId:'00000000-0000-4000-8000-000000000002',at:'2026-10-15T00:00:00.000Z'};
 const copy=await labelNativeCopy(original,label),pdf=await PDFDocument.load(copy),readback=await extract(copy);
 expect(original).toEqual(unchanged);expect(copy).not.toEqual(original);expect(pdf.getPageCount()).toBe(2);
 for(const page of pdf.getPages()){expect(page.getWidth()).toBe(595.28);expect(page.getHeight()).toBe(841.89);}
 if(readback.container==='ZIP_BATCH')throw Error('PDF_REQUIRED');
 expect(readback.text).toContain('ORIGINAL MASTER CONTENT');expect(readback.text).toContain('STATUS_MARKED #1');expect(readback.text).toContain(label.id);expect(readback.text).toContain('STOPUSE');
});
