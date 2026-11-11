// Retention planner for old release folders and build worktrees (Owner 2026-11-11: drive C was 92% full, mostly old releases and builds).
// PURE: it decides what to keep and what is safe to remove from a list; it never touches the file system. NiptDeploy.psm1 reads the folders, calls
//   node retention.mjs plan <input.json>      and deletes only what the plan lists, only when asked to apply.
// Rules: the newest `keep` items are kept; every protected name (the installed release, the previous one used for rollback, the build of each) is
// kept whatever its age; `keep` can never be below MIN_KEEP so a rollback target and its predecessor always exist.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const MIN_KEEP=3;

/** @param {{items:{name:string;modifiedMs:number;bytes:number}[];keep:number;protect?:string[]}} input */
export function planRetention({items,keep,protect=[]}){
 if(!Number.isInteger(keep)||keep<MIN_KEEP)throw new Error(`RETENTION_KEEP_TOO_SMALL: keep at least ${MIN_KEEP}`);
 if(!Array.isArray(items))throw new Error('RETENTION_ITEMS_REQUIRED');
 const names=new Set();
 for(const i of items){
  if(typeof i?.name!=='string'||!i.name||/[\\/:*?"<>|\r\n\0]/.test(i.name)||i.name==='.'||i.name==='..')throw new Error('RETENTION_NAME_INVALID');
  if(names.has(i.name.toLowerCase()))throw new Error('RETENTION_NAME_DUPLICATE');
  names.add(i.name.toLowerCase());
  if(!Number.isFinite(i.modifiedMs)||!Number.isFinite(i.bytes)||i.bytes<0)throw new Error('RETENTION_ITEM_INVALID');
 }
 const protectedNames=new Set(protect.filter(Boolean).map(n=>n.toLowerCase()));
 // Newest first; equal times fall back to the name so the result never depends on the order the folders were listed in.
 const sorted=[...items].sort((a,b)=>b.modifiedMs-a.modifiedMs||(a.name<b.name?1:a.name>b.name?-1:0));
 const newest=new Set(sorted.slice(0,keep).map(i=>i.name));
 const kept=sorted.filter(i=>newest.has(i.name)||protectedNames.has(i.name.toLowerCase()));
 const remove=sorted.filter(i=>!newest.has(i.name)&&!protectedNames.has(i.name.toLowerCase())).reverse(); // oldest first
 return {
  keep:kept.map(i=>({name:i.name,bytes:i.bytes,reason:protectedNames.has(i.name.toLowerCase())?'PROTECTED':'NEWEST'})),
  remove:remove.map(i=>({name:i.name,bytes:i.bytes,modifiedMs:i.modifiedMs})),
  reclaimBytes:remove.reduce((n,i)=>n+i.bytes,0),
  // A protected name that is not on disk is reported, never an error: the install state may name a release that was already removed by hand.
  protectedMissing:[...protectedNames].filter(n=>!names.has(n)),
 };
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]&&process.argv[2]==='plan'){
 try{process.stdout.write(JSON.stringify({ok:true,plan:planRetention(JSON.parse(readFileSync(process.argv[3],'utf8')))})+'\n');}
 catch(e){process.stdout.write(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)})+'\n');process.exitCode=1;}
}
