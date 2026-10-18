"use client";
import {csrf} from "../p2/shared";
import {LabFailure} from "../p4/lab-api";

export const THUMB_EDGE=480;
/**
 * A small JPEG preview made in the browser, so the gallery never has to send full-resolution originals to list photos. The
 * original file is uploaded untouched. Formats the browser cannot decode (HEIC on most desktop browsers) get no thumbnail.
 */
export async function makeThumbnail(file:Blob):Promise<{blob:Blob;dataUrl:string}|null>{
 try{
  const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});
  const scale=Math.min(1,THUMB_EDGE/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext("2d");if(!ctx)return null;
  ctx.imageSmoothingQuality="high";ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",.82));
  return blob?{blob,dataUrl:canvas.toDataURL("image/jpeg",.82)}:null;
 }catch{return null;}
}
export const newKey=()=>crypto.randomUUID().replaceAll("-","");
export type UploadMeta={batchId:string;idempotencyKey:string;caption:string;sampleFrom:number|null;sampleTo:number|null;takenOn:string};
export type UploadResult={photoId:string;replayed:boolean;otherRuns:string[];sha256:string};
/** One photo per request; XMLHttpRequest because fetch cannot report upload progress. */
export function uploadOne(file:File,thumb:Blob|null,meta:UploadMeta,onProgress:(fraction:number)=>void):Promise<UploadResult>{
 return new Promise((resolve,reject)=>{
  const form=new FormData();form.append("meta",JSON.stringify(meta));form.append("file",file,file.name||"photo.jpg");if(thumb)form.append("thumb",thumb,"thumb.jpg");
  const xhr=new XMLHttpRequest();xhr.open("POST","/api/run-photos/upload");xhr.setRequestHeader("x-csrf-token",csrf());xhr.responseType="json";
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
  xhr.onload=()=>{const d=(xhr.response??{}) as Record<string,unknown>;if(xhr.status>=200&&xhr.status<300)resolve(d as unknown as UploadResult);
   else reject(new LabFailure(String(d.code??"REQUEST_FAILED"),String(d.error??"อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง"),d.details,xhr.status));};
  xhr.onerror=()=>reject(new LabFailure("NETWORK","เชื่อมต่อเครื่องแม่ข่ายไม่ได้ — ตรวจ Wi-Fi/LAN แล้วกด ลองอีกครั้ง"));
  xhr.ontimeout=()=>reject(new LabFailure("NETWORK","อัปโหลดใช้เวลานานเกินไป — ตรวจเครือข่ายแล้วกด ลองอีกครั้ง"));
  xhr.timeout=10*60*1000;xhr.send(form);
 });
}
export const fileUrl=(id:string,variant:"thumb"|"original",download=false)=>`/api/run-photos/${id}/file?variant=${variant}${download?"&download=1":""}`;
export const formatBytes=(n:number)=>n>=1024**3?`${(n/1024**3).toFixed(1)} GB`:n>=1024**2?`${(n/1024**2).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;
