import {afterAll,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {publishNoClobber} from '../../packages/results/archive-core';
import path from 'node:path';
import os from 'node:os';
import {moveNoReplaceWin32} from '../../packages/results/win32-no-replace';
const roots:string[]=[];
afterAll(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});

it.runIf(process.platform==='win32')('Win32 same-directory rename publishes atomically without replacing an existing report',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-win32-no-replace-'));roots.push(root);
 const stage=path.join(root,'first.stage'),dest=path.join(root,'report.pdf'),second=path.join(root,'second.stage');
 const pdf=Buffer.from('%PDF-1.7 SYNTHETIC_FIRST');
 await writeFile(stage,pdf);
 expect(await moveNoReplaceWin32(stage,dest)).toBe('MOVED');
 expect(await readFile(dest)).toEqual(pdf);
 await writeFile(second,Buffer.from('%PDF-1.7 DIFFERENT'));
 expect(await moveNoReplaceWin32(second,dest)).toBe('EXISTS');
 expect(await readFile(dest)).toEqual(pdf);
 expect(await readFile(second)).toEqual(Buffer.from('%PDF-1.7 DIFFERENT'));
});

it('does not attempt an unsafe cross-directory promotion',async()=>{
 await expect(moveNoReplaceWin32('C:/a/first.stage','C:/b/report.pdf')).rejects.toThrow('ARCHIVE_PUBLICATION_UNSUPPORTED');
});

it.runIf(process.platform==='win32')('two native no-replace promotions never overwrite one another',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-win32-race-'));roots.push(root);
 const first=path.join(root,'a.stage'),second=path.join(root,'b.stage'),dest=path.join(root,'report.pdf');
 const a=Buffer.from('%PDF-1.7 FIRST'),b=Buffer.from('%PDF-1.7 SECOND');
 await writeFile(first,a);await writeFile(second,b);
 const result=await Promise.all([moveNoReplaceWin32(first,dest),moveNoReplaceWin32(second,dest)]);
 expect(result.sort()).toEqual(['EXISTS','MOVED']);
 const published=await readFile(dest);
 expect([a,b].some(x=>x.equals(published))).toBe(true);
});

it.runIf(process.platform==='win32')('archive core recovers from SMB hardlink ENOTSUP using native no-clobber',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-win32-fallback-'));roots.push(root);
 const stage=path.join(root,'first.stage'),dest=path.join(root,'report.pdf');
 const bytes=Buffer.from('%PDF-1.7 FALLBACK');
 const sha=createHash('sha256').update(bytes).digest('hex');
 await writeFile(stage,bytes);
 const original=fs.link;
 const unsupported=Object.assign(new Error('synthetic SMB no hardlinks'),{code:'ENOTSUP'});
 const spy=vi.spyOn(fs,'link').mockRejectedValue(unsupported);
 try{
  // Default dynamic fs.link is the spied function, so this exercises the
  // archive core's real fallback, not only the lower-level Win32 helper.
  await publishNoClobber(stage,dest,sha);
  expect(await readFile(dest)).toEqual(bytes);
  const second=path.join(root,'second.stage');await writeFile(second,bytes);
  await publishNoClobber(second,dest,sha);
  expect(await readFile(dest)).toEqual(bytes);
  expect(spy).toHaveBeenCalledTimes(2);
 }finally{
  spy.mockRestore();
  expect(fs.link).toBe(original);
 }
});
