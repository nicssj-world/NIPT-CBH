import {z} from 'zod';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
export const vectorSchema=z.strictObject({width:z.literal(600),height:z.literal(200),strokes:z.array(z.array(z.tuple([z.number().finite().min(0).max(599),z.number().finite().min(0).max(199)])).min(2).max(500)).min(1).max(30)}).refine(v=>v.strokes.some(s=>s.some(p=>Math.hypot(p[0]-s[0][0],p[1]-s[0][1])>=8)),'กรุณาลงลายมือชื่อจำลองให้ชัดเจน');
function crc(b:Buffer){let c=0xffffffff;for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const t=Buffer.from(type),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([size,t,data,check]);}
/** Rasterize only bounded numeric vector input; image uploads and arbitrary SVG are rejected. */
export function deriveSignature(input:unknown){
 const vector=vectorSchema.parse(input),pixels=Buffer.alloc((600*4+1)*200,255);for(let y=0;y<200;y++)pixels[y*2401]=0;
 const draw=(x:number,y:number)=>{for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const xx=Math.round(x)+ox,yy=Math.round(y)+oy;if(xx>=0&&xx<600&&yy>=0&&yy<200){const i=yy*2401+1+xx*4;pixels[i]=pixels[i+1]=pixels[i+2]=24;}}};
 for(const stroke of vector.strokes)for(let i=1;i<stroke.length;i++){const a=stroke[i-1],b=stroke[i],steps=Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1])));for(let j=0;j<=steps;j++)draw(a[0]+(b[0]-a[0])*j/(steps||1),a[1]+(b[1]-a[1])*j/(steps||1));}
 const header=Buffer.alloc(13);header.writeUInt32BE(600);header.writeUInt32BE(200,4);header[8]=8;header[9]=6;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
 return {vector,png:png.toString('base64'),hash:createHash('sha256').update(png).digest('hex')};
}
