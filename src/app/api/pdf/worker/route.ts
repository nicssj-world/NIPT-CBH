import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {type NextRequest} from 'next/server';
import {protect,apiError} from '../../../../server/http';
/** Installed, pinned PDF.js worker, same-origin and authenticated; no CDN/runtime install. */
export async function GET(request:NextRequest){try{await protect(request);const bytes=await readFile(path.join(process.cwd(),'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));return new Response(bytes,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}catch(e){return apiError(e);}}
