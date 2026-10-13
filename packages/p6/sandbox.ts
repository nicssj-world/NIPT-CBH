import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {validateSyntheticPaths,initialTransfer,type SyntheticDraft,type SyntheticTransfer} from './transfer';

export type Artifact='PDF'|'RES'|'BACKUP'|'OK';
export type FilePoint='BEFORE_WRITE'|'AFTER_TEMP_SYNC'|'BEFORE_PUBLISH'|'AFTER_LINK'|'AFTER_PUBLISH'|'AFTER_VERIFY';
export type FileHook=(event:{artifact:Artifact;point:FilePoint})=>Promise<void>;
export type OkPublicationFence=(publish:()=>Promise<void>)=>Promise<void>;
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const canon=(s:string)=>process.platform==='win32'?s.toLowerCase():s;
const marker=Buffer.from('NIPT_P6_SYNTHETIC_ONLY_V1\n');
export function assertSandboxEnabled(){if(process.env.NIPT_MODE!=='synthetic'||process.env.NIPT_P6_SANDBOX_ENABLED!=='yes')throw Error('P6_SANDBOX_DISABLED');}
function safeRelative(relative:string){
  if(!relative||relative.includes('\\')||!relative.split('/').every(p=>/^[A-Za-z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'&&!p.endsWith('.')&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))throw Error('UNSAFE_SANDBOX_PATH');
}

/** Every ancestor is inspected before any creation, including the fixed project-root ancestors.
 * This local sandbox uses owner-controlled directories. Hostile concurrent OS namespace mutation
 * and hospital filesystem/ACL semantics are not certified by this test transport. */
async function checked(absolute:string,createDirectories=false,leafFile=false,ownedTwin=false){
  const parsed=path.parse(path.resolve(absolute));
  if(parsed.root.startsWith('\\')||parsed.root.startsWith('//'))throw Error('NETWORK_PATH_PROHIBITED');
  let current=parsed.root;const parts=path.resolve(absolute).slice(parsed.root.length).split(path.sep).filter(Boolean);
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);const file=leafFile&&i===parts.length-1;
    let st;
    try{st=await fs.lstat(current);}catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      if(file)return current;
      if(!createDirectories)throw e;
      try{await fs.mkdir(current,{mode:0o700});}catch(m){if((m as NodeJS.ErrnoException).code!=='EEXIST')throw m;}
      st=await fs.lstat(current);
    }
    if(st.isSymbolicLink()||file&&st.nlink!==1&&!(ownedTwin&&st.nlink===2))throw Error('LINK_PROHIBITED');
    if(file?!st.isFile():!st.isDirectory())throw Error('INVALID_SANDBOX_NODE');
    if(canon(await fs.realpath(current))!==canon(path.resolve(current)))throw Error('LINK_PROHIBITED');
  }
  return current;
}

export async function openSandbox(id:string,settings:SyntheticDraft['settings'],hook?:FileHook,fence?:OkPublicationFence){
  assertSandboxEnabled();z.string().regex(/^SYNTHETIC-[A-Za-z0-9_-]+$/).max(100).parse(id);
  const config=validateSyntheticPaths(settings),dirs=[config.resDirectory,config.pdfDirectory,config.backupDirectory].map(s=>s.toLowerCase());
  if(dirs.some((a,i)=>dirs.some((b,j)=>i!==j&&(a===b||a.startsWith(b+'/')))))throw Error('PATH_ALIAS');
  const root=path.resolve(projectRoot,'.local','p6-sandbox',id);
  await checked(root,true);
  const target=async(relative:string,create=false,ownedTwin=false)=>{
    assertSandboxEnabled();safeRelative(relative);
    const absolute=path.resolve(root,...relative.split('/'));
    if(!absolute.startsWith(root+path.sep))throw Error('UNSAFE_SANDBOX_PATH');
    return checked(absolute,create,true,ownedTwin);
  };
  const mark=await target('.p6-synthetic-root');
  try{await fs.writeFile(mark,marker,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  if(!(await fs.readFile(await target('.p6-synthetic-root'))).equals(marker))throw Error('SANDBOX_MARKER_REQUIRED');
  const prepare=async()=>{for(const d of [config.pdfDirectory,config.resDirectory,config.backupDirectory,'stage'])await checked(path.join(root,...d.split('/')),true);};
  await prepare();
  const read=async(relative:string)=>fs.readFile(await target(relative));
  const verify=async(relative:string,expected:Buffer)=>{
    const actual=await read(relative);if(actual.length!==expected.length||hash(actual)!==hash(expected))throw Error('DESTINATION_COLLISION');
  };
  const atomic=async(relative:string,bytes:Buffer,artifact:Artifact,fingerprint:string)=>{
    await hook?.({artifact,point:'BEFORE_WRITE'});
    // Staging identity is derived from the immutable DB-journaled fingerprint and exact destination.
    // A matching two-link twin can therefore be recovered without accepting external hardlinks.
    const stageKey='stage/SYNTHETIC-'+fingerprint+'-'+hash(Buffer.from(relative))+'.part';
    const destination=await target(relative,true,true),temp=await target(stageKey,true,true);
    const status=async(p:string)=>fs.lstat(p,{bigint:true}).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;});
    const ds=await status(destination),ts=await status(temp);
    if(ds?.nlink===2n){
      if(!ts||ts.nlink!==2n||ds.ino!==ts.ino||ds.dev!==ts.dev||hash(await fs.readFile(destination))!==hash(bytes)||hash(await fs.readFile(temp))!==hash(bytes))throw Error('LINK_PROHIBITED');
      if(artifact==='OK')throw Error('AMBIGUOUS_OK_LINK');
      await fs.unlink(temp);await verify(relative,bytes);return;
    }
    if(ts&&ts.nlink!==1n)throw Error('LINK_PROHIBITED');
    try{await verify(relative,bytes);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let handle;
    try{
      // An incomplete, single-link staging file owned by this frozen transfer is never a final
      // artifact. It can be safely removed/recreated; final destination names are never deleted.
      if(ts&&hash(await fs.readFile(temp))!==hash(bytes))await fs.unlink(temp);
      if(!await status(temp)){handle=await fs.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;}
      if(hash(await read(stageKey))!==hash(bytes))throw Error('HASH_MISMATCH');
      await hook?.({artifact,point:'AFTER_TEMP_SYNC'});
      await target(relative); // Recheck parent/link policy before exclusive publication.
      await hook?.({artifact,point:'BEFORE_PUBLISH'});
      const publish=async()=>{
        try{await fs.link(temp,destination);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
        await hook?.({artifact,point:'AFTER_LINK'});await fs.unlink(temp);
        await hook?.({artifact,point:'AFTER_PUBLISH'});await verify(relative,bytes);await hook?.({artifact,point:'AFTER_VERIFY'});
      };
      if(artifact==='OK'&&fence)await fence(publish);else await publish();
    }finally{await handle?.close();await fs.unlink(temp).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});}
  };
  const names=(p:SyntheticTransfer)=>{
    initialTransfer(p,0);safeRelative(p.pdfName);safeRelative(p.resName);safeRelative(p.okName);
    const prefix=config.backupDirectory+'/'+p.fixtureId;
    return {PDF:config.pdfDirectory+'/'+p.pdfName,RES:config.resDirectory+'/'+p.resName,OK:config.resDirectory+'/'+p.okName,
      backupPdf:prefix+'/'+p.pdfName,backupRes:prefix+'/'+p.resName,manifest:prefix+'/manifest.json'};
  };
  const manifest=(p:SyntheticTransfer)=>Buffer.from(JSON.stringify({syntheticOnly:true,fingerprint:p.fingerprint,pdfHash:p.pdfHash,resHash:p.resHash,pdfName:p.pdfName,resName:p.resName})+'\n');
  const backupVerified=async(p:SyntheticTransfer)=>{const n=names(p);await verify(n.backupPdf,Buffer.from(p.pdfHex,'hex'));await verify(n.backupRes,Buffer.from(p.resHex,'hex'));await verify(n.manifest,manifest(p));return true;};
  return {id,root,prepare,backupVerified,
    async read(artifact:Exclude<Artifact,'BACKUP'>,p:SyntheticTransfer){return read(names(p)[artifact]);},
    async exists(artifact:Exclude<Artifact,'BACKUP'>,p:SyntheticTransfer){try{await read(names(p)[artifact]);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}},
    async ensure(artifact:Artifact,p:SyntheticTransfer){
      const n=names(p),pdf=Buffer.from(p.pdfHex,'hex'),res=Buffer.from(p.resHex,'hex');
      if(artifact==='PDF')return atomic(n.PDF,pdf,'PDF',p.fingerprint);
      if(artifact==='RES'){await verify(n.PDF,pdf);return atomic(n.RES,res,'RES',p.fingerprint);}
      if(artifact==='BACKUP'){
        await verify(n.PDF,pdf);await verify(n.RES,res);
        await atomic(n.backupPdf,pdf,'BACKUP',p.fingerprint);await atomic(n.backupRes,res,'BACKUP',p.fingerprint);await atomic(n.manifest,manifest(p),'BACKUP',p.fingerprint);await backupVerified(p);return;
      }
      if(artifact!=='OK')throw Error('INVALID_ARTIFACT');
      try{await verify(n.PDF,pdf);await verify(n.RES,res);await backupVerified(p);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw Error('PREREQUISITE_MISSING');throw e;}
      return atomic(n.OK,Buffer.from([255,254]),'OK',p.fingerprint);
    },
  };
}
export type Sandbox=Awaited<ReturnType<typeof openSandbox>>;
