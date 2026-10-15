import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyImages} from '../../deploy/scripts/verify-images.mjs';
import {createFreshBundleDirectory} from '../../deploy/scripts/release-contract.mjs';
test('offline image verification uses signed immutable IDs even when original tags were not restored',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-images-'));
 try{
  const id='sha256:'+'a'.repeat(64),roles=['web','operations','renderer','postgres','caddy'];
  const images=Object.fromEntries(roles.map(r=>[r+':p8-test',id]));
  await writeFile(path.join(root,'manifest.json'),JSON.stringify({syntheticOnly:true,images,imageRoles:Object.fromEntries(roles.map(r=>[r,r+':p8-test'])),provenance:{revision:'b'.repeat(40),migrationsSha256:'c'.repeat(64)}}));
  const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
  const seen=[];verifyImages(manifest,args=>{seen.push(args);assert.equal(args[2],id);return JSON.stringify([{Id:id,Config:{Labels:{'org.opencontainers.image.revision':'b'.repeat(40),'org.nipt.migrations.sha256':'c'.repeat(64)}}}]);});
  assert.equal(seen.length,5);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('release creates a fresh local bundle directory including missing bundles parent and refuses reuse',async()=>{const root=await mkdtemp(path.join(tmpdir(),'nipt-fresh-'));try{const base=path.join(root,'bundles'),destination=path.join(base,'p8-release');await createFreshBundleDirectory(destination,base);assert((await lstat(destination)).isDirectory());await assert.rejects(createFreshBundleDirectory(destination,base),/FRESH_BUNDLE/);await assert.rejects(createFreshBundleDirectory(path.join(root,'outside'),base),/LOCAL_BUNDLES/);}finally{await rm(root,{recursive:true,force:true});}});
