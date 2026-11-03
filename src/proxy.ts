import {NextResponse,type NextRequest} from "next/server";
export function proxy(request:NextRequest){
 const nonce=Buffer.from(crypto.randomUUID()).toString("base64");
 // blob: (frames and connect) on every signed-in page. The CSP belongs to the document that was loaded, and the app navigates between pages without reloading it, so a PDF preview opened after a client-side navigation (list -> Run) is governed by the FIRST page loaded. Only the page itself can create blob URLs (scripts are nonce-bound); /login and /api keep the strict policy.
 const poolingPreview=!/^\/(?:login|api)(?:\/|$)/.test(request.nextUrl.pathname)?"; frame-src 'self' blob:":"";
 const blobConnect=poolingPreview?" blob:":"";
 const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV==="development"?" 'unsafe-eval'":""}; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'${blobConnect}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'${poolingPreview}`;
 const h=new Headers(request.headers);h.set("x-nonce",nonce);h.set("Content-Security-Policy",csp);
 const response=NextResponse.next({request:{headers:h}});response.headers.set("Content-Security-Policy",csp);return response;
}
// Upload APIs authenticate, check CSRF and bound their own streams. Exclude them from the proxy's
// default 10 MB body clone, which otherwise truncates larger multipart payloads before the handler.
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|api/p4/label-sheet/|api/run-photos/upload|api/migration/(?:preview|execute|pdf)(?:/|$)).*)"]};
