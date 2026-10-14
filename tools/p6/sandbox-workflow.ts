import {Pool} from 'pg';
import {pathToFileURL} from 'node:url';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {registerFixture,reserveFixture,loadTransfer,applyEvent,cancelFixtureTransfer,recordReconciliation,readHistory,readMonitoring} from '../../packages/p6/journal';
import {runP6Cycle} from '../../packages/p6/worker';
import {assertSandboxEnabled} from '../../packages/p6/sandbox';
import {bindActiveOutboundSettings} from '../../packages/settings/his';
import {sandboxFixture} from './fixtures';

/** CLI operations, not a web/API surface. Enrollment needs the isolated fixture-writer role;
 * run/cancel/confirm/reconcile need worker privileges; status/history may use read-only grants. */
export async function sandboxCommand(pool:Pool,args:string[]){
  assertSandboxEnabled();if(args[0]==='run')return runP6Cycle(pool);const db=await pool.connect();
  try{
    const [command,id,option,actor]=args;
    if(command==='enroll'||command==='enroll-active'){
      const fixture=sandboxFixture(Number(id)),d=command==='enroll-active'?await bindActiveOutboundSettings(db,fixture):fixture;await registerFixture(db,d,option);const row=await reserveFixture(db,d.fixtureId);return {id:row.id,state:row.model.state,syntheticOnly:true};
    }
    if(command==='status')return readMonitoring(db);
    if(command==='history')return readHistory(db,id);
    if(command==='cancel'){
      if(!['VOID','WITHDRAWAL','SUPERSEDED','CONFIG_CHANGED'].includes(option))throw Error('INVALID_CANCEL_REASON');
      await cancelFixtureTransfer(db,id,option as 'VOID');return readHistory(db,id);
    }
    if(command==='confirm'){
      if(!['ACK','OPERATOR','QUERY'].includes(option))throw Error('INVALID_EVIDENCE_KIND');
      const row=await loadTransfer(db,id),now=Date.now();
      await applyEvent(db,id,{type:'CONFIRM',evidence:{kind:option as 'ACK',transferId:row.plan.fixtureId,pdfHash:row.plan.pdfHash,resHash:row.plan.resHash,evidenceId:args[4],actorId:actor,observedAt:now,syntheticOnly:true}},row.revision,now);return readHistory(db,id);
    }
    if(command==='reconcile'){
      if(!['OBSERVED_SANDBOX_DELIVERY','NO_DELIVERY','KEEP_HOLD'].includes(option))throw Error('INVALID_RESOLUTION');
      const row=await loadTransfer(db,id);await recordReconciliation(db,id,{resolution:option as 'KEEP_HOLD',actorId:actor,evidenceId:args[4],pdfHash:row.plan.pdfHash,resHash:row.plan.resHash,observedAt:Date.now()});return readHistory(db,id);
    }
    throw Error('P6_SANDBOX_COMMAND_REQUIRED');
  }finally{db.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const url=process.env.DATABASE_URL??'';assertSyntheticDatabase(url);const pool=new Pool({connectionString:url});
  try{process.stdout.write(JSON.stringify(await sandboxCommand(pool,process.argv.slice(2)))+'\n');}
  catch(e){process.stderr.write(e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message+'\n':'P6_SANDBOX_COMMAND_FAILED\n');process.exitCode=1;}
  finally{await pool.end();}
}
