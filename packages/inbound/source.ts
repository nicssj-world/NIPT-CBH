import path from 'node:path';
import {confined} from '../storage';
import {simulatorRoot,assertSimulatorRoot} from '../integrations/scanner';
import {openAuthorizedDirectory,shareError} from '../integrations/authorized-share';
export interface InboundSource {id:string;assert:()=>Promise<void>;file:(relative:string)=>Promise<string>;}
/** Existing discovery keeps its inbound/YYYYMMDD logical names. A configured base path points
 * directly at the daily-folder parent, and source IDs prevent same-name/mtime suppression on path change. */
export async function openInboundSource(basePath:string,secretRef:string|null):Promise<InboundSource>{
 if(basePath==='simulator/inbound'){
  if(secretRef!==null)throw Error('SHARE_CREDENTIAL_REFERENCE_MISMATCH');const root=simulatorRoot();
  await assertSimulatorRoot(root);return {id:'SIMULATOR',assert:()=>assertSimulatorRoot(root),file:relative=>confined(root,relative)};
 }
 const d=await openAuthorizedDirectory(basePath,'INBOUND',secretRef);
 return {id:path.resolve(basePath),assert:()=>d.assert(),file:relative=>{if(!relative.startsWith('inbound/'))throw Error('UNSAFE_SHARE_PATH');return d.file(relative.slice(8));}};
}
export const inboundReadError=(e:unknown)=>['ENOENT','SHARE_PATH_NOT_FOUND'].includes((e as NodeJS.ErrnoException)?.code??(e instanceof Error?e.message:''));
export const inboundAccessError=shareError;
