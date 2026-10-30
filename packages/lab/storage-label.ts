import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import type {StorageType} from './sample-storage';

const CODE39:Record<string,number>={'0':0x034,'1':0x121,'2':0x061,'3':0x160,'4':0x031,'5':0x130,'6':0x070,'7':0x025,'8':0x124,'9':0x064,B:0x049,D:0x019,R:0x106,'-':0x0a8,'*':0x094};
const code39Pattern=(value:string)=>{
 const encoding=CODE39[value];
 if(encoding===undefined)throw new Error('STORAGE_LABEL_CODE_INVALID');
 return encoding.toString(2).padStart(9,'0').replaceAll('1','w').replaceAll('0','n');
};

const PAGE_WIDTH=50/25.4*72;
const PAGE_HEIGHT=20/25.4*72;
const HALF_WIDTH=PAGE_WIDTH/2;
const NARROW=0.25;
const WIDE=0.625;
const QUIET_ZONE=2.5;

export function encodeStorageBarcode(value:string){
 const encoded=`*${value}*`;
 const widths:number[]=[];
 for(const char of encoded){
  const pattern=code39Pattern(char);
  for(const unit of pattern)widths.push(unit==='w'?WIDE:NARROW);
  widths.push(NARROW);
 }
 widths.pop();
 return widths;
}

export async function buildStorageSampleLabel(input:{storageLabel:string;ln:string;storageType:StorageType}){
 const suffix=input.storageType==='BACKUP'?'-3':'';
 if(!/^[0-9]{2}B[0-9]{9}D?R?(?:-3)?$/.test(input.storageLabel)
  ||(input.storageType==='BACKUP'&&!input.storageLabel.endsWith('-3'))
  ||(input.storageType==='BUFFY_COAT'&&input.storageLabel.endsWith('-3'))){
  throw new Error('STORAGE_LABEL_TYPE_MISMATCH');
 }
 if(input.storageLabel.endsWith('-1')||input.storageLabel.endsWith('-2')||(!suffix&&/-[12]$/.test(input.storageLabel))){
  throw new Error('STORAGE_LABEL_SUFFIX_PROHIBITED');
 }
 const widths=encodeStorageBarcode(input.storageLabel),barcodeWidth=widths.reduce((sum,width)=>sum+width,0);
 if(barcodeWidth+QUIET_ZONE*2>HALF_WIDTH)throw new Error('STORAGE_LABEL_CODE_TOO_LONG');
 const pdf=await PDFDocument.create();
 const font=await pdf.embedFont(StandardFonts.HelveticaBold),regular=await pdf.embedFont(StandardFonts.Helvetica);
 const typeLabel=input.storageType==='BACKUP'?'BACKUP':'BUFFY COAT';
 // Preserve the approved 50 x 20 mm sticker sheet geometry: four stickers, each split into two identical halves.
 // The Storage-specific code is repeated on all eight halves; the existing NIPT tube-label composition is untouched.
 for(let sticker=0;sticker<4;sticker++){
  const page=pdf.addPage([PAGE_WIDTH,PAGE_HEIGHT]);
  for(let half=0;half<2;half++){
   const left=half*HALF_WIDTH;
   const codeSize=Math.min(6.5,(HALF_WIDTH-6)/font.widthOfTextAtSize(input.storageLabel,1));
   page.drawText(input.storageLabel,{x:left+(HALF_WIDTH-font.widthOfTextAtSize(input.storageLabel,codeSize))/2,y:PAGE_HEIGHT-11,size:codeSize,font});
   const typeSize=5.5;
   page.drawText(typeLabel,{x:left+(HALF_WIDTH-font.widthOfTextAtSize(typeLabel,typeSize))/2,y:PAGE_HEIGHT-20,size:typeSize,font});
   const lnText=`LN: ${input.ln}`,lnSize=Math.min(5,(HALF_WIDTH-6)/regular.widthOfTextAtSize(lnText,1));
   page.drawText(lnText,{x:left+(HALF_WIDTH-regular.widthOfTextAtSize(lnText,lnSize))/2,y:PAGE_HEIGHT-28,size:lnSize,font:regular});
   let x=left+(HALF_WIDTH-barcodeWidth)/2;const y=5;
   const symbolCount=input.storageLabel.length+2;
   for(let symbolIndex=0;symbolIndex<symbolCount;symbolIndex++){
    const char=symbolIndex===0||symbolIndex===symbolCount-1?'*':input.storageLabel[symbolIndex-1];
    const pattern=code39Pattern(char);
    for(let element=0;element<9;element++){
     const width=pattern[element]==='w'?WIDE:NARROW;
     if(element%2===0)page.drawRectangle({x,y,width,height:9,color:rgb(0,0,0)});
     x+=width;
    }
    if(symbolIndex<symbolCount-1)x+=NARROW;
   }
  }
 }
 return Buffer.from(await pdf.save());
}
