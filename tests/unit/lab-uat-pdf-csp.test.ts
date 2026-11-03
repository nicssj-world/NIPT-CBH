import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../../src/proxy';
const cspOf=(path:string)=>proxy(new NextRequest('https://localhost'+path)).headers.get('content-security-policy')!;
it('LAB-UAT-025 allows PDF blob frames/connect on every signed-in page while retaining script/object restrictions',()=>{
 // Includes the list and entry pages: the document CSP outlives client-side navigation, so a preview opened on /lab/batches/<id> after coming from /lab/batches is governed by the page that was loaded first.
 for(const path of ['/','/lab','/lab/batches','/inbound','/cases','/historical/123','/results/123','/sample-storage','/cases/123','/lab/batches/123/bench','/lab/batches/123']){
  const csp=cspOf(path);
  expect(csp,path).toContain("connect-src 'self' blob:");expect(csp,path).toContain("frame-src 'self' blob:");expect(csp,path).toContain("object-src 'none'");expect(csp,path).not.toContain("script-src *");
  expect(csp,path).toMatch(/script-src 'self' 'nonce-[^']+'/);                               // scripts stay nonce-bound: only the page itself can create a blob URL
 }
});
it('the sign-in page and the API keep the strict policy (no blob frames or connections)',()=>{
 for(const path of ['/login','/api/auth/login','/api/p4/specimen-rejection-evidence']){
  const csp=cspOf(path);
  expect(csp,path).not.toContain('frame-src');expect(csp,path).not.toContain('blob:');expect(csp,path).toContain("connect-src 'self';");
 }
});
