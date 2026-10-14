import {NextResponse,type NextRequest} from "next/server";
export function proxy(request:NextRequest){
 const nonce=Buffer.from(crypto.randomUUID()).toString("base64");
 const poolingPreview=/^\/lab\/batches\/[^/]+\/(?:pooling|sequencing|workbook)$/.test(request.nextUrl.pathname)?"; frame-src 'self' blob:":"";
 const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV==="development"?" 'unsafe-eval'":""}; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'${poolingPreview}`;
 const h=new Headers(request.headers);h.set("x-nonce",nonce);h.set("Content-Security-Policy",csp);
 const response=NextResponse.next({request:{headers:h}});response.headers.set("Content-Security-Policy",csp);return response;
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|api/p4/label-sheet/).*)"]};
