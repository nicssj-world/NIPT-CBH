import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
for(const file of ['hospital.png','product-transparent.png','ui-logo.png'])
 it('PWA brand image asset is a valid bundled PNG: '+file,()=>{
  const bytes=readFileSync('public/brand/'+file);
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(500);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(500);
 });
