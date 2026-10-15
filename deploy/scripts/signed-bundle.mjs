import {verify,createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
export async function verifySignedBundle(root,keyFile){
 if((await lstat(root)).isSymbolicLink())throw Error('BUNDLE_SYMLINK');
 const raw=await readFile(path.join(root,'manifest.json'));if(raw.length>1024*1024)throw Error('MANIFEST_TOO_LARGE');
 if(!verify(null,raw,await readFile(keyFile),await readFile(path.join(root,'manifest.sig'))))throw Error('SIGNATURE_INVALID');
 const m=JSON.parse(raw);if(m.syntheticOnly!==true||!m.files||typeof m.files!=='object')throw Error('BUNDLE_MANIFEST_INVALID');
 const files={};
 async function walk(relative=''){for(const e of await readdir(path.join(root,relative),{withFileTypes:true})){const n=relative?`${relative}/${e.name}`:e.name;if(['manifest.json','manifest.sig'].includes(n))continue;if(e.isSymbolicLink())throw Error('BUNDLE_SYMLINK');if(e.isDirectory())await walk(n);else if(e.isFile()){const h=createHash('sha256');for await(const chunk of createReadStream(path.join(root,n)))h.update(chunk);files[n]=h.digest('hex');}else throw Error('BUNDLE_UNEXPECTED_ENTRY');}}
 for(const n of Object.keys(m.files)){if(path.isAbsolute(n)||n.includes('\\')||n.split('/').some(s=>!s||s==='..'||s==='.'))throw Error('BUNDLE_UNSAFE_PATH');}
 await walk();
 if(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))))!==JSON.stringify(m.files))throw Error('CHECKSUM_OR_FILESET_INVALID');
 return m;
}
