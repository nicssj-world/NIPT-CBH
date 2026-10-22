import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {audit,compareFiles} from '../../tools/operational/pre-uat-source-parity.mjs';
import {sourceHash} from '../../tools/source-inventory.mjs';
const git=(root:string,args:string[])=>execFileSync('git',['-C',root,...args],{stdio:'pipe',windowsHide:true});
it('compares every path and treats changed, missing and extra source as missing',()=>{
 expect(compareFiles({a:'1',b:'2'},{a:'x',c:'3'}).map(x=>[x.file,x.status])).toEqual([['a','MISSING'],['b','MISSING'],['c','MISSING']]);
 expect(sourceHash(Buffer.from('a\r\nb\r\n'),'a.ts')).toBe(sourceHash(Buffer.from('a\nb\n'),'a.ts'));
 expect(sourceHash(Buffer.from('\ufeffa\r\n','utf16le'),'a.vbs')).toBe(sourceHash(Buffer.from('a\n'),'a.vbs'));
});
it('fails uncommitted/untracked work and stale snapshot; no feature evidence cannot claim readiness',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'nipt-parity-')),repo=path.join(base,'repo'),snapshot=path.join(base,'snapshot');await mkdir(repo);
 for(const dir of ['src','db/migrations','tools/operational'])await mkdir(path.join(repo,dir),{recursive:true});
 await writeFile(path.join(repo,'src/a.ts'),'export const a=1;\n');await writeFile(path.join(repo,'db/migrations/001_test.sql'),'SELECT 1;\n');await writeFile(path.join(repo,'tools/operational/source-parity-features.json'),JSON.stringify({features:[{id:'sample',sources:['src/a.ts']}],reviewedExclusions:[]}));
 git(repo,['init']);git(repo,['add','src/a.ts','db/migrations/001_test.sql','tools/operational/source-parity-features.json']);git(repo,['-c','user.name=Parity Test','-c','user.email=parity@example.invalid','commit','-m','fixture']);execFileSync('git',['clone','--local','--no-hardlinks',repo,snapshot],{stdio:'pipe',windowsHide:true});
 const clean=await audit({repo,snapshot});expect(clean.status).toBe('PASS');expect(clean.readyForOwnerTest).toBe(false);expect(clean.features[0].status).toBe('BLOCKED');
 await writeFile(path.join(repo,'src/a.ts'),'export const a=2;\n');await writeFile(path.join(repo,'src/new.ts'),'export const feature=true;\n');const dirty=await audit({repo,snapshot});expect(dirty.status).toBe('FAIL');expect(dirty.readyForOwnerTest).toBe(false);expect(dirty.uncommitted).toHaveLength(2);expect(dirty.differences.map(x=>x.file)).toEqual(['src/a.ts','src/new.ts']);
 git(repo,['add','src/a.ts','src/new.ts']);git(repo,['-c','user.name=Parity Test','-c','user.email=parity@example.invalid','commit','-m','changed']);expect((await audit({repo,snapshot})).failures).toContain('HEAD_SNAPSHOT_MISMATCH');
});
