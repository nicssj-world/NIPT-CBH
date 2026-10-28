import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {archiveRootFromEnvironment,publishFinalReport,type ArchiveIntent} from '../../packages/results/archive-core';
const roots:string[]=[];
const fixture=async()=>{const root=await mkdtemp(path.join(tmpdir(),'nipt-final-archive-'));roots.push(root);return root;};
const intent=(bytes=Buffer.from('%PDF-1.7 synthetic fixture')):ArchiveIntent=>({caseId:randomUUID(),versionId:randomUUID(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes});
afterAll(async()=>{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));});

describe('final report archive core',()=>{
 it.runIf(process.platform==='win32')('accepts a standard Windows UNC archive root when explicitly enabled',()=>{
  const root=String.raw`\\server\share\reports`;
  expect(archiveRootFromEnvironment({NODE_ENV:'test',FINAL_REPORT_ARCHIVE_ENABLED:'true',FINAL_REPORT_ARCHIVE_ROOT:root})).toBe(root);
 });
 it('stages, verifies and publishes exact bytes idempotently',async()=>{const root=await fixture(),i=intent();await expect(publishFinalReport(root,i)).resolves.toMatchObject({state:'ARCHIVED',sha256:i.sha256});await expect(publishFinalReport(root,i)).resolves.toMatchObject({state:'ARCHIVED'});await expect(readFile(path.join(root,i.caseId,`${i.versionId}.pdf`))).resolves.toEqual(i.bytes);expect((await readdir(path.join(root,i.caseId))).some(n=>n.endsWith('.stage'))).toBe(false);});
 it('publishes concurrent retries without overwriting or leaving staging files',async()=>{const root=await fixture(),i=intent();const results=await Promise.all(Array.from({length:8},()=>publishFinalReport(root,i)));expect(results.every(result=>result.state==='ARCHIVED')).toBe(true);expect(await readFile(path.join(root,i.caseId,`${i.versionId}.pdf`))).toEqual(i.bytes);expect(await readdir(path.join(root,i.caseId))).toEqual([`${i.versionId}.pdf`]);});
 it('does not overwrite a different report already published at the immutable target',async()=>{const root=await fixture(),i=intent();await publishFinalReport(root,i);const conflicting={...i,bytes:Buffer.from('different synthetic report'),sha256:createHash('sha256').update('different synthetic report').digest('hex')};await expect(publishFinalReport(root,conflicting)).resolves.toMatchObject({state:'FAILED',reason:'ARCHIVE_COLLISION'});});
 it('fails closed for a mismatched source hash and leaves disabled work pending',async()=>{const root=await fixture(),i=intent();await expect(publishFinalReport(root,{...i,sha256:'0'.repeat(64)})).resolves.toMatchObject({state:'FAILED',reason:'SOURCE_IDENTITY_OR_HASH_INVALID'});await expect(publishFinalReport(null,i)).resolves.toMatchObject({state:'PENDING',reason:'ARCHIVE_DISABLED'});});
 it('does not recreate a missing archive root when the destination is offline',async()=>{const parent=await fixture(),root=path.join(parent,'missing');await expect(publishFinalReport(root,intent())).resolves.toMatchObject({state:'FAILED'});expect(await readdir(parent)).toEqual([]);});
});
