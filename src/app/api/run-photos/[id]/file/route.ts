import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../../packages/db/connection";
import {photoForServing} from "../../../../../../packages/run-photos/service";
import {getPhoto} from "../../../../../../packages/run-photos/store";
import {PHOTO_EXTENSION,BROWSER_RENDERABLE,sniffImage,type PhotoMediaType} from "../../../../../../packages/run-photos/image";
import {protect} from "../../../../../server/http";
import {photoError} from "../../../../../server/run-photos";
// Photos are never public files: every request is authenticated and authorized, the storage path never leaves the server,
// and the response is private, uncached, sniff-proof and sandboxed if opened directly.
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await protect(request),{id}=await params,variant=request.nextUrl.searchParams.get("variant")==="thumb"?"thumb":"original",download=request.nextUrl.searchParams.get("download")==="1";
 const f=await withTransaction(db=>photoForServing(db,user,id,variant));
 const bytes=await getPhoto(f.rootPath,f.hash);
 const type:PhotoMediaType|null=f.mediaType??sniffImage(bytes);
 const inline=!download&&!!type&&BROWSER_RENDERABLE.has(type);
 const name=`run-photo-${f.id.slice(0,8)}${variant==="thumb"?"-thumb":""}.${type?PHOTO_EXTENSION[type]:"bin"}`;
 return new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":type??"application/octet-stream","Content-Length":String(bytes.length),
  "Content-Disposition":`${inline?"inline":"attachment"}; filename="${name}"`,
  "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox","X-Photo-SHA256":f.hash}});
}catch(e){return photoError(e);}}
