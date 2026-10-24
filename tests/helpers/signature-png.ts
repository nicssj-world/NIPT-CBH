import {deflateSync,crc32} from 'node:zlib';
/** Deterministic synthetic "signature" scribble (PNG, transparent background). Never a real person's signature. */
export function syntheticSignaturePng(seed=1,width=240,height=80){
 const px=Buffer.alloc(width*height*4);
 for(let x=8;x<width-8;x++){const y=Math.round(height/2+Math.sin((x+seed*13)/9)*height/4+Math.cos((x*seed)/23)*height/10);
  for(let dy=-2;dy<=2;dy++){const yy=y+dy;if(yy<0||yy>=height)continue;const o=(yy*width+x)*4;px[o]=10;px[o+1]=30;px[o+2]=120;px[o+3]=255;}}
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){raw[y*(width*4+1)]=0;px.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);}
 const chunk=(type:string,data:Buffer)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
