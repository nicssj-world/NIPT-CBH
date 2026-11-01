import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import type {Queryable} from '../../packages/db/connection';
import {parseMapping} from '../../packages/migration/mapping';
import {pinAllocatorEvidence,registryPairsDigest} from '../../packages/migration/high-watermark';
import {canonical,hash,type SourceInput} from '../../packages/migration/model';
/** Does not freeze or alter source. sourceFrozen records the operator's administrative freeze assertion. */
export async function collectGenomicWatermark(db:Queryable,mapping:SourceInput,options:{sourceIdentity:string;sourceFrozen:boolean}){
 if(!options.sourceIdentity.trim()||options.sourceIdentity.length>200||/[:@\r\n]/.test(options.sourceIdentity))throw Error('GENOMIC_SOURCE_IDENTITY_INVALID');
 const parsed=parseMapping(mapping);
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
 const session=(await db.query<{read_only:string;captured_at:string|Date;snapshot:string}>("SELECT current_setting('transaction_read_only') AS read_only, current_timestamp AS captured_at, pg_current_snapshot()::text AS snapshot")).rows[0];
 if(session?.read_only!=='on')throw Error('GENOMIC_TRANSACTION_NOT_READ_ONLY');
 const sourcePairs=(await db.query<{ln:string;ln_halos:string}>('SELECT ln, ln_halos FROM public.nipt_samples ORDER BY ln, ln_halos')).rows;
 const months=(await db.query<{sequence_month:string;last_value:number}>('SELECT sequence_month::text AS sequence_month, last_value FROM public.nipt_monthly_sequences ORDER BY sequence_month')).rows.map(m=>({month:m.sequence_month,lastValue:Number(m.last_value)}));
 if(sourcePairs.some(r=>typeof r.ln!=='string'||typeof r.ln_halos!=='string'||!r.ln||!r.ln_halos)||new Set(sourcePairs.map(r=>r.ln)).size!==sourcePairs.length)throw Error('GENOMIC_REGISTRY_IDENTITY_INVALID');
 const registry=sourcePairs.map(r=>({hisLn:r.ln,halosId:r.ln_halos})),sourceMap=new Map(registry.map(r=>[r.hisLn,r.halosId])),localMap=new Map(parsed.mappings.map(r=>[r.hisLn,r.halosId]));
 const delta={added:registry.filter(r=>!localMap.has(r.hisLn)).length,removed:parsed.mappings.filter(r=>!sourceMap.has(r.hisLn)).length,changed:registry.filter(r=>localMap.has(r.hisLn)&&localMap.get(r.hisLn)!==r.halosId).length};
 const capturedAt=new Date(session.captured_at).toISOString();
 const evidence=pinAllocatorEvidence({version:1,source:'GENOMIC_READ_ONLY_ALLOCATOR',sourceIdentity:options.sourceIdentity,capturedAt,mappingSha256:parsed.source.sha256,registryPairsSha256:registryPairsDigest(registry),registryPairCount:registry.length,months,sourceFrozen:options.sourceFrozen,freezeAssertion:'ADMINISTRATIVE_ASSERTION_ONLY',snapshotSha256:hash(session.snapshot)});
 await db.query('COMMIT');return {evidence,delta};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
async function main(){
 const args=parseArgs({options:{mapping:{type:'string'},out:{type:'string'},'source-identity':{type:'string'},'source-frozen':{type:'boolean',default:false}},strict:true}).values;
 if(!args.mapping||!args.out||!args['source-identity'])throw Error('COLLECTOR_ARGUMENTS_REQUIRED');
 const connectionString=process.env.GENOMIC_READ_ONLY_DATABASE_URL;if(!connectionString)throw Error('GENOMIC_READ_ONLY_DATABASE_URL_REQUIRED');
 const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('GENOMIC_CONNECTION_PROTOCOL_INVALID');
 const db=new Client({connectionString,application_name:'nipt-migration-readonly-watermark',statement_timeout:60000,connectionTimeoutMillis:15000});
 try{await db.connect();const result=await collectGenomicWatermark(db,{name:args.mapping.split(/[\\/]/).at(-1)!,bytes:await readFile(args.mapping)},{sourceIdentity:args['source-identity'],sourceFrozen:args['source-frozen']??false});await writeFile(args.out,canonical(result.evidence)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({manifestSha256:result.evidence.sha256,registryPairCount:result.evidence.registryPairCount,delta:result.delta,sourceFrozenAssertion:result.evidence.sourceFrozen})+'\n');}finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('GENOMIC_READ_ONLY_COLLECTION_FAILED; verify configuration and source access locally.\n');process.exitCode=1;});
