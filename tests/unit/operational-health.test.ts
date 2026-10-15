import {it,expect,vi} from 'vitest';
import {summarizeHealth,rolesAreRestricted} from '../../tools/p8/health';
import {startRenderer} from '../../apps/renderer/main';
it('operational readiness uses actual worker/services, allows released results and reports waiting HIS delivery without claiming acceptance',()=>{
 const now=new Date(),signals={now,workerLockHeld:true,heartbeatAt:now,lastSuccessAt:now,workerError:false,inboundEnabled:true,backlog:0,unresolvedReconciliation:0,orphanReceipts:0,releaseRows:1,clinicalAuthority:true,auditValid:true,migrationsMatch:true,rolesRestricted:true,p6Pending:1,p6Unresolved:0,p6WorkerError:false};
 const context={mode:'operational' as const,quarantined:false,probes:{web:true,renderer:true,fileStorage:true,backup:'CHECKSUM_VERIFIED'}};
 expect(summarizeHealth(signals,context)).toMatchObject({syntheticOnly:false,technicalReady:true,p6Pending:1,clinicalAcceptance:false});
 expect(summarizeHealth(signals,{...context,quarantined:true}).technicalReady).toBe(false);
 expect(summarizeHealth(signals,{...context,probes:{...context.probes,renderer:false}}).technicalReady).toBe(false);
 expect(summarizeHealth(signals).technicalReady).toBe(false);
});
it('renderer health requires its existing bearer token and reveals no token or input',async()=>{
 vi.stubEnv('RENDERER_TOKEN_FILE','');vi.stubEnv('RENDERER_TOKEN','a'.repeat(32));vi.stubEnv('RENDERER_PORT','0');const server=await startRenderer();try{const address=server.address() as {port:number},url='http://127.0.0.1:'+address.port+'/health';expect((await fetch(url)).status).toBe(401);const response=await fetch(url,{headers:{authorization:'Bearer '+'a'.repeat(32)}});expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'ok'});}finally{await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs();}
});

it('runtime web INSERT grant is accepted only with verified database release guards; worker and elevated roles remain denied',()=>{const names=['app_rw','worker_rw','nipt_app','nipt_worker'],rows=names.map(name=>({name,elevated:false,releaseInsert:['app_rw','nipt_app'].includes(name),auditMutation:false}));expect(rolesAreRestricted(rows,names)).toBe(false);expect(rolesAreRestricted(rows,names,true)).toBe(true);expect(rolesAreRestricted(rows.map(r=>r.name==='worker_rw'?{...r,releaseInsert:true}:r),names,true)).toBe(false);});
