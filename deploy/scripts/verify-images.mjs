import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {roles,imageContract,assertImageProvenance} from './release-contract.mjs';
export function verifyImages(manifest,run=(args)=>execFileSync('docker',args,{encoding:'utf8'})){
 const ids=imageContract(manifest);
 for(const role of roles){
  const [actual]=JSON.parse(run(['image','inspect',ids[role]]));
  if(actual?.Id!==ids[role])throw Error('LOADED_IMAGE_MISMATCH');
  assertImageProvenance(actual,role,manifest);
 }
 return ids;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=process.argv[2];if(!root)throw Error('BUNDLE_REQUIRED');
 verifyImages(JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8')));
 process.stdout.write('Loaded immutable OCI IDs and source/migration provenance match signed manifest.\n');
}
