/** One-time operator runner for the historical migration (owner authorisation 2026-11-02). It adds no logic of its own: it calls the migration
 *  services in order, in explicit phases, and re-checks the safety invariants before and after each one. Run it from the INSTALLED release's ops
 *  folder, so the code that executes is the code that was deployed:
 *    node --import tsx tools/migration/run-production-migration.ts --phase <preflight|units|execute|pdfs|report> --source <dir> --pet <dir> --pdf <dir> \
 *      --mapping-sha256 <hex> --halos "<file>=Run001/2026" --halos "<file>=Run002/2026" --halos "<file>=Run003/2026"
 *  The environment is the web service's (DATABASE_URL = web role, FILE_STORE_ROOT, IDENTITY_LOOKUP_KEY_FILE, APP_ORIGIN, NIPT_MODE=operational,
 *  NIPT_ENVIRONMENT=production and the signed-backup-receipt variables). Output carries counts and codes only: never an LN, HN, name or date of birth.
 *  Never releases or certifies anything, never enables or sends anything to HIS. */
import {readFileSync,readdirSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pool} from '../../packages/db/connection';
import {appendAudit} from '../../packages/db/audit';
import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';
import {prepareMigrationExecution,resumeMigration,verifiedMigrationBackup} from '../../packages/migration/service';
import {enrichMigrationPets} from '../../packages/migration/pet-enrichment';
import {scanHistoricalPetFolder,reconcilePetCandidates} from '../../packages/migration/pet-source';
import {ingestMigrationPdfs} from '../../packages/migration/bulk-pdf';
import {adminCommand} from '../../packages/admin/service';
import type {Staff} from '../../packages/lab/core';

const argv=process.argv.slice(2);
const arg=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];};
const args=(n:string)=>argv.flatMap((a,i)=>a==='--'+n&&argv[i+1]?[argv[i+1]]:[]);
const need=(n:string)=>{const v=arg(n);if(!v)throw Error('ARGUMENT_REQUIRED --'+n);return v;};
const phase=need('phase'),sourceDir=arg('source')??'',petDir=arg('pet')??'',pdfDir=arg('pdf')??'',out=arg('out');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const tally=(xs:string[])=>xs.reduce<Record<string,number>>((a,k)=>({...a,[k]:(a[k]??0)+1}),{});
const db=pool();
const report:Record<string,unknown>={phase,at:new Date().toISOString()};
const scalar=async<T=number>(sql:string,p:unknown[]=[])=>(await db.query<{v:T}>(sql,p)).rows[0]?.v;

async function actor():Promise<Staff>{
 const r=(await db.query<{id:string}>("SELECT u.id FROM app_user u WHERE u.username=$1 AND u.enabled AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='APP_ADMIN' AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))",[arg('actor')??'admin'])).rows[0];
 if(!r)throw Error('APP_ADMIN_ACTOR_NOT_AVAILABLE');
 return {id:r.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
}
/** Fail-closed invariants. Returned as data so they are also recorded. */
async function invariants(){
 const e=process.env,i:Record<string,unknown>={};
 i.environment=e.NIPT_ENVIRONMENT;i.mode=e.NIPT_MODE;
 if(e.NIPT_ENVIRONMENT!=='production'||e.NIPT_MODE!=='operational')throw Error('PRODUCTION_OPERATIONAL_ENVIRONMENT_REQUIRED');
 const marker=await scalar<string>("SELECT shobj_description(oid,'pg_database') v FROM pg_database WHERE datname=current_database()");
 i.databaseMarkerProduction=/NIPT_ENVIRONMENT=production/.test(marker??'');if(!i.databaseMarkerProduction)throw Error('DATABASE_MARKER_NOT_PRODUCTION');
 const b=await verifiedMigrationBackup();const age=b.at?Math.round((Date.now()-Date.parse(b.at))/60000):null;
 i.backupReceipt={verification:b.verification,ageMinutes:age,manifestSha256:b.manifestSha256.slice(0,12)};
 if(age===null||age>24*60)throw Error('VERIFIED_BACKUP_TOO_OLD_OR_UNDATED');
 const setting=async(k:string)=>(await db.query<{value:{enabled?:boolean}}>("SELECT r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=$1",[k])).rows[0]?.value??null;
 const out=await setting('his_outbound'),inb=await setting('his_inbound');
 i.hisOutboundEnabled=out?.enabled===true;i.hisInboundEnabled=inb?.enabled===true;
 if(i.hisOutboundEnabled)throw Error('HIS_OUTBOUND_MUST_STAY_DISABLED');
 i.p6Transfers=Number(await scalar("SELECT count(*)::int v FROM p6_transfer"));i.resultReleases=Number(await scalar("SELECT count(*)::int v FROM result_release"));
 if(i.p6Transfers!==0||i.resultReleases!==0)throw Error('NO_TRANSFERS_OR_RELEASES_EXPECTED');
 return i;
}
const files=()=>{
 const read=(f:string)=>({name:path.basename(f),bytes:readFileSync(f)});
 const mapping=read(path.join(sourceDir,arg('mapping')??'genomic-cbh-ln-mapping.xlsx'));
 const want=need('mapping-sha256').toLowerCase();if(sha(mapping.bytes)!==want)throw Error('MAPPING_SHA256_MISMATCH');
 const halos=args('halos').map(v=>{const at=v.lastIndexOf('=');return {...read(path.join(sourceDir,v.slice(0,at))),runLabel:v.slice(at+1)};});
 if(!halos.length)throw Error('HALOS_RUNS_REQUIRED');
 return {mapping,halos};
};
const store=()=>new FileStore(path.resolve(process.env.FILE_STORE_ROOT!));

try{
 report.invariantsBefore=await invariants();
 if(phase==='preflight'){
  const {mapping,halos}=files();const plan=buildMigrationPlan({mapping,halos});
  report.plan={digest:plan.digest.slice(0,12),counts:plan.counts,exceptions:tally(plan.exceptions.map(x=>x.code+':'+x.severity)),sources:plan.sources.map(s=>({kind:s.kind,run:s.runLabel??null,sha256:s.sha256.slice(0,12)}))};
  const scan=await scanHistoricalPetFolder(petDir),pet=reconcilePetCandidates(scan.candidates);
  report.pet={files:scan.filesSeen,resolved:pet.candidates.length,issues:tally([...scan.issues,...pet.issues].map(x=>x.code)),wards:tally(pet.candidates.map(c=>c.pet.ward||'(none)'))};
  report.units=Number(await scalar("SELECT count(*)::int v FROM unit"));report.existingMigration=Number(await scalar("SELECT count(*)::int v FROM migration_execution"));
 }else if(phase==='units'){
  const a=await actor(),scan=await scanHistoricalPetFolder(petDir),pet=reconcilePetCandidates(scan.candidates),created:string[]=[];
  for(const ward of Object.keys(tally(pet.candidates.map(c=>c.pet.ward||'')))){
   if(!/^[A-Za-z0-9._-]{1,40}$/.test(ward))throw Error('PET_WARD_NEEDS_EXPLICIT_MAPPING');
   if(Number(await scalar("SELECT count(*)::int v FROM unit WHERE code=$1",[ward])))continue;
   // The sending unit is the ward printed on the PET itself; the name is only that code, nothing is invented.
   await adminCommand(db,a,{operation:'saveUnit',code:ward,name:'Ward '+ward+' (HIS PET)',active:true});created.push(ward);
  }
  report.unitsCreated=created;report.unitsTotal=Number(await scalar("SELECT count(*)::int v FROM unit"));
 }else if(phase==='execute'){
  const a=await actor(),{mapping,halos}=files(),input={mapping,halos},plan=buildMigrationPlan(input);
  // the audit vocabulary is fixed (outcome/reasonCode/...): the reason code names the authority and the phase; the actor is the administrator account the owner named
  await appendAudit(db,{actorId:a.id,action:'MIGRATION_OPERATOR_RUN',resourceType:'MIGRATION',details:{outcome:'STARTED',reasonCode:'OPERATOR_SCRIPT_OWNER_AUTH_20261102_EXECUTE'}});
  const prepared=await prepareMigrationExecution(db,a,input,{planDigest:plan.digest,uncheckedAcknowledged:true,petSource:{kind:'FOLDER',path:petDir}},{store:store()});
  report.executionId=prepared.id;
  const done=await resumeMigration(db,a,prepared.id,{store:store()});report.executionState=done.state;
  const key=readFileSync(process.env.IDENTITY_LOOKUP_KEY_FILE!);
  report.pet=await enrichMigrationPets(db,a,prepared.id,store(),key,{});
 }else if(phase==='pdfs'){
  const a=await actor();
  await appendAudit(db,{actorId:a.id,action:'MIGRATION_OPERATOR_RUN',resourceType:'MIGRATION',details:{outcome:'STARTED',reasonCode:'OPERATOR_SCRIPT_OWNER_AUTH_20261102_PDFS'}});
  const names=readdirSync(pdfDir).filter(n=>/\.pdf$/i.test(n)).sort();
  const outcome:string[]=[],reasons:string[]=[];let imported=0;
  for(let i=0;i<names.length;i+=20){
   const batch=names.slice(i,i+20).map(n=>({name:n,bytes:readFileSync(path.join(pdfDir,n))}));
   const client=await db.connect();
   try{await client.query('BEGIN');const r=await ingestMigrationPdfs(client,a,store(),batch);await client.query('COMMIT');
    for(const row of r.rows){outcome.push(row.state);reasons.push(row.state+':'+row.reason);}
    imported+=r.imported;
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  report.pdfFiles=names.length;report.linkedOrImported=imported;report.byState=tally(outcome);report.byStateReason=tally(reasons);
 }else if(phase!=='report')throw Error('UNKNOWN_PHASE');
 // counts after every phase (and the whole content of "report")
 const c=async(sql:string)=>Number(await scalar(sql));
 report.counts={
  migrationExecutions:await c("SELECT count(*)::int v FROM migration_execution"),
  migrationRecords:await c("SELECT count(*)::int v FROM migration_record"),
  recordsByState:Object.fromEntries((await db.query<{k:string;n:string}>("SELECT state||'/'||classification k,count(*)::text n FROM migration_record GROUP BY 1")).rows.map(r=>[r.k,Number(r.n)])),
  analyses:await c("SELECT count(*)::int v FROM migration_analysis"),historicalRuns:await c("SELECT count(*)::int v FROM migration_historical_run"),
  casesBound:await c("SELECT count(*)::int v FROM migration_record WHERE case_id IS NOT NULL"),petBindings:await c("SELECT count(*)::int v FROM migration_pet_binding"),
  nextRunYear2026LastValue:await c("SELECT COALESCE(max(last_value),0)::int v FROM lab_batch_sequence WHERE run_year=2026"),
  resultVersions:await c("SELECT count(*)::int v FROM result_report_version"),
  linkedVersions:await c("SELECT count(*)::int v FROM result_report_version WHERE state IN ('Linked','ValidationBlocked','PendingCertification')"),
  p6Transfers:await c("SELECT count(*)::int v FROM p6_transfer"),resultReleases:await c("SELECT count(*)::int v FROM result_release"),
  labBatchesCreated:await c("SELECT count(*)::int v FROM lab_batch"),
  units:await c("SELECT count(*)::int v FROM unit"),
  allocatorHandover:await c("SELECT count(*)::int v FROM migration_allocator_handover")
 };
 report.invariantsAfter=await invariants();
}catch(e){report.error=e instanceof Error?e.message.split('\n')[0].slice(0,300):String(e);process.exitCode=1;}
finally{
 const text=JSON.stringify(report,null,2);console.log(text);
 if(out){mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,text);}
 await db.end();
}
