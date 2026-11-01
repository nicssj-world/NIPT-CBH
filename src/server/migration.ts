import {NextResponse,type NextRequest} from 'next/server';
import {after} from 'next/server';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {pool,assertDatabaseMode} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {validateCsrf} from '../../packages/security/session';
import {configuredOrigin,assertRuntime} from '../../packages/security/runtime';
import {readOnlyMigrationSession} from '../../packages/migration/auth';
import {buildMigrationPlan,type MigrationPlanInput} from '../../packages/migration/planner';
import {migrationAdmin,prepareMigrationExecution,requestMigrationResume,readMigrationExecution,resumeMigration,cancelMigration,updateMigrationRecord,verifiedMigrationBackup,type ExecutionOptions} from '../../packages/migration/service';
import {enrichMigrationPets} from '../../packages/migration/pet-enrichment';
import {applyAllocatorHandover} from '../../packages/migration/identifiers';
import {migrationCompatibility} from '../../packages/migration/compatibility';
import {activeHis} from '../../packages/settings/his';
import {SETTINGS} from '../../packages/settings/catalog';
import {simulatorRoot} from '../../packages/integrations/scanner';
import {readPetArchive,scanHistoricalPetFolder,reconcilePetCandidates} from '../../packages/migration/pet-source';
import {LabError,type Staff} from '../../packages/lab/core';
import {z} from 'zod';
import {boundedMultipart} from './bounded-multipart';
const noStore={'Cache-Control':'no-store'};
const store=()=>new FileStore(path.resolve(process.env.FILE_STORE_ROOT??'data/files'));
export async function migrationRequest(request:NextRequest,fn:(user:Staff)=>Promise<unknown>){
 try{assertRuntime();const db=await pool().connect();let user;
  try{await db.query('BEGIN READ ONLY');await assertDatabaseMode(db);user=await readOnlyMigrationSession(db,request.cookies.get('nipt_session')?.value??'');if(!user)throw new LabError('UNAUTHENTICATED',401);migrationAdmin(user);
   if(!['GET','HEAD'].includes(request.method))validateCsrf(request.headers.get('origin'),configuredOrigin().origin,request.headers.get('x-csrf-token')??'',user.csrfHash);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  const result=await fn(user);return result instanceof Response?result:NextResponse.json(result,{headers:noStore});
 }catch(e){const code=e instanceof LabError?e.code:e instanceof z.ZodError?'INVALID_REQUEST':e instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'MIGRATION_REQUEST_FAILED';
  return NextResponse.json({code,error:code},{status:e instanceof LabError?e.status:code==='CSRF_REJECTED'?403:422,headers:noStore});}
}
const metadataSchema=z.object({halosRuns:z.array(z.object({fileName:z.string(),runLabel:z.string()})).max(100).default([]),watermark:z.unknown().optional(),choices:z.array(z.object({sourceKey:z.string().optional(),hisLn:z.string().optional(),classification:z.enum(['NO_HALOS','RERUN','QUALIFIED_PDF_PENDING','PDF_REVIEW','CERTIFIED_RELEASED']).optional(),hisPdfExists:z.boolean().optional(),reason:z.string().max(500).optional()})).max(100000).default([]),uncheckedAcknowledged:z.boolean().default(false),planDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),backupEvidence:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),manifestPath:z.string().optional()}).optional(),petSource:z.object({kind:z.enum(['FOLDER','ZIP']),path:z.string().min(1).max(2000)}).optional(),wardMappings:z.record(z.string(),z.uuid()).optional()});
async function inputs(request:NextRequest){
 const form=await boundedMultipart(request,80*1024*1024),metadata=metadataSchema.parse(JSON.parse(String(form.get('metadata')??'{}'))),mapping=form.get('mapping');if(!(mapping instanceof File)||mapping.size>8*1024*1024)throw new LabError('MAPPING_FILE_REQUIRED',422);
 const files=form.getAll('halos');if(files.length!==metadata.halosRuns.length)throw new LabError('HALOS_LABEL_COUNT_MISMATCH',422);
 const input:MigrationPlanInput={mapping:{name:mapping.name,bytes:Buffer.from(await mapping.arrayBuffer())},halos:[],choices:metadata.choices,watermark:metadata.watermark as MigrationPlanInput['watermark']};
 let total=mapping.size;for(let i=0;i<files.length;i++){const f=files[i];if(!(f instanceof File)||f.size>8*1024*1024)throw new LabError('HALOS_FILE_INVALID',422);const label=metadata.halosRuns[i];if(label.fileName!==f.name)throw new LabError('HALOS_FILE_LABEL_MISMATCH',422);total+=f.size;if(total>64*1024*1024)throw new LabError('UPLOAD_TOO_LARGE',413);input.halos.push({name:f.name,bytes:Buffer.from(await f.arrayBuffer()),runLabel:label.runLabel});}
 return {input,metadata};
}
async function configuredPetSource(explicit?:ExecutionOptions['petSource']){
 if(explicit)return explicit;
 try{const config=SETTINGS.his_inbound.schema.parse((await activeHis(pool(),'his_inbound')).value);return {kind:'FOLDER' as const,path:config.basePath==='simulator/inbound'?path.join(simulatorRoot(),'inbound'):config.basePath};}catch{return undefined;}
}
export const previewMigration=(request:NextRequest)=>migrationRequest(request,async()=>{const {input,metadata}=await inputs(request),p=buildMigrationPlan(input);let pet={matched:0,issues:['PET_SOURCE_NOT_CONFIGURED']};const source=await configuredPetSource(metadata.petSource);
 if(source)try{const scan=source.kind==='ZIP'?readPetArchive(await readFile(source.path),source.path):await scanHistoricalPetFolder(source.path);const resolved=reconcilePetCandidates(scan.candidates);const ln=new Set(p.mappings.map(m=>m.hisLn));pet={matched:resolved.candidates.filter(c=>ln.has(c.pet.ln)).length,issues:[...scan.issues,...resolved.issues].map(i=>i.code)};}catch{pet={matched:0,issues:['PET_SOURCE_UNAVAILABLE']};}
 return {planDigest:p.digest,records:p.mappings.map(m=>({sourceKey:m.sourceKey,ln:m.hisLn,lnHalos:m.halosId,classification:m.classification,hisPdfExists:m.hisPdfExists,issues:m.exceptions})),summary:p.counts,exceptions:p.exceptions,allocatorHandover:p.watermark,pet};});
async function enrich(user:Staff,id:string,wardMappings?:Record<string,string>){if(!process.env.IDENTITY_LOOKUP_KEY_FILE)return;try{await enrichMigrationPets(pool(),user,id,store(),await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE),wardMappings);}catch{await pool().query("UPDATE migration_execution SET last_error='PET_SOURCE_UNAVAILABLE' WHERE id=$1",[id]).catch(()=>{});}}
async function processExecution(user:Staff,id:string){
 try{
  const d=await resumeMigration(pool(),user,id,{store:store()});
  if(d.state==='CANCELLED')return;
  // The reviewed immutable source proof is retained with the execution for resume after a process restart.
  const source=(await pool().query<{watermark:MigrationPlanInput['watermark']}>('SELECT watermark FROM migration_execution WHERE id=$1',[id])).rows[0];
  if(source?.watermark&&d.allocatorHandover.readyForHandover&&!d.allocatorHandover.applied){
   try{await applyAllocatorHandover(pool(),user,id,source.watermark);}catch(e){await pool().query('UPDATE migration_execution SET last_error=$2 WHERE id=$1',[id,e instanceof LabError?e.code:'ALLOCATOR_HANDOVER_PENDING']);}
  }
  await enrich(user,id);
 }catch{await pool().query("UPDATE migration_execution SET last_error='MIGRATION_PROCESSING_INTERRUPTED' WHERE id=$1 AND state<>'CANCELLED'",[id]).catch(()=>{});}
}
export const startMigration=(request:NextRequest)=>migrationRequest(request,async user=>{const {input,metadata}=await inputs(request);if(!metadata.planDigest)throw new LabError('PLAN_DIGEST_REQUIRED',422);const petSource=await configuredPetSource(metadata.petSource);const d=await prepareMigrationExecution(pool(),user,input,{...metadata,petSource} as ExecutionOptions,{store:store()});
 if(d.state!=='CANCELLED')after(()=>processExecution(user,d.id));return NextResponse.json(projectExecution(d),{status:202,headers:noStore});});
function projectExecution(d:Awaited<ReturnType<typeof readMigrationExecution>>){return {...d,records:d.records.map(r=>({...r,lnHalos:r.ln_halos,hisPdfExists:r.his_pdf_exists,rowVersion:r.row_version}))};}
export const getExecution=(request:NextRequest,id:string)=>migrationRequest(request,async user=>{z.uuid().parse(id);const d=await readMigrationExecution(pool(),user,id);after(()=>enrich(user,id));return projectExecution(d);});
export const resumeExecution=(request:NextRequest,id:string)=>migrationRequest(request,async user=>{z.uuid().parse(id);const d=await requestMigrationResume(pool(),user,id);after(()=>processExecution(user,id));return NextResponse.json(projectExecution(d),{status:202,headers:noStore});});
export const cancelExecution=(request:NextRequest,id:string)=>migrationRequest(request,async user=>projectExecution(await cancelMigration(pool(),user,z.uuid().parse(id))));
export const patchRecord=(request:NextRequest,id:string)=>migrationRequest(request,async user=>updateMigrationRecord(pool(),user,z.uuid().parse(id),z.object({expectedRowVersion:z.number().int().min(0),hisPdfExists:z.boolean().optional(),classification:z.string().optional(),reason:z.string().max(500).optional()}).strict().parse(await request.json())));
export const migrationPreflight=(request:NextRequest)=>migrationRequest(request,async()=>{let backupEvidence=null;try{const b=await verifiedMigrationBackup();backupEvidence={sha256:b.manifestSha256,verification:b.verification,at:b.at};}catch{}return {backupEvidence,database:'CONFIGURED_TARGET',sourceHead:process.env.NIPT_BUILD_SHA??null,compatibility:await migrationCompatibility(pool())};});
export const handoverExecution=(request:NextRequest,id:string)=>migrationRequest(request,async user=>{const body=await request.json();return applyAllocatorHandover(pool(),user,z.uuid().parse(id),body.watermark);});
