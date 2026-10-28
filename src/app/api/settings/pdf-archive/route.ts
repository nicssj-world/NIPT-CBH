import {NextResponse,type NextRequest} from 'next/server';
import {pool,withTransaction} from '../../../../../packages/db/connection';
import {disableArchive,enableArchive,queueArchiveProbe,retryFailedArchive} from '../../../../../packages/results/archive-settings';
import {apiError,protect,readJson} from '../../../../server/http';

const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){
 try{
  const user=await protect(request,'settings.read');
  const [config,probe,counts,errors]=await Promise.all([
   pool().query('SELECT enabled,root_path,updated_at FROM pdf_archive_config WHERE singleton'),
   pool().query('SELECT id,state,error_code,worker_account,retry_job_id,requested_at,completed_at FROM pdf_archive_probe WHERE requested_by=$1 ORDER BY requested_at DESC LIMIT 1',[user.id]),
   pool().query('SELECT state,count(*)::int count FROM pdf_archive_job GROUP BY state'),
   pool().query("SELECT id,state,last_error,attempts,updated_at FROM pdf_archive_job WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 20")
  ]);
  return NextResponse.json({config:config.rows[0],probe:probe.rows[0]??null,counts:counts.rows,errors:errors.rows},{headers});
 }catch(error){return apiError(error);}
}
export async function POST(request:NextRequest){
 try{
  const user=await protect(request,'settings.read'),input=await readJson(request);
  const result=await withTransaction(async db=>{
   if(input.operation==='test'&&typeof input.path==='string')return {probeId:await queueArchiveProbe(db,user,input.path)};
   if(input.operation==='enable'&&typeof input.probeId==='string'){await enableArchive(db,user,input.probeId);return {enabled:true};}
   if(input.operation==='disable'){await disableArchive(db,user);return {enabled:false};}
   if(input.operation==='retry'&&typeof input.jobId==='string')return await retryFailedArchive(db,user,input.jobId);
   throw Error('INVALID_OPERATION');
  });
  return NextResponse.json(result,{headers});
 }catch(error){return apiError(error);}
}
