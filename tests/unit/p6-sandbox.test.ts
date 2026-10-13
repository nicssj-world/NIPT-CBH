import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,symlink,link,unlink} from 'node:fs/promises';
import path from 'node:path';
import {openSandbox} from '../../packages/p6/sandbox';
import {freezeSyntheticTransfer} from '../../packages/p6/transfer';
import {syntheticProfile} from '../../packages/p6/res';
const input=()=>({fixtureId:'SYNTHETIC-FS',reportVersionId:'SYNTHETIC-FS-VERSION',roundId:'SYNTHETIC-FS-ROUND',attemptId:'SYNTHETIC-FS-ATTEMPT',origin:'ANC' as const,lnGeneration:1,roundNumber:1,epoch:0,input:{order:{ln:'990000000001',hn:'SYNTHETIC-HN-1',dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F' as const,specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC' as const},profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4 SYNTHETIC'),settings:{version:'SYNTHETIC-FS-CONFIG',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[10],confirmationTimeoutMs:1000}});
beforeAll(()=>{vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');});afterAll(()=>vi.unstubAllEnvs());
it('writes exact frozen bytes once, verifies backup manifest, then exclusive two-byte OK',async()=>{
  const d=input(),p=freezeSyntheticTransfer(d,1),s=await openSandbox('SYNTHETIC-'+randomUUID(),d.settings);
  await s.ensure('PDF',p);await s.ensure('PDF',p);await s.ensure('RES',p);await s.ensure('BACKUP',p);await s.ensure('OK',p);
  expect(await s.read('PDF',p)).toEqual(d.pdf);expect(await s.read('RES',p)).toEqual(Buffer.from(p.resHex,'hex'));expect(await s.read('OK',p)).toEqual(Buffer.from([255,254]));
  expect(await s.backupVerified(p)).toBe(true);expect(s.root).toContain(path.join('.local','p6-sandbox'));
});
it('does not publish OK before verified PDF, RES and backup or overwrite collisions',async()=>{
  const d=input(),p=freezeSyntheticTransfer(d,1),s=await openSandbox('SYNTHETIC-'+randomUUID(),d.settings);
  await expect(s.ensure('OK',p)).rejects.toThrow('PREREQUISITE_MISSING');await s.ensure('PDF',p);
  await writeFile(path.join(s.root,d.settings.pdfDirectory,p.pdfName),'SYNTHETIC DIFFERENT BYTES');
  await expect(s.ensure('PDF',p)).rejects.toThrow('DESTINATION_COLLISION');
  await expect(s.read('OK',p)).rejects.toThrow();
});
it('fails injection after complete publication and can idempotently verify/recover without overwrite',async()=>{
  const d=input(),p=freezeSyntheticTransfer(d,1),sid='SYNTHETIC-'+randomUUID();
  const s=await openSandbox(sid,d.settings,async a=>{if(a.artifact==='PDF'&&a.point==='AFTER_PUBLISH')throw Error('SYNTHETIC_INJECTED');});
  await expect(s.ensure('PDF',p)).rejects.toThrow('SYNTHETIC_INJECTED');
  const restarted=await openSandbox(sid,d.settings);await restarted.ensure('PDF',p);expect(await restarted.read('PDF',p)).toEqual(d.pdf);
});
it('rejects arbitrary/network roots, traversal, case aliases, symlinks and external hardlinks',async()=>{
  const d=input(),p=freezeSyntheticTransfer(d,1);
  for(const sid of ['../escape','C:\\CFS','\\\\HIS\\CFS','SYNTHETIC-../X'])await expect(openSandbox(sid,d.settings)).rejects.toThrow();
  await expect(openSandbox('SYNTHETIC-'+randomUUID(),{...d.settings,pdfDirectory:'simulator/p6/RES'})).rejects.toThrow('PATH_ALIAS');
  const s=await openSandbox('SYNTHETIC-'+randomUUID(),d.settings),victim=path.join(s.root,'SYNTHETIC-victim');await writeFile(victim,'SYNTHETIC ORIGINAL');
  const pdf=path.join(s.root,d.settings.pdfDirectory,p.pdfName);
  await s.prepare();await link(victim,pdf);await expect(s.ensure('PDF',p)).rejects.toThrow('LINK_PROHIBITED');expect(await readFile(victim,'utf8')).toBe('SYNTHETIC ORIGINAL');await unlink(pdf);
  // Directory junctions are available on Windows without symlink developer-mode privileges.
  const other=await openSandbox('SYNTHETIC-'+randomUUID(),d.settings);
  const alias=path.join(s.root,'simulator','p6','alias');await symlink(other.root,alias,process.platform==='win32'?'junction':'dir');
  const linked=await openSandbox(s.id,{...d.settings,pdfDirectory:'simulator/p6/alias/cfs'}).catch(e=>e);
  expect(linked).toBeInstanceOf(Error);expect(linked.message).toContain('LINK_PROHIBITED');
});
it('requires explicit sandbox opt-in even for valid fixtures',async()=>{
  vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','no');await expect(openSandbox('SYNTHETIC-'+randomUUID(),input().settings)).rejects.toThrow('P6_SANDBOX_DISABLED');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');
});
