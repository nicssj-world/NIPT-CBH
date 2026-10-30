import {it,expect} from 'vitest';
import manifest from '../../src/app/manifest';
import {GET} from '../../src/app/pwa-icons/[size]/route';
it('P2 manifest is local-only, installable and never declares offline PHI caching',()=>{
 const m=manifest();
 expect(m).toMatchObject({id:'/',start_url:'/login',scope:'/',display:'standalone',lang:'th'});
 expect(m.icons?.map(x=>x.sizes)).toContain('192x192');
 expect(m.icons?.map(x=>x.sizes)).toContain('512x512');
 expect(JSON.stringify(m)).not.toMatch(/patient|offline|cache|http:|https:/i);
});
it('P2 local 192 and 512 PNG assets are valid, no external fetches required',async()=>{
 for(const size of ['192','512']){
  const r=await GET(new Request('https://nipt-cbh/pwa-icons/'+size) as never,{params:Promise.resolve({size})});
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('image/png');
  const b=Buffer.from(await r.arrayBuffer());
  expect(b.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(b.readUInt32BE(16)).toBe(Number(size));
  expect(b.readUInt32BE(20)).toBe(Number(size));
 }
},15000);
it('P2 unsupported size is a hard 404',async()=>{
 const r=await GET(new Request('https://nipt-cbh/pwa-icons/900') as never,{params:Promise.resolve({size:'900'})});
 expect(r.status).toBe(404);
});
