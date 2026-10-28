import {afterAll,expect,it} from 'vitest';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {probeArchiveRoot} from '../../packages/results/archive-probe';

const roots:string[]=[];
afterAll(async()=>{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));});
it('probes and cleans only unique temporary files without altering existing content',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-probe-'));roots.push(root);
 await writeFile(path.join(root,'existing.pdf'),'existing');
 expect(await probeArchiveRoot(root)).toEqual({ok:true});
 expect(await readdir(root)).toEqual(['existing.pdf']);
});
it('reports an unavailable root without activating anything',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-probe-'));roots.push(root);
 await writeFile(path.join(root,'not-a-directory'),'x');
 expect(await probeArchiveRoot(path.join(root,'not-a-directory'))).toMatchObject({ok:false});
});
