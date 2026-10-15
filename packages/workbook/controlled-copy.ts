import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib';
export type NativeCopyLabel={id:string;kind:'WORKING_COPY'|'STATUS_MARKED';number:number|null;status:string;originalHash:string;actorId:string;at:string};
/** Derive a visibly controlled COPY. The issued original and every Master page's geometry/content/font remain intact. */
export async function labelNativeCopy(original:Buffer,label:NativeCopyLabel){
 const document=await PDFDocument.load(original),font=await document.embedFont(StandardFonts.Helvetica);
 for(const page of document.getPages()){
  const {width,height}=page.getSize(),lines=[`${label.kind}${label.number===null?'':` #${label.number}`} | ${label.status} | COPY ID ${label.id}`,`Original SHA256 ${label.originalHash} | ${label.at} | Actor ${label.actorId}`];
  for(const [i,text] of lines.entries()){const size=Math.min(8,(width-24)/font.widthOfTextAtSize(text,1));page.drawText(text,{x:12,y:height-8-i*8,size,font,color:rgb(.18,.18,.18)});}
  if(label.kind==='STATUS_MARKED')page.drawText(label.status.toUpperCase(),{x:width*.18,y:height*.34,size:Math.min(54,width/10),font,rotate:degrees(40),color:rgb(.75,0,0),opacity:.22});
 }
 document.setSubject(`Controlled copy ${label.id} derived from SHA256 ${label.originalHash}`);
 return Buffer.from(await document.save());
}
