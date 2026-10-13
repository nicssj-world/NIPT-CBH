import {Client,escapeIdentifier} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../migrate';
import {labUsers,tx} from '../../tests/helpers/lab';
import {FileStore} from '../../packages/storage';
import {syntheticReportPdf} from '../his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {confirmImport} from '../../packages/results/service';
import {queryResults,resultQuerySql,parseResultQuery} from '../../packages/results/query';
import {scanResultFolder} from '../../packages/results/folder';

// A bounded practical workload, not a stress rerun or a claim about hospital expected volume.
if(process.env.NIPT_P7_PERF_NEW_DATABASE!=='yes')throw Error('EXPLICIT_NEW_PERFORMANCE_DATABASE_REQUIRED');
const raw=process.env.NIPT_P7_PERF_ADMIN_URL??'';assertSyntheticDatabase(raw);
const url=new URL(raw);if(url.hostname!=='127.0.0.1'||!/^\/nipt_p7_synthetic(?:_[a-z0-9]+)*$/.test(url.pathname))throw Error('OWNED_P7_NATIVE_CLUSTER_REQUIRED');
const runId=randomUUID().replaceAll('-',''),database='nipt_p7_synthetic_perf_'+runId;
const admin=new Client({connectionString:raw});await admin.connect();
try{await admin.query('CREATE DATABASE '+escapeIdentifier(database));}finally{await admin.end();}
url.pathname='/'+database;const db=new Client({connectionString:url.toString()});await db.connect();
const root=path.resolve('.local/p7-performance',runId),store=new FileStore(path.join(root,'files')),simulator=path.join(root,'simulator');
await mkdir(path.join(simulator,'results'),{recursive:true});await writeFile(path.join(simulator,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
const stats=(times:number[])=>{const sorted=[...times].sort((a,b)=>a-b);return {samples:times.length,minMs:sorted[0],medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
try{
 await migrate(db);const users=await labUsers(db),rows=500;
 for(let i=1;i<=rows;i++){
  const name=`SYNTHETIC-PERF-${i}.pdf`,bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:`26B261013${String(i).padStart(3,'0')}`,hn:`99000${String(i).padStart(5,'0')}`,collection:'10-Oct-2026'});
  await writeFile(path.join(simulator,'results',name),bytes);
  await tx(db,async t=>{const id=await registerIntake(t,store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:users.staff.id,jobId:null},bytes);
   await parseIntake(t,store,id,{maxBytes:10*1024*1024,acceptZip:true});const r=await confirmImport(t,users.staff,{intakeIds:[id]});if(r[0].outcome!=='Unlinked')throw Error('PERFORMANCE_FIXTURE_IMPORT_FAILED');});
 }
 const queryTimes:number[]=[],scanTimes:number[]=[];
 for(let i=0;i<30;i++){const start=performance.now(),r=await queryResults(db,users.staff,{pageSize:100,page:i%3+1});if(r.rows.length!==100||!r.page.hasNext)throw Error('PERFORMANCE_PAGE_INVALID');queryTimes.push(performance.now()-start);}
 for(let i=0;i<5;i++){const start=performance.now(),r=await scanResultFolder(db,simulator,'simulator/results',{recursive:true,maxFiles:1000,maxBytes:10*1024*1024,acceptZip:true});if(r.files.length!==rows||r.truncated||r.files.some(f=>f.status!=='IMPORTED'))throw Error('PERFORMANCE_SCAN_INVALID');scanTimes.push(performance.now()-start);}
 const sql=resultQuerySql(parseResultQuery({pageSize:100}));
 const explain=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql.text,sql.values)).rows;
 const safety=(await db.query('SELECT p5_release_authorized() authority,(SELECT count(*)::int FROM result_release) releases')).rows[0];
 if(safety.authority||safety.releases!==0)throw Error('PERFORMANCE_CLINICAL_HOLD_FAILED');
 const report={format:'NIPT_P7_PRACTICAL_PERFORMANCE_V1',database,server:(await db.query('SHOW server_version')).rows[0].server_version,syntheticRows:rows,sourceFiles:rows,
  resultQuery:stats(queryTimes),folderScan:stats(scanTimes),hospitalExpectedVolumeKnown:false,approvedThresholds:false,atPerf01Accepted:false,clinicalReleases:0};
 await writeFile(path.join(root,'metrics.json'),JSON.stringify(report,null,2));await writeFile(path.join(root,'query-plan.json'),JSON.stringify(explain,null,2));
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{await db.end();}
