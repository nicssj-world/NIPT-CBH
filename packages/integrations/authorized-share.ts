import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {z} from 'zod';
export type SharePurpose='INBOUND'|'OUTBOUND'|'RESULTS';
const policySchema=z.strictObject({version:z.literal(1),grants:z.array(z.strictObject({root:z.string().min(1),purposes:z.array(z.enum(['INBOUND','OUTBOUND','RESULTS'])).min(1),serviceAccount:z.string().min(1),secretRef:z.uuid().nullable(),mode:z.enum(['synthetic','operational']).optional()})).min(1)});
const canonical=(p:string)=>process.platform==='win32'?p.toLowerCase():p;
export const isWithinShareRoot=(root:string,p:string)=>{const relative=path.relative(canonical(root),canonical(p));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function workerServiceAccount(){return process.platform==='win32'?execFileSync(path.join(process.env.SystemRoot??'C:\\Windows','System32','whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim():os.userInfo().username;}
export function shareError(e:unknown):string {
 const code=(e as NodeJS.ErrnoException)?.code;
 if(code==='EACCES'||code==='EPERM')return 'SHARE_PERMISSION_DENIED';
 if(code==='ENOENT')return 'SHARE_PATH_NOT_FOUND';
 if(code==='ENOTDIR')return 'SHARE_NOT_DIRECTORY';
 if(e instanceof Error&&/^[A-Z][A-Z0-9_]{1,63}$/.test(e.message))return e.message;
 return 'SHARE_FILE_ACCESS_FAILED';
}
function absolute(p:string){
 if(!path.isAbsolute(p)||/[\r\n\0*?"<>|]/.test(p)||p.startsWith('\\\\.\\')||p.startsWith('\\\\?\\'))throw Error('UNSAFE_SHARE_PATH');
 const rest=p.slice(path.parse(p).root.length);
 if(rest.includes(':')||rest.split(/[\\/]/).some(s=>s==='..'||s==='.'||/[. ]$/.test(s)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)))throw Error('UNSAFE_SHARE_PATH');
 return path.resolve(p);
}
function relative(p:string){if(!p||p.includes('\\')||/[\r\n\0:*?"<>|]/.test(p)||path.isAbsolute(p)||p.split('/').some(s=>!s||s==='..'||s==='.'||/[. ]$/.test(s)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)))throw Error('UNSAFE_SHARE_PATH');}
async function checked(p:string,file=false,ownedTwin=false){const st=await fs.lstat(p);if(st.isSymbolicLink()||file&&st.nlink!==1&&!(ownedTwin&&st.nlink===2))throw Error('SHARE_LINK_PROHIBITED');if(file?!st.isFile():!st.isDirectory())throw Error(file?'SHARE_NOT_FILE':'SHARE_NOT_DIRECTORY');if(canonical(await fs.realpath(p))!==canonical(path.resolve(p)))throw Error('SHARE_LINK_PROHIBITED');return st;}
/** Directories the HIS interface must never read from or write into, whatever is saved in Settings. */
function systemDirectory(p:string){
 if(process.platform!=='win32')return ['/bin','/boot','/dev','/etc','/lib','/proc','/sbin','/sys','/usr'].some(d=>isWithinShareRoot(d,p))||path.parse(p).root===p;
 const env=[process.env.SystemRoot,process.env.windir,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData,process.env.PROGRAMFILES].filter((d):d is string=>!!d);
 // The evidence file store is never a HIS folder (outbound only creates new files, so it cannot overwrite application files).
 const app=[process.env.FILE_STORE_ROOT].filter((d):d is string=>!!d).map(d=>path.resolve(d));
 return [...env,...app].some(d=>isWithinShareRoot(path.resolve(d),p));
}
/** OWNER-LAB-055/059 (Owner final lock 2026-10-25): in operational mode the HIS folders saved through Settings are the
 * authority — an administrator corrects a wrong path in Settings and the worker uses it on its next job, with no file,
 * registry or environment edit. The deployment policy file remains an OPTIONAL IT lockdown: it is enforced only when
 * NIPT_HIS_SHARE_POLICY_ENFORCE=1. Without lockdown every access still checks: absolute safe path, existing directory,
 * no link/junction escape, not a system/application directory. Synthetic mode keeps the policy file and test marker.
 * Authentication is the worker OS account's existing SMB session; no passwords enter jobs/logs. */
export async function openAuthorizedDirectory(input:string,purpose:SharePurpose,secretRef:string|null){
 const base=absolute(input);
 const authorize=async()=>{
  if(!['synthetic','operational'].includes(process.env.NIPT_MODE??''))throw Error('HIS_SYNTHETIC_ONLY');
  if(process.env.NIPT_MODE==='operational'&&process.env.NIPT_HIS_SHARE_POLICY_ENFORCE!=='1'){
   if(systemDirectory(base))throw Error('SHARE_SYSTEM_PATH_PROHIBITED');
   await checked(base);return base;
  }
  const file=process.env.NIPT_HIS_SHARE_POLICY_FILE;if(!file)throw Error('SHARE_POLICY_REQUIRED');
  let policy:z.infer<typeof policySchema>;try{policy=policySchema.parse(JSON.parse(await fs.readFile(file,'utf8')));}catch{throw Error('SHARE_POLICY_INVALID');}
  const matches=policy.grants.filter(g=>isWithinShareRoot(absolute(g.root),base)&&g.purposes.includes(purpose));
  if(matches.length!==1)throw Error('SHARE_ROOT_NOT_ALLOWED');const grant=matches[0],root=absolute(grant.root);
  if((grant.mode??'synthetic')!==process.env.NIPT_MODE)throw Error('SHARE_MODE_NOT_ALLOWED');
  if(canonical(grant.serviceAccount)!==canonical(workerServiceAccount()))throw Error('SHARE_SERVICE_ACCOUNT_MISMATCH');
  if(grant.secretRef!==secretRef)throw Error('SHARE_CREDENTIAL_REFERENCE_MISMATCH');
  await checked(root);
  if(process.env.NIPT_MODE==='synthetic'){
   const mark=path.join(root,'.nipt-authorized-test-root');
   try{await checked(mark,true);if((await fs.readFile(mark,'utf8')).trim()!=='NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1')throw Error();}catch{throw Error('SHARE_TEST_MARKER_REQUIRED');}
  }
  let current=root;for(const part of path.relative(root,base).split(path.sep).filter(Boolean)){current=path.join(current,part);await checked(current);}
  return root;
 };
 try{await authorize();}catch(e){throw Error(shareError(e));}
 return {base,purpose,secretRef,async assert(){try{await authorize();}catch(e){throw Error(shareError(e));}},
  async file(name:string,createParents=false,ownedTwin=false){
   relative(name);if(createParents&&purpose!=='OUTBOUND')throw Error('INBOUND_READ_ONLY');
   try{await authorize();const parts=name.split('/');let current=base;
    for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);const leaf=i===parts.length-1;
     try{if(leaf){const st=await fs.lstat(current);await checked(current,st.isFile(),ownedTwin);if(!st.isFile()&&!st.isDirectory())throw Error('SHARE_NOT_FILE');}else await checked(current);}
     catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(leaf)return current;if(!createParents)throw e;try{await fs.mkdir(current,{mode:0o700});}catch(m){if((m as NodeJS.ErrnoException).code!=='EEXIST')throw m;}await checked(current);}
    }return current;
   }catch(e){throw Error(shareError(e));}
  }};
}
export type AuthorizedDirectory=Awaited<ReturnType<typeof openAuthorizedDirectory>>;
