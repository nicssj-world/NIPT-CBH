import {createHash} from 'node:crypto';
import {readdir,readFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
export const roles=['web','operations','renderer','postgres','caddy'];
export async function createFreshBundleDirectory(destination,base){
 destination=path.resolve(destination);base=path.resolve(base);
 if(!destination.startsWith(base+path.sep))throw Error('BUNDLE_MUST_BE_IN_LOCAL_BUNDLES');
 let cursor=path.parse(destination).root;
 for(const segment of destination.slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,segment);
  try{const info=await lstat(cursor);if(info.isSymbolicLink())throw Error('BUNDLE_PARENT_LINK_PROHIBITED');if(cursor===destination)throw Error('FRESH_BUNDLE_DESTINATION_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
}
export async function migrationInventory(directory){
 const names=(await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 if(!names.length)throw Error('MIGRATIONS_REQUIRED');
 const files={};for(const name of names)files[name]=createHash('sha256').update(await readFile(path.join(directory,name))).digest('hex');
 return {files,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export function imageContract(m){
 if(m.syntheticOnly!==true||!m.images||Object.keys(m.images).length!==5||!m.imageRoles||Object.keys(m.imageRoles).sort().join()!==[...roles].sort().join())throw Error('IMAGE_MANIFEST_INVALID');
 if(!/^[a-f0-9]{40}$/.test(m.provenance?.revision??'')||!/^[a-f0-9]{64}$/.test(m.provenance?.migrationsSha256??''))throw Error('SOURCE_PROVENANCE_REQUIRED');
 const result={};
 for(const role of roles){const tag=m.imageRoles[role],id=m.images[tag];if(typeof tag!=='string'||!/^[a-z0-9][a-z0-9:./_-]+$/.test(tag)||!/^sha256:[a-f0-9]{64}$/.test(id??''))throw Error('IMAGE_REFERENCE_INVALID');result[role]=id;}
 if(new Set(Object.values(m.imageRoles)).size!==5)throw Error('IMAGE_ROLE_ALIAS');
 return result;
}
export function assertImageProvenance(image,role,m){
 if(['web','operations','renderer'].includes(role)){
  const labels=image.Config?.Labels;
  if(labels?.['org.opencontainers.image.revision']!==m.provenance.revision||labels?.['org.nipt.migrations.sha256']!==m.provenance.migrationsSha256)throw Error('IMAGE_SOURCE_OR_MIGRATION_MISMATCH');
 }
}
