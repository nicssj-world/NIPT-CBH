import {it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../../src/proxy';
it('LAB-UAT-025 scopes PDF blob frames to document workflows while retaining script/object/connect restrictions',()=>{
 for(const path of ['/historical/123','/results/123','/sample-storage','/cases/123','/lab/batches/123/bench']){
  const csp=proxy(new NextRequest('https://localhost'+path)).headers.get('content-security-policy')!;
  expect(csp).toContain("frame-src 'self' blob:");expect(csp).toContain("object-src 'none'");expect(csp).toContain("connect-src 'self'");expect(csp).not.toContain("script-src *");
 }
 expect(proxy(new NextRequest('https://localhost/login')).headers.get('content-security-policy')).not.toContain('frame-src');
});
