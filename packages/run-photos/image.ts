// Content sniffing for Run photos. The declared browser type and file name are never trusted: the bytes decide the media
// type, and anything that is not a JPEG/PNG/WebP/HEIC still image (SVG, GIF, HTML, PDF, ...) is refused.
export type PhotoMediaType='image/jpeg'|'image/png'|'image/webp'|'image/heic'|'image/heif';
export const PHOTO_EXTENSION:Record<PhotoMediaType,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'};
/** Types every supported browser can draw in <img>; HEIC/HEIF are kept as originals but offered as a download. */
export const BROWSER_RENDERABLE=new Set<PhotoMediaType>(['image/jpeg','image/png','image/webp']);

export function sniffImage(b:Uint8Array):PhotoMediaType|null{
 if(b.length<16)return null;
 if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)return 'image/png';
 const ascii=(o:number,n:number)=>String.fromCharCode(...b.subarray(o,o+n));
 if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')return 'image/webp';
 if(ascii(4,4)==='ftyp'){const brand=ascii(8,4);if(['heic','heix','heim','heis','hevc','hevx'].includes(brand))return 'image/heic';if(['mif1','msf1','heif'].includes(brand))return 'image/heif';}
 return null;
}

/** Pixel size from the container header (best effort; null when the header is unusual). Never decodes pixels. */
export function imageSize(b:Uint8Array,type:PhotoMediaType):{width:number;height:number}|null{
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const ok=(w:number,h:number)=>w>0&&h>0&&w<=100000&&h<=100000?{width:w,height:h}:null;
 try{
  if(type==='image/png')return ok(v.getUint32(16),v.getUint32(20));
  if(type==='image/jpeg'){
   let i=2;
   while(i+9<b.length){
    if(b[i]!==0xff){i++;continue;}
    const m=b[i+1];if(m===0xff){i++;continue;}
    if(m===0xd8||m===0x01||(m>=0xd0&&m<=0xd7)){i+=2;continue;}
    const len=v.getUint16(i+2);
    // SOF0..SOF15 except DHT(C4), JPG(C8) and DAC(CC) carry the frame size.
    if(m>=0xc0&&m<=0xcf&&m!==0xc4&&m!==0xc8&&m!==0xcc)return ok(v.getUint16(i+7),v.getUint16(i+5));
    if(m===0xda)return null;
    i+=2+len;
   }
   return null;
  }
  if(type==='image/webp'){
   const chunk=String.fromCharCode(...b.subarray(12,16));
   if(chunk==='VP8 ')return ok(v.getUint16(26,true)&0x3fff,v.getUint16(28,true)&0x3fff);
   if(chunk==='VP8L'){const bits=v.getUint32(21,true);return ok((bits&0x3fff)+1,((bits>>14)&0x3fff)+1);}
   if(chunk==='VP8X')return ok(1+(b[24]|b[25]<<8|b[26]<<16),1+(b[27]|b[28]<<8|b[29]<<16));
   return null;
  }
  return null; // HEIC/HEIF: the size lives in nested ISO-BMFF boxes; the original is kept without parsing them.
 }catch{return null;}
}

/** A display-safe original name: no path, control or reserved characters, at most 200 characters. */
export function safeOriginalName(name:string,type:PhotoMediaType){
 const base=(name.split(/[\\/]/).pop()??'').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'').trim().slice(0,200);
 return base||`photo.${PHOTO_EXTENSION[type]}`;
}
