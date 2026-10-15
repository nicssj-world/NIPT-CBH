import {it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {restoreNativeA4Coordinates} from '../../packages/workbook/pdf-media';
it('restores inverse driver coordinates using the exact existing Master zoom, and fails closed for unrelated dimensions or extra pages',async()=>{
 const raw=await PDFDocument.create();raw.addPage([595.28/.69,841.89/.69]);
 const restored=await restoreNativeA4Coordinates(Buffer.from(await raw.save()),69),page=(await PDFDocument.load(restored.bytes)).getPage(0);
 expect(page.getWidth()).toBeCloseTo(595.28);expect(page.getHeight()).toBeCloseTo(841.89);expect(restored.nativeCoordinateScale).toBe(.69);
 await expect(restoreNativeA4Coordinates(Buffer.from(await raw.save()),57)).rejects.toThrow('TASK_PDF_DRIVER_COORDINATES_MISMATCH');
 raw.addPage([595.28/.69,841.89/.69]);await expect(restoreNativeA4Coordinates(Buffer.from(await raw.save()),69)).rejects.toThrow('TASK_PDF_ONE_PAGE_A4_REQUIRED');
});
