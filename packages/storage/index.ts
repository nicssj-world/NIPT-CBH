import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function confined(root:string,relative:string,create=false){
 if(root.startsWith('\\')||root.startsWith('//'))throw Error('NETWORK_PATH_PROHIBITED');
 if(!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(x=>x==='..'||x==='.'||!x)||/[\0\r\n:]/.test(relative))throw Error('UNSAFE_PATH');
 if(create)await fs.mkdir(root,{recursive:true});
 if((await fs.lstat(root)).isSymbolicLink())throw Error('SYMLINK_PROHIBITED');const base=await fs.realpath(root);const canonical=(p:string)=>process.platform==='win32'?p.toLowerCase():p;if(canonical(base)!==canonical(path.resolve(root)))throw Error('SYMLINK_PROHIBITED'); const parts=relative.split('/');let current=base;
 for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);try{const st=await fs.lstat(current);if(st.isSymbolicLink())throw Error('SYMLINK_PROHIBITED');if(i<parts.length-1&&!st.isDirectory())throw Error('NOT_DIRECTORY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i<parts.length-1){try{await fs.mkdir(current);}catch(m){if((m as NodeJS.ErrnoException).code!=='EEXIST')throw m;}const st=await fs.lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw Error('SYMLINK_PROHIBITED');}}}
 if(!current.startsWith(base+path.sep))throw Error('PATH_ESCAPE');return current;
}
export async function immutableWrite(root:string,key:string,bytes:Buffer){
 const dest=await confined(root,key,true),tmp=await confined(root,`stage/${randomUUID()}`,true);
 // A crash may leave an unreferenced stage file; final names expose only fsynced complete bytes.
 let file;try{file=await fs.open(tmp,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined;
  try{await fs.link(tmp,dest);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(sha256(await fs.readFile(dest))!==sha256(bytes))throw Error('IMMUTABLE_COLLISION');}
 }finally{await file?.close();await fs.unlink(tmp).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});}
 return dest;
}
export class FileStore{constructor(readonly root:string){} async put(bytes:Buffer){const hash=sha256(bytes);await immutableWrite(this.root,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`,bytes);return hash;} async get(hash:string){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('INVALID_HASH');const bytes=await fs.readFile(await confined(this.root,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`));if(sha256(bytes)!==hash)throw Error('HASH_MISMATCH');return bytes;}}
export const atomicImmutableWrite=immutableWrite;
