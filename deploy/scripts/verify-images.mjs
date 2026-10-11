import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.argv[2];if(!root)throw Error('BUNDLE_REQUIRED');
// Called by trusted install only after independent signature/file-set verification.
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.syntheticOnly!==true||!manifest.images||Object.keys(manifest.images).length!==5)throw Error('IMAGE_MANIFEST_INVALID');
for(const [tag,id] of Object.entries(manifest.images)){
 if(!/^[a-z0-9][a-z0-9:./_-]+$/.test(tag)||!/^sha256:[a-f0-9]{64}$/.test(id))throw Error('IMAGE_REFERENCE_INVALID');
 const actual=execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
 if(actual!==id)throw Error('LOADED_IMAGE_MISMATCH');
}
process.stdout.write('Loaded OCI image IDs match signed manifest.\n');
