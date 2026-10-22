import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const roots=['src','packages','apps','tools','deploy','db','public','tests','docs'];
const configs=['Dockerfile','.dockerignore','.gitignore','AGENTS.md','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs','vitest.config.ts','playwright.config.ts'];
const text=/\.(?:[cm]?[jt]sx?|css|sql|json|md|ya?ml|ps1|psm1|py|vbs|html|xml|csv|svg|sh|txt|toml|example)$/i;
export function sourceHash(bytes,name){return sha(text.test(name)||configs.includes(name)?Buffer.from((bytes[0]===255&&bytes[1]===254?bytes.toString('utf16le'):bytes.toString('utf8')).replace(/^\uFEFF/,'').replaceAll('\r\n','\n')):bytes);}
/** Source attestation, not a promise that a feature has been exercised. Text uses SHA-256 of LF-normalized UTF-8. */
export async function sourceInventory(root){
 const names=[];async function walk(rel){let entries;try{entries=await readdir(path.join(root,rel),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const entry of entries){if(['node_modules','.local','.next','.git','__pycache__'].includes(entry.name))continue;const name=rel+'/'+entry.name;if(entry.isSymbolicLink())throw Error('SOURCE_LINK_NOT_ALLOWED:'+name);if(entry.isDirectory())await walk(name);else if(entry.isFile())names.push(name);}}
 for(const dir of roots)await walk(dir);for(const name of configs){try{await readFile(path.join(root,name));names.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const files={},rawFiles={};for(const name of names.sort()){const bytes=await readFile(path.join(root,name));files[name]=sourceHash(bytes,name);rawFiles[name]=sha(bytes);}
 return {algorithm:'sha256-lf-text-v1',files,rawFiles,sha256:sha(JSON.stringify(files))};
}
