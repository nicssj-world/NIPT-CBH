import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FORM_ASSETS,bundledFormRegistry,stageFormAssets,verifyReleaseFormAssets,releaseFormEnvironment} from '../../tools/win-installer/form-assets.mjs';
import {directoryHashes,sha256Bytes} from '../../tools/win-installer/lib.mjs';
import {loadTemplates} from '../../packages/forms/registry';

describe('Windows release form assets',()=>{
 it('pins the reference hashes and preserves the unapproved DCC status',()=>{
  const set=bundledFormRegistry().sets[0];
  expect(set.id).toBe('CBH-BM17-REF-2026-10-18');
  expect(set.dccStatus).toBe('REFERENCE_NOT_DCC_APPROVED');
  expect(set.request.sha256).toBe('c5b2bfce72f64ba80d06967575fd17364aa98bb5a37c5032d2d3dbaeedb9511b');
  expect(set.consent.sha256).toBe('dc791bb8f40ccc0b895d4f9171f81950738cceb28b57bb056111b97f3c3f0332');
 });
 it('rejects absent or substituted originals before staging',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nipt-form-reject-'));
  try{
   await expect(stageFormAssets(root,{})).rejects.toThrow('FORM_ASSET_BUILD_INPUTS_REQUIRED');
   const fake=path.join(root,'fake.pdf');await writeFile(fake,'%PDF- substituted');
   await expect(stageFormAssets(root,{request:fake,consent:fake})).rejects.toThrow('FORM_ASSET_REQUEST_SHA256_MISMATCH');
   expect(verifyReleaseFormAssets(root)).toBeNull();
   expect(()=>verifyReleaseFormAssets(root,true)).toThrow('FORM_ASSET_REGISTRY_MISSING');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('supports historical releases but fails closed when a new release loses its registry',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nipt-form-legacy-'));
  try{
   expect(releaseFormEnvironment(root)).toEqual({NIPT_ANC_FORM_REGISTRY:''});
   await writeFile(path.join(root,'release.json'),JSON.stringify({formAssets:FORM_ASSETS}));
   expect(()=>releaseFormEnvironment(root)).toThrow('FORM_ASSET_REGISTRY_MISSING');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 // Original installation assets stay outside Git. Local evidence enables this with explicit source paths.
 it.skipIf(!process.env.NIPT_ANC_REQUEST_PDF||!process.env.NIPT_ANC_CONSENT_PDF)('stages exact originals, loads them in web/renderer env and preserves photos across release upgrade',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nipt-form-upgrade-'));
  const prior=process.env.NIPT_ANC_FORM_REGISTRY;
  try{
   const photo=path.join(root,'data','files','photos','retained.jpg');await mkdir(path.dirname(photo),{recursive:true});await writeFile(photo,'retained original photo');
   const photoHash=sha256Bytes(await readFile(photo));
   for(const version of ['1.0.0','1.0.1']){
    const release=path.join(root,'releases',version);
    await stageFormAssets(release,{request:process.env.NIPT_ANC_REQUEST_PDF,consent:process.env.NIPT_ANC_CONSENT_PDF});
    await writeFile(path.join(release,'release.json'),JSON.stringify({version,formAssets:FORM_ASSETS}));
    const env=releaseFormEnvironment(release);expect(env.NIPT_ANC_FORM_REGISTRY).toBe(path.resolve(release,'forms','registry.json'));
    process.env.NIPT_ANC_FORM_REGISTRY=env.NIPT_ANC_FORM_REGISTRY;
    const loaded=await loadTemplates(FORM_ASSETS.id);
    expect(sha256Bytes(loaded.request)).toBe(FORM_ASSETS.request);expect(sha256Bytes(loaded.consent)).toBe(FORM_ASSETS.consent);
    const signedFiles=await directoryHashes(root);
    expect(signedFiles[`releases/${version}/forms/request.pdf`]).toBe(FORM_ASSETS.request);
    expect(signedFiles[`releases/${version}/forms/consent.pdf`]).toBe(FORM_ASSETS.consent);
    expect(signedFiles[`releases/${version}/forms/registry.json`]).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Bytes(await readFile(photo))).toBe(photoHash);
   }
   await writeFile(path.join(root,'releases','1.0.1','forms','consent.pdf'),'%PDF- tampered');
   expect(()=>releaseFormEnvironment(path.join(root,'releases','1.0.1'))).toThrow('FORM_ASSET_CONSENT_SHA256_MISMATCH');
  }finally{
   if(prior===undefined)delete process.env.NIPT_ANC_FORM_REGISTRY;else process.env.NIPT_ANC_FORM_REGISTRY=prior;
   await rm(root,{recursive:true,force:true});
  }
 });
});
