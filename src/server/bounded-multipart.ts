import {LabError} from '../../packages/lab/core';

/** Check the actual stream as well as Content-Length before allocating multipart files. */
export async function boundedMultipart(request:Request,maxBytes:number){
 if(Number(request.headers.get('content-length')??0)>maxBytes)throw new LabError('UPLOAD_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)throw new LabError('BODY_REQUIRED',422);
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>maxBytes){await reader.cancel();throw new LabError('UPLOAD_TOO_LARGE',413);}parts.push(value);
 }
 return new Response(Buffer.concat(parts),{headers:{'content-type':request.headers.get('content-type')??''}}).formData();
}
