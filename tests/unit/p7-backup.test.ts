import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm,open} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pack,unpack,checkedPath,inventory,canonical,sha,MAX_ARCHIVE_BYTES} from '../../deploy/scripts/backup-format.mjs';

describe('P7 authenticated backup payload boundaries',()=>{
 it('rejects an oversized sparse source before allocating/reading its bytes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nipt-p7-size-'));
  try{const handle=await open(path.join(root,'large'),'wx');await handle.truncate(MAX_ARCHIVE_BYTES+1);await handle.close();await expect(inventory(root)).rejects.toThrow('BACKUP_SIZE_LIMIT');}
  finally{await rm(root,{recursive:true,force:true});}
 });
 it('round trips deterministic regular file bytes including long paths',()=>{
  const files=[{path:'files/'+('a'.repeat(60))+'/'+('b'.repeat(60)),bytes:Buffer.from('SYNTHETIC')},{path:'database.dump',bytes:Buffer.from('PGDMP')}];
  const a=pack(files);expect(a).toEqual(pack([...files].reverse()));
  expect(unpack(a).map(x=>[x.path,x.bytes.toString()])).toEqual([...files].sort((a,b)=>a.path.localeCompare(b.path)).map(x=>[x.path,x.bytes.toString()]));
 });
 it('rejects traversal, Windows aliases and duplicate/case alias paths',()=>{
  for(const name of ['../escape','/absolute','files/a\\b','files/a:b','files/CON','files/a.'])expect(()=>pack([{path:name,bytes:Buffer.alloc(0)}])).toThrow();
  expect(()=>pack([{path:'files/a',bytes:Buffer.alloc(0)},{path:'files/A',bytes:Buffer.alloc(0)}])).toThrow();
 });
 it('rejects links/extensions and malformed tar checksums before extraction',()=>{
  for(const type of ['1','2','x','g','S']){const b=pack([{path:'files/a',bytes:Buffer.from('a')}]);b[156]=type.charCodeAt(0);b.fill(32,148,156);const sum=b.subarray(0,512).reduce((a,v)=>a+v,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');expect(()=>unpack(b)).toThrow('BACKUP_UNSAFE_TYPE');}
  const b=pack([{path:'files/a',bytes:Buffer.from('a')}]);b[1]^=1;expect(()=>unpack(b)).toThrow('BACKUP_TAR_CHECKSUM');
 });
 it('rejects linked ancestry and inventories exact stable content',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nipt-p7-unit-'));
  try{await mkdir(path.join(root,'real'));await writeFile(path.join(root,'real','a'),'SYNTHETIC');await symlink(path.join(root,'real'),path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
   await expect(checkedPath(path.join(root,'linked','child'),{missing:true})).rejects.toThrow('BACKUP_LINK_PROHIBITED');
   expect(await inventory(path.join(root,'real'))).toEqual([{path:'a',bytes:9,sha256:sha(Buffer.from('SYNTHETIC'))}]);expect(canonical({b:1,a:{d:2,c:3}})).toBe('{"a":{"c":3,"d":2},"b":1}');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
