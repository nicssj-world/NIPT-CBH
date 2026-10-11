import {verify,createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
const [root,keyFile]=process.argv.slice(2);if(!root||!keyFile)throw Error('BUNDLE_AND_TRUSTED_KEY_REQUIRED');
const raw=await readFile(path.join(root,'manifest.json'));if(raw.length>1024*1024)throw Error('MANIFEST_TOO_LARGE');
if(!verify(null,raw,await readFile(keyFile),await readFile(path.join(root,'manifest.sig'))))throw Error('SIGNATURE_INVALID');
const m=JSON.parse(raw);if(m.syntheticOnly!==true)throw Error('SYNTHETIC_ONLY');
const files={};async function walk(relative=''){for(const e of await readdir(path.join(root,relative),{withFileTypes:true})){const n=relative?`${relative}/${e.name}`:e.name;if(['manifest.json','manifest.sig'].includes(n))continue;if(e.isSymbolicLink())throw Error('SYMLINK');if(e.isDirectory())await walk(n);else{const h=createHash('sha256');for await(const chunk of createReadStream(path.join(root,n)))h.update(chunk);files[n]=h.digest('hex');}}}await walk();
for(const n of Object.keys(m.files)){if(path.isAbsolute(n)||n.includes('\\')||n.split('/').some(s=>!s||s==='..'||s==='.'))throw Error('UNSAFE_PATH');if((await lstat(path.join(root,n))).isSymbolicLink())throw Error('SYMLINK');}
if(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))))!==JSON.stringify(m.files))throw Error('CHECKSUM_OR_FILESET_INVALID');
process.stdout.write('Verified signed synthetic bundle and exact file set.\n');
