import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceInventory} from '../source-inventory.mjs';
import {migrationChecksumMatches} from '../migration-checksums.ts';
import {migrationInventory} from '../../deploy/scripts/release-contract.mjs';
const run=(file,args,cwd)=>execFileSync(file,args,{cwd,encoding:'utf8',maxBuffer:24*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']}).trimEnd();
export function compareFiles(primary,snapshot){return [...new Set([...Object.keys(primary),...Object.keys(snapshot)])].sort().flatMap(file=>primary[file]===snapshot[file]?[]:[{file,primary:primary[file]??null,snapshot:snapshot[file]??null,status:'MISSING'}]);}
export async function audit({repo,snapshot,phase='preflight',evidence,output}){
 repo=path.resolve(repo);snapshot=path.resolve(snapshot);const failures=[],blocked=[],git=(args,root=repo)=>run('git',args,root),head=git(['rev-parse','HEAD']),snapshotHead=git(['rev-parse','HEAD'],snapshot);
 const entries=git(['status','--porcelain=v1','-z','--untracked-files=all']).split('\0'),dirty=[];for(let i=0;i<entries.length;i++){const l=entries[i];if(!l)continue;const item={code:l.slice(0,2),file:l.slice(3)};if(/[RC]/.test(item.code))item.previous=entries[++i];dirty.push(item);}
 const config=JSON.parse(await readFile(path.join(repo,'tools/operational/source-parity-features.json'),'utf8'));
 const primary=await sourceInventory(repo),snap=await sourceInventory(snapshot),differences=compareFiles(primary.files,snap.files),migrations=await migrationInventory(path.join(snapshot,'db/migrations'));
 if(head!==snapshotHead)failures.push('HEAD_SNAPSHOT_MISMATCH');if(git(['status','--porcelain','--untracked-files=all'],snapshot))failures.push('SNAPSHOT_DIRTY');
 for(const item of dirty){const exclusion=config.reviewedExclusions.find(e=>e.file===item.file&&e.sha256===primary.files[item.file]&&e.reason);item.status=exclusion?'INTENTIONALLY EXCLUDED':'MISSING';item.reason=exclusion?.reason??'Unreviewed or uncommitted work; classify and include before delivery';if(!exclusion)failures.push('UNCOMMITTED:'+item.file);}
 const excluded=new Set(dirty.filter(x=>x.status==='INTENTIONALLY EXCLUDED').map(x=>x.file));for(const d of differences){if(excluded.has(d.file))d.status='INTENTIONALLY EXCLUDED';else failures.push('SOURCE_FILE_MISMATCH:'+d.file);}
 const featureEvidence=await readFile(evidence??path.join(repo,'.local/owner-local-uat-1.0.2/source-parity-feature-evidence.json'),'utf8').then(JSON.parse).catch(()=>null),runtime=[];
 if(phase!=='preflight'){
  for(const service of ['web','worker','renderer']){try{
   const name='nipt-cbh-owner-local-102-20261020-'+service+'-1',p=JSON.parse(run('docker',['exec',name,'node','-e',"process.stdout.write(JSON.stringify(require('/app/build-provenance.json')))"],repo));
   const sourceDifferences=compareFiles(snap.files,p.source?.files??{});runtime.push({service,revision:p.revision,sourceSha256:p.source?.sha256??null,migrationsSha256:p.migrationsSha256,sourceDifferences,rawSourceDifferences:compareFiles(snap.rawFiles,p.source?.rawFiles??{})});
   if(p.revision!==head||p.source?.sha256!==snap.sha256||sourceDifferences.length||compareFiles(snap.rawFiles,p.source?.rawFiles??{}).length)failures.push('RUNTIME_SOURCE_MISMATCH:'+service);
   if(p.migrationsSha256!==migrations.sha256||JSON.stringify(p.migrations)!==JSON.stringify(migrations.files))failures.push('RUNTIME_MIGRATION_MISMATCH:'+service);
  }catch(e){blocked.push('RUNTIME_UNAVAILABLE:'+service+':'+e.message.split('\n')[0]);}}
  try{const rows=JSON.parse(run('docker',['exec','nipt-cbh-owner-local-102-20261020-db-1','psql','-U','nipt_migrator','-d','nipt_operational_integrated_owner_uat','-Atqc',"SELECT coalesce(json_agg(t),'[]') FROM (SELECT name,checksum FROM schema_migration ORDER BY name)t"],repo));migrations.ledger=rows.map(r=>({...r,bundled:migrations.files[r.name]??null,match:r.checksum===migrations.files[r.name]?'EXACT':migrationChecksumMatches(r.name,migrations.files[r.name],r.checksum)?'EXISTING_APPROVED_HISTORICAL_PAIR':'MISMATCH'}));if(rows.length!==Object.keys(migrations.files).length||migrations.ledger.some(r=>r.match==='MISMATCH'))failures.push('APPLIED_MIGRATION_LEDGER_MISMATCH');migrations.appliedCount=rows.length;}catch{blocked.push('MIGRATION_LEDGER_UNAVAILABLE');}
 }
 if(phase==='delivery'&&featureEvidence?.revision===head&&featureEvidence.status==='FAIL')failures.push('FEATURE_SMOKE_FAILED');
 const features=config.features.map(f=>{const missing=f.sources.filter(s=>!snap.files[s]||snap.files[s]!==primary.files[s]||runtime.some(r=>r.sourceDifferences.some(d=>d.file===s)));const proof=featureEvidence?.features?.find(x=>x.id===f.id);const tested=featureEvidence?.status==='PASS'&&Array.isArray(featureEvidence.errors)&&featureEvidence.errors.length===0&&featureEvidence.revision===head&&proof?.status==='INCLUDED'&&Array.isArray(proof.checks)&&proof.checks.length>0;return {...f,status:missing.length?'MISSING':phase==='delivery'&&!tested?'BLOCKED':phase==='preflight'?'BLOCKED':tested?'INCLUDED':'BLOCKED',reason:missing.length?'Source absent or different':tested?'Source hashes and exact-revision Browser/artifact checks match':'Runtime Browser/artifact verification required',checks:tested?proof.checks:[]};});
 if(phase==='delivery')for(const f of features){if(f.status==='MISSING')failures.push('FEATURE_MISSING:'+f.id);else if(f.status==='BLOCKED')blocked.push('FEATURE_NOT_VERIFIED:'+f.id);}
 const result={status:failures.length?'FAIL':blocked.length?'BLOCKED':'PASS',phase,readyForOwnerTest:phase==='delivery'&&!failures.length&&!blocked.length,head,snapshotHead,committedNotInRuntime:runtime.filter(r=>r.revision!==head).map(r=>({service:r.service,runtime:r.revision,commits:git(['log','--oneline',r.revision+'..'+head])})),sourceAlgorithm:primary.algorithm,primarySourceSha256:primary.sha256,snapshotSourceSha256:snap.sha256,files:primary.files,rawFileDifferences:compareFiles(primary.rawFiles,snap.rawFiles).map(d=>({...d,status:primary.files[d.file]===snap.files[d.file]?'INCLUDED':'MISSING',reason:primary.files[d.file]===snap.files[d.file]?'Encoding/EOL only; normalized content identical; snapshot raw bytes attested':'Content differs'})),differences,uncommitted:dirty,runtime,migrations,features,failures,blocked,ownerUat:'PENDING',generatedAt:new Date().toISOString()};
 if(output){await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));}return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
 try{const r=await audit({repo:get('repo',process.cwd()),snapshot:get('snapshot',process.cwd()),phase:get('phase','preflight'),evidence:get('evidence'),output:get('output')});console.log(JSON.stringify(args.includes('--summary')?{status:r.status,readyForOwnerTest:r.readyForOwnerTest,head:r.head,failures:r.failures,blocked:r.blocked}:r));if(r.status!=='PASS')process.exitCode=1;}catch(e){console.log(JSON.stringify({status:'BLOCKED',readyForOwnerTest:false,error:e.message}));process.exitCode=1;}
}
