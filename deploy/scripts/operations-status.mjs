/** Optional operator-owned signed receipts. Web receives only the PUBLIC key.
 * These receipts attest completed code paths, never filesystem existence. */
import {createHash,createPrivateKey,createPublicKey,sign,verify,randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,checkedPath} from './backup-format.mjs';
const FORMAT='NIPT_OPERATIONS_STATUS_V1';
export function databaseFingerprint(raw){const u=new URL(raw);return createHash('sha256').update(canonical({host:u.hostname.toLowerCase(),port:u.port||'5432',database:decodeURIComponent(u.pathname.slice(1))})).digest('hex');}
function validEvent(e){return e===null||e&&/^[a-f0-9]{64}$/.test(e.manifestSha256)&&Number.isFinite(Date.parse(e.at))&&['CREATION_VERIFIED','RESTORE_VERIFIED'].includes(e.verification);}
export function verifyOperationsStatus(envelope,key,fingerprint,now=new Date()){
 const p=envelope?.payload;if(p?.format!==FORMAT||p.sourceFingerprint!==fingerprint||!Number.isFinite(Date.parse(p.generatedAt))||Date.parse(p.generatedAt)>now.getTime()+5000||!validEvent(p.backup)||!validEvent(p.restore))throw Error('OPERATIONS_STATUS_INVALID');
 for(const e of [p.backup,p.restore])if(e&&Date.parse(e.at)>now.getTime()+5000)throw Error('OPERATIONS_STATUS_INVALID');
 const publicKey=createPublicKey(key);if(publicKey.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(canonical(p)),publicKey,Buffer.from(envelope.signature??'','base64')))throw Error('OPERATIONS_STATUS_SIGNATURE_INVALID');return p;
}
export async function readOperationsStatus(file,keyFile,fingerprint){const raw=await fs.readFile(await checkedPath(file));if(raw.length>65536)throw Error('OPERATIONS_STATUS_TOO_LARGE');const key=await fs.readFile(await checkedPath(keyFile));return verifyOperationsStatus(JSON.parse(raw.toString('utf8')),key,fingerprint);}
export async function publishOperationsStatus(kind,result,env=process.env){
 if(!env.NIPT_OPERATIONS_STATUS_FILE&&!env.NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE)return {status:'NOT CONFIGURED'};
 let lock,file,temp;
 try{
  if(env.NIPT_MODE!=='operational'||!env.NIPT_OPERATIONS_STATUS_FILE||!env.NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE||!env.DATABASE_URL)throw Error('OPERATIONS_STATUS_CONFIGURATION_REQUIRED');
  file=await checkedPath(env.NIPT_OPERATIONS_STATUS_FILE,{missing:true});const key=createPrivateKey(await fs.readFile(await checkedPath(env.NIPT_OPERATIONS_STATUS_SIGNING_KEY_FILE)));if(key.asymmetricKeyType!=='ed25519')throw Error('OPERATIONS_STATUS_KEY_REQUIRED');
  lock=await fs.open(file+'.lock','wx',0o600);const fingerprint=databaseFingerprint(env.DATABASE_URL),now=new Date().toISOString();let old={backup:null,restore:null};
  try{const bytes=await fs.readFile(file);if(bytes.length>65536)throw Error('OPERATIONS_STATUS_TOO_LARGE');old=verifyOperationsStatus(JSON.parse(bytes.toString('utf8')),createPublicKey(key).export({type:'spki',format:'pem'}),fingerprint);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!result||!result.createdAt||!/^[a-f0-9]{64}$/.test(result.manifestSha256))throw Error('VERIFIED_OPERATION_RESULT_REQUIRED');
  if(kind==='restore'&&(result.restoreVerified!==true||result.sourceFingerprint!==fingerprint))throw Error('VERIFIED_RESTORE_RESULT_REQUIRED');
  if(!['backup','restore'].includes(kind))throw Error('OPERATION_KIND_REQUIRED');
  const payload={format:FORMAT,sourceFingerprint:fingerprint,generatedAt:now,backup:old.backup,restore:old.restore,[kind]:{at:result.createdAt,manifestSha256:result.manifestSha256,verification:kind==='backup'?'CREATION_VERIFIED':'RESTORE_VERIFIED'}};
  temp=path.join(path.dirname(file),'.operations-'+randomUUID());await fs.writeFile(temp,JSON.stringify({payload,signature:sign(null,Buffer.from(canonical(payload)),key).toString('base64')}),{flag:'wx',mode:0o600});await fs.rename(temp,file);temp=undefined;return {status:'PUBLISHED'};
 }catch{return {status:'NOT VERIFIED'};}finally{if(temp)await fs.unlink(temp).catch(()=>{});if(lock){await lock.close();await fs.unlink(file+'.lock').catch(()=>{});}}
}
