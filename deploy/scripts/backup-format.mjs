import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export const FORMAT='NIPT_SYNTHETIC_BACKUP_V2';
export const MAX_ARCHIVE_BYTES=512*1024*1024;
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function checkSize(size,remaining=MAX_ARCHIVE_BYTES){if(!Number.isSafeInteger(size)||size<0||size>remaining)throw Error('BACKUP_SIZE_LIMIT');}
export async function readBoundedFile(file,remaining=MAX_ARCHIVE_BYTES){
 const handle=await fs.open(file,'r');
 try{const st=await handle.stat();checkSize(st.size,remaining);const bytes=Buffer.alloc(st.size);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw Error('BACKUP_SOURCE_CHANGED');offset+=bytesRead;}
  if((await handle.read(Buffer.alloc(1),0,1,offset)).bytesRead)throw Error('BACKUP_SOURCE_CHANGED');return bytes;
 }finally{await handle.close();}
}
export function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function safeName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f\x7f:]/.test(p)||/[. ]$/.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))throw Error('BACKUP_UNSAFE_PATH');
 return name;
}
export async function checkedPath(input,{missing=false,fresh=false}={}){
 const absolute=path.resolve(input),parsed=path.parse(absolute);
 if(parsed.root.startsWith('\\')||parsed.root.startsWith('//'))throw Error('BACKUP_NETWORK_PATH');
 let current=parsed.root;
 for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  try{const s=await fs.lstat(current);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('BACKUP_LINK_PROHIBITED');
   const norm=s=>process.platform==='win32'?s.toLowerCase():s;
   if(norm(await fs.realpath(current))!==norm(current))throw Error('BACKUP_LINK_PROHIBITED');
   if(current===absolute&&fresh)throw Error('BACKUP_DESTINATION_EXISTS');
  }catch(e){if(e.code!=='ENOENT'||!missing)throw e;}
 }
 return absolute;
}
export function disjoint(...roots){
 const a=roots.map(p=>path.resolve(p).toLowerCase());
 if(a.some((p,i)=>a.some((q,j)=>i!==j&&(p===q||p.startsWith(q+path.sep)))))throw Error('BACKUP_ROOT_OVERLAP');
}
export async function inventory(root,budget={bytes:1024}){
 root=await checkedPath(root);const rows=[];
 const walk=async(relative='')=>{for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
  const name=relative?relative+'/'+entry.name:entry.name;safeName(name);const file=await checkedPath(path.join(root,...name.split('/'))),st=await fs.lstat(file);
  if(st.isDirectory())await walk(name);else if(st.isFile()){
   checkSize(st.size);const archiveCost=512+Math.ceil(st.size/512)*512;checkSize(archiveCost,MAX_ARCHIVE_BYTES-budget.bytes);budget.bytes+=archiveCost;
   rows.push({path:name,bytes:st.size,sha256:sha(await readBoundedFile(file,st.size))});
  }else throw Error('BACKUP_UNSAFE_NODE');
 }};await walk();return rows.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function validateEntries(entries){
 const seen=new Map();for(const e of entries){safeName(e.path);const key=e.path.toLowerCase();if(seen.has(key))throw Error('BACKUP_DUPLICATE_ENTRY');seen.set(key,e);}
 for(const e of entries)for(const p of e.path.split('/').slice(0,-1).map((_,i)=>e.path.split('/').slice(0,i+1).join('/').toLowerCase()))if(seen.has(p)&&!seen.get(p).directory)throw Error('BACKUP_FILE_PARENT');
}
/** Restricted USTAR writer/reader. No platform tar extraction or extension/link interpretation. */
export function pack(input){
 const entries=[...input].sort((a,b)=>a.path.localeCompare(b.path,'en'));validateEntries(entries);const chunks=[];let total=1024;
 for(const e of entries){const b=Buffer.from(e.bytes),header=Buffer.alloc(512);let name=e.path,prefix='';
  if(Buffer.byteLength(name)>100){const split=name.lastIndexOf('/');prefix=name.slice(0,split);name=name.slice(split+1);}
  if(Buffer.byteLength(name)>100||Buffer.byteLength(prefix)>155||!name)throw Error('BACKUP_PATH_TOO_LONG');
  header.write(name,0,100,'utf8');header.write('0000600\0',100,'ascii');header.write('0000000\0',108,'ascii');header.write('0000000\0',116,'ascii');header.write(b.length.toString(8).padStart(11,'0')+'\0',124,'ascii');header.write('00000000000\0',136,'ascii');header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,'ascii');header.write('00',263,'ascii');header.write(prefix,345,155,'utf8');header.write(header.reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148,'ascii');
  const pad=Buffer.alloc((512-b.length%512)%512);total+=512+b.length+pad.length;if(total>MAX_ARCHIVE_BYTES)throw Error('BACKUP_SIZE_LIMIT');chunks.push(header,b,pad);
 }return Buffer.concat([...chunks,Buffer.alloc(1024)]);
}
export function unpack(buffer){
 if(buffer.length>MAX_ARCHIVE_BYTES||buffer.length%512)throw Error('BACKUP_ARCHIVE_SIZE');const entries=[];let offset=0,ended=false;
 const text=(h,a,n)=>h.subarray(a,a+n).toString('utf8').replace(/\0.*$/s,'');
 const octal=(h,a,n)=>{const s=text(h,a,n).trim();if(!/^[0-7]+$/.test(s))throw Error('BACKUP_TAR_NUMBER');const v=parseInt(s,8);if(!Number.isSafeInteger(v))throw Error('BACKUP_TAR_NUMBER');return v;};
 while(offset+512<=buffer.length){const h=buffer.subarray(offset,offset+512);if(h.every(v=>v===0)){if(offset+1024>buffer.length||!buffer.subarray(offset).every(v=>v===0))throw Error('BACKUP_TAR_TRAILING');ended=true;break;}
  const expected=octal(h,148,8),copy=Buffer.from(h);copy.fill(32,148,156);if(copy.reduce((a,v)=>a+v,0)!==expected)throw Error('BACKUP_TAR_CHECKSUM');
  if(text(h,257,6)!=='ustar')throw Error('BACKUP_TAR_FORMAT');const type=h[156];if(![0,48,53].includes(type)||text(h,157,100))throw Error('BACKUP_UNSAFE_TYPE');
  const prefix=text(h,345,155),raw=(prefix?prefix+'/':'')+text(h,0,100),directory=type===53,name=directory?raw.replace(/\/$/,''):raw;safeName(name);
  const size=octal(h,124,12),end=offset+512+size,next=offset+512+Math.ceil(size/512)*512;
  if(end>buffer.length||next>buffer.length||directory&&size!==0)throw Error('BACKUP_TAR_TRUNCATED');
  if(!buffer.subarray(end,next).every(v=>v===0))throw Error('BACKUP_TAR_PADDING');entries.push({path:name,bytes:buffer.subarray(offset+512,end),directory});offset=next;
 }if(!ended)throw Error('BACKUP_TAR_TRUNCATED');validateEntries(entries);return entries;
}
export async function extract(entries,root){
 for(const e of entries){const target=await checkedPath(path.join(root,...safeName(e.path).split('/')),{missing:true});if(e.directory){await fs.mkdir(target,{recursive:true});continue;}
  await fs.mkdir(path.dirname(target),{recursive:true});await checkedPath(target,{missing:true,fresh:true});await fs.writeFile(target,e.bytes,{flag:'wx',mode:0o600});
 }
}
export async function p6Coverage(db){
 const exists=(await db.query("SELECT to_regclass('public.p6_fixture') present")).rows[0].present;
 if(!exists)return {sandboxIds:[],fixtureCount:0,transferCount:0,journalSha256:sha(Buffer.from(canonical({})))};
 const tables=['p6_fixture','p6_transfer','p6_transfer_event','p6_reconciliation','p6_worker_heartbeat'],journal={};
 for(const t of tables)journal[t]=(await db.query(`SELECT to_jsonb(t) row FROM public.${t} t`)).rows.map(r=>r.row).sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
 const sandboxIds=[...new Set(journal.p6_fixture.map(r=>r.sandbox_id))].sort();
 if(sandboxIds.some(id=>!/^SYNTHETIC-[A-Za-z0-9_-]{1,90}$/.test(id)))throw Error('BACKUP_P6_ID');
 return {sandboxIds,fixtureCount:journal.p6_fixture.length,transferCount:journal.p6_transfer.length,journalSha256:sha(Buffer.from(canonical(journal)))};
}
