import {PDFDocument} from 'pdf-lib';
/** Adobe exposes inverse driver-scale page coordinates. Restore the Master's existing print zoom, never fit/guess a new zoom. */
export async function restoreNativeA4Coordinates(bytes:Buffer,zoom:number){
 const document=await PDFDocument.load(bytes),pages=document.getPages();
 if(pages.length!==1)throw new Error('TASK_PDF_ONE_PAGE_A4_REQUIRED');
 const page=pages[0],{width,height}=page.getSize(),a4={width:595.28,height:841.89};
 if(Math.abs(width-a4.width)<2&&Math.abs(height-a4.height)<2)return {bytes,nativeCoordinateScale:1};
 const scale=zoom/100;
 if(!Number.isFinite(scale)||scale<=0||Math.abs(width*scale-a4.width)>2||Math.abs(height*scale-a4.height)>2)throw new Error('TASK_PDF_DRIVER_COORDINATES_MISMATCH');
 page.scaleContent(scale,scale);page.setSize(width*scale,height*scale);
 return {bytes:Buffer.from(await document.save()),nativeCoordinateScale:scale};
}
