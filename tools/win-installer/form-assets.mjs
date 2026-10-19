// Owner reference assets only: byte verification does not confer DCC approval.
// Release-local paths keep install/upgrade/rollback independent of the build host.
import {readFileSync,existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const FORM_ASSETS={id:'CBH-BM17-REF-2026-10-18',layout:'BM17-2026-10',dccStatus:'REFERENCE_NOT_DCC_APPROVED',
 request:'c5b2bfce72f64ba80d06967575fd17364aa98bb5a37c5032d2d3dbaeedb9511b',
 consent:'dc791bb8f40ccc0b895d4f9171f81950738cceb28b57bb056111b97f3c3f0332'};
export function bundledFormRegistry(){
 const file=(kind,code)=>({path:kind+'.pdf',sha256:FORM_ASSETS[kind],docCode:code,page:'1 / 1'});
 return {version:1,sets:[{id:FORM_ASSETS.id,label:'CBH BM17 Owner reference (not DCC approved)',layout:FORM_ASSETS.layout,dccStatus:FORM_ASSETS.dccStatus,
  request:file('request','FM-WI-T-BM17/01'),consent:file('consent','FM-WI-T-BM17/02')}]};
}
function checkedBytes(file,kind){
 const bytes=readFileSync(file);
 if(createHash('sha256').update(bytes).digest('hex')!==FORM_ASSETS[kind])throw Error('FORM_ASSET_'+kind.toUpperCase()+'_SHA256_MISMATCH');
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('FORM_ASSET_NOT_PDF');
 return bytes;
}
export async function stageFormAssets(release,{request,consent}){
 if(!request||!consent)throw Error('FORM_ASSET_BUILD_INPUTS_REQUIRED');
 // Verify both before creating output. Source originals are never changed.
 const bytes={request:checkedBytes(request,'request'),consent:checkedBytes(consent,'consent')};
 const dir=path.join(release,'forms');await mkdir(dir,{recursive:true});
 for(const kind of ['request','consent'])await writeFile(path.join(dir,kind+'.pdf'),bytes[kind]);
 await writeFile(path.join(dir,'registry.json'),JSON.stringify(bundledFormRegistry(),null,2));
 return verifyReleaseFormAssets(release,true);
}
export function verifyReleaseFormAssets(release,required=false){
 const registry=path.resolve(release,'forms','registry.json');
 if(!existsSync(registry)){
  if(required)throw Error('FORM_ASSET_REGISTRY_MISSING');
  return null; // Historical releases can still be inspected and rolled back.
 }
 if(JSON.stringify(JSON.parse(readFileSync(registry,'utf8')))!==JSON.stringify(bundledFormRegistry()))throw Error('FORM_ASSET_REGISTRY_MISMATCH');
 for(const kind of ['request','consent'])checkedBytes(path.join(release,'forms',kind+'.pdf'),kind);
 return registry;
}
export function releaseFormEnvironment(release){
 const meta=path.join(release,'release.json');
 const required=existsSync(meta)&&JSON.parse(readFileSync(meta,'utf8')).formAssets?.id===FORM_ASSETS.id;
 return {NIPT_ANC_FORM_REGISTRY:verifyReleaseFormAssets(release,required)??''};
}
