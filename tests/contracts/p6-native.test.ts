import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Pool,escapeIdentifier,escapeLiteral,type PoolClient} from 'pg';
import {PgBoss} from 'pg-boss';
import {randomUUID} from 'node:crypto';
import {readFile,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {registerFixture,reserveFixture,loadTransfer,readHistory,cancelFixtureTransfer,recordReconciliation} from '../../packages/p6/journal';
import {readClinicalOutboundCandidate} from '../../packages/p6/release-boundary';
import {runTransfer,runP6Cycle} from '../../packages/p6/worker';
import {openSandbox} from '../../packages/p6/sandbox';
import {sandboxFixture} from '../../tools/p6/fixtures';
import {sandboxCommand} from '../../tools/p6/sandbox-workflow';
import {verifyAuditChain} from '../../packages/db/audit';

const enabled=!!process.env.NIPT_P6_NATIVE_URL;
describe.skipIf(!enabled)('P6 native PostgreSQL 17: isolated sandbox only',()=>{
  let owner:Pool,writer:Pool,worker:Pool,app:Pool;
  const sandboxId='SYNTHETIC-NATIVE-'+randomUUID();
  const session=async<T>(pool:Pool,fn:(db:PoolClient)=>Promise<T>)=>{const db=await pool.connect();try{return await fn(db);}finally{db.release();}};
  const seed=async(index:number,extra:Partial<ReturnType<typeof sandboxFixture>>={})=>session(writer,async db=>{const d={...sandboxFixture(index),...extra};await registerFixture(db,d,sandboxId);return reserveFixture(db,d.fixtureId);});
  beforeAll(async()=>{
    vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');
    const url=new URL(process.env.NIPT_P6_NATIVE_URL!);assertSyntheticDatabase(url.toString());
    if(url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/nipt_p6_synthetic_'))throw Error('ISOLATED_P6_NATIVE_DATABASE_REQUIRED');
    const admin=new Pool({connectionString:url.toString()}),database='nipt_p6_synthetic_'+randomUUID().replaceAll('-','');
    await admin.query('CREATE DATABASE '+escapeIdentifier(database));await admin.end();url.pathname='/'+database;
    owner=new Pool({connectionString:url.toString()});await session(owner,db=>migrate(db));
    await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
    const boss=new PgBoss(url.toString());await boss.start();await boss.stop();
    await owner.query('GRANT USAGE ON SCHEMA pgboss TO worker_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO worker_rw; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO worker_rw');
    const rolePool=async(login:string,role:string)=>{
      const password='SYNTHETIC-P6-NATIVE-LOGIN-ONLY-20261013';
      if(!(await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[login])).rowCount)await owner.query(`CREATE ROLE ${escapeIdentifier(login)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${escapeLiteral(password)}`);
      await owner.query(`GRANT ${escapeIdentifier(role)} TO ${escapeIdentifier(login)}`);
      const copy=new URL(url);copy.username=login;copy.password=password;return new Pool({connectionString:copy.toString(),max:12});
    };
    writer=await rolePool('p6_native_fixture','p6_fixture_writer');worker=await rolePool('p6_native_worker','worker_rw');app=await rolePool('p6_native_app','app_rw');
  },60000);
  afterAll(async()=>{await Promise.all([owner?.end(),writer?.end(),worker?.end(),app?.end()]);vi.unstubAllEnvs();});
  it('atomically reserves one N/ID under 12 real concurrent clients and denies clinical/fixture escalation',async()=>{
    await session(writer,db=>registerFixture(db,sandboxFixture(301),sandboxId));
    const rows=await Promise.all(Array.from({length:12},()=>session(writer,db=>reserveFixture(db,'SYNTHETIC-P6-301'))));
    expect(new Set(rows.map(r=>r.id)).size).toBe(1);expect(rows.every(r=>r.plan.sequence===1)).toBe(true);
    for(const p of [app,worker]){
      await expect(session(p,db=>registerFixture(db,sandboxFixture(999),sandboxId))).rejects.toThrow(/permission denied/);
      await expect(readClinicalOutboundCandidate(p,'00000000-0000-4000-8000-000000000001')).rejects.toThrow('P6_CLINICAL_RELEASE_HOLD_AL5');
      expect((await p.query("SELECT has_table_privilege(current_user,'result_release','INSERT') allowed")).rows[0].allowed).toBe(false);
    }
    expect((await owner.query('SELECT p5_release_authorized() allowed')).rows[0].allowed).toBe(false);expect((await owner.query('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  });
  it('two workers plus concurrent retry calls cannot publish the same transfer twice',async()=>{
    const row=await seed(302);let entered!:()=>void,release!:()=>void;
    const ready=new Promise<void>(r=>{entered=r;}),barrier=new Promise<void>(r=>{release=r;});
    const running=session(worker,db=>runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact==='PDF'&&e.point==='BEFORE_WRITE'){entered();await barrier;}}}));
    await ready;
    const competitors=await Promise.all(Array.from({length:6},()=>session(worker,db=>runTransfer(db,row.id))));expect(competitors.every(x=>x==='BUSY')).toBe(true);release();await running;
    const history=await readHistory(worker,row.id);expect(history.state).toBe('AWAITING_CONFIRMATION');expect(history.events.filter(e=>e.code==='PDF_VERIFIED')).toHaveLength(1);
    expect((await reserveFixtureOnWriter('SYNTHETIC-P6-302')).id).toBe(row.id);
  });
  const reserveFixtureOnWriter=(id:string)=>session(writer,db=>reserveFixture(db,id));
  it('a new worker connection resumes after file publication/checkpoint loss with identical inode/bytes/N',async()=>{
    const row=await seed(303);
    await expect(session(worker,db=>runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='PDF')throw Error('SYNTHETIC_PROCESS_STOP');}}))).rejects.toThrow('SYNTHETIC_PROCESS_STOP');
    const s=await openSandbox(sandboxId,sandboxFixture(303).settings),filename=path.join(s.root,'simulator/p6/cfs',row.plan.pdfName),before=await stat(filename);
    await session(worker,db=>runTransfer(db,row.id));expect((await stat(filename)).ino).toBe(before.ino);expect(await s.read('PDF',row.plan)).toEqual(Buffer.from(row.plan.pdfHex,'hex'));expect((await loadTransfer(worker,row.id)).plan.sequence).toBe(1);
  });
  const failureCases=(['PDF','RES','BACKUP','OK'] as const).flatMap((artifact,a)=>(['BEFORE_WRITE','AFTER_TEMP_SYNC','BEFORE_PUBLISH','AFTER_PUBLISH','AFTER_VERIFY'] as const).map((point,p)=>({artifact,point,index:400+a*10+p})));
  it.each(failureCases)('native $artifact/$point failure is durable and obeys retry/reconcile policy',async({artifact,point,index:i})=>{
    const d=sandboxFixture(i);d.settings.retryDelaysMs=[5,10];const row=await seed(i,d);
    await session(worker,db=>runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact===artifact&&e.point===point)throw Error('SYNTHETIC_FAILURE');}}));
    const current=await loadTransfer(worker,row.id),s=await openSandbox(sandboxId,d.settings);expect(await s.exists('OK',current.plan)).toBe(artifact==='OK'&&['AFTER_PUBLISH','AFTER_VERIFY'].includes(point));
    expect(current.model.state).toBe(artifact==='OK'?'RECONCILIATION_REQUIRED':'RETRY_PENDING');
    if(artifact!=='OK'){await new Promise(r=>setTimeout(r,20));await session(worker,db=>runTransfer(db,row.id));expect((await loadTransfer(worker,row.id)).model.state).toBe('AWAITING_CONFIRMATION');}
  });
  it('OK/checkpoint ambiguity stays held and durable operator investigation never resends',async()=>{
    const row=await seed(308);await expect(session(worker,db=>runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='OK')throw Error('SYNTHETIC_PROCESS_STOP');}}))).rejects.toThrow();
    await session(worker,db=>runTransfer(db,row.id));expect((await loadTransfer(worker,row.id)).model.state).toBe('RECONCILIATION_REQUIRED');
    await session(worker,db=>recordReconciliation(db,row.id,{actorId:'SYNTHETIC-OBSERVER',evidenceId:'SYNTHETIC-INVESTIGATION',resolution:'OBSERVED_SANDBOX_DELIVERY',pdfHash:row.plan.pdfHash,resHash:row.plan.resHash,observedAt:Date.now()}));
    expect((await readHistory(worker,row.id)).reconciliations).toHaveLength(1);expect(await session(worker,db=>runTransfer(db,row.id))).toBe('RECONCILIATION_REQUIRED');
  });
  it('concurrent withdrawal after OK creates reconciliation and preserves files',async()=>{
    const row=await seed(309);await session(worker,db=>runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='OK')await session(worker,other=>cancelFixtureTransfer(other,row.id,'WITHDRAWAL'));}}));
    expect((await loadTransfer(worker,row.id)).model.state).toBe('RECONCILIATION_REQUIRED');const s=await openSandbox(sandboxId,sandboxFixture(309).settings);expect(await s.exists('OK',row.plan)).toBe(true);
  });
  it('concurrent withdrawal immediately before OK blocks sentinel publication on native PG',async()=>{
    const row=await seed(313);await session(worker,db=>runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact==='OK'&&e.point==='BEFORE_PUBLISH')await session(worker,other=>cancelFixtureTransfer(other,row.id,'WITHDRAWAL'));}}));
    const s=await openSandbox(sandboxId,sandboxFixture(313).settings);expect(await s.exists('OK',row.plan)).toBe(false);expect((await loadTransfer(worker,row.id)).model.state).toBe('CANCELLED');
  });
  it('final gate read and OK publication hold the same row lock as cancellation',async()=>{
    const row=await seed(314);let cancellation:Promise<unknown>|undefined,committed=false;
    await session(worker,db=>runTransfer(db,row.id,{afterFinalGateRead:async()=>{
      cancellation=session(worker,other=>cancelFixtureTransfer(other,row.id,'WITHDRAWAL')).then(()=>{committed=true;});
      await new Promise(r=>setTimeout(r,30));expect(committed).toBe(false);
    }}));
    await cancellation;await session(worker,db=>runTransfer(db,row.id));
    const s=await openSandbox(sandboxId,sandboxFixture(314).settings);expect(await s.exists('OK',row.plan)).toBe(true);expect((await loadTransfer(worker,row.id)).model.state).toBe('RECONCILIATION_REQUIRED');
  });
  it.each(['PDF','RES','BACKUP','OK'] as const)('abrupt process exit at %s hardlink window recovers only proven staging twins',async artifact=>{
    const i={PDF:600,RES:601,BACKUP:602,OK:603}[artifact],row=await seed(i);
    const child=promisify(execFile)(process.execPath,['--import','tsx','tools/p6/native-crash-child.ts',row.id,artifact],{env:{...process.env,DATABASE_URL:(worker.options as {connectionString:string}).connectionString},timeout:15000});
    await expect(child).rejects.toMatchObject({code:91});
    let outcome='BUSY';for(let n=0;n<50&&outcome==='BUSY';n++){outcome=await session(worker,db=>runTransfer(db,row.id));if(outcome==='BUSY')await new Promise(r=>setTimeout(r,20));}
    expect(outcome).toBe(artifact==='OK'?'RECONCILIATION_REQUIRED':'AWAITING_CONFIRMATION');
    expect((await loadTransfer(worker,row.id)).plan.sequence).toBe(1);
  },30000);
  it('simulated receiver pickup is unconfirmed, timeout creates work, CLI records synthetic confirmation/history/status',async()=>{
    const row=await seed(310);await session(worker,db=>runTransfer(db,row.id));const s=await openSandbox(sandboxId,sandboxFixture(310).settings);
    // Test receiver only: removes its exact synthetic RES/OK. Application has no deletion operation.
    await unlink(path.join(s.root,'simulator/p6/res',row.plan.resName));await unlink(path.join(s.root,'simulator/p6/res',row.plan.okName));
    await session(worker,db=>runTransfer(db,row.id));expect((await loadTransfer(worker,row.id)).model.state).toBe('PICKED_UP_UNCONFIRMED');
    const result=await sandboxCommand(worker,['confirm',row.id,'OPERATOR','SYNTHETIC-OBSERVER','SYNTHETIC-CONFIRMATION']) as {state:string;hisConfirmed:boolean};expect(result.state).toBe('SYNTHETIC_CONFIRMED');expect(result.hisConfirmed).toBe(false);
    const d=sandboxFixture(311);d.settings.confirmationTimeoutMs=5;const timeout=await seed(311,d);await session(worker,db=>runTransfer(db,timeout.id));await new Promise(r=>setTimeout(r,20));await runP6Cycle(worker);expect((await loadTransfer(worker,timeout.id)).model.state).toBe('UNKNOWN_TIMEOUT');
    const status=await sandboxCommand(app,['status']) as {clinicalPublisherEnabled:boolean};expect(status.clinicalPublisherEnabled).toBe(false);
  });
  it('existing application worker processes the P6 queue only with explicit opt-in; audit and migrations remain valid',async()=>{
    const row=await seed(312);
    const workerUrl=(worker.options as {connectionString:string}).connectionString;vi.stubEnv('DATABASE_URL',workerUrl);
    const {startWorker}=await import('../../packages/jobs/worker');const {pool}=await import('../../packages/db/connection');
    const running=await startWorker();try{
      for(let i=0;i<60;i++){if((await loadTransfer(worker,row.id)).model.state==='AWAITING_CONFIRMATION')break;await new Promise(r=>setTimeout(r,100));}
      expect((await loadTransfer(worker,row.id)).model.state).toBe('AWAITING_CONFIRMATION');expect((await app.query('SELECT * FROM p6_worker_heartbeat')).rowCount).toBe(1);
    }finally{await running.stop();await pool().end();}
    expect(verifyAuditChain((await owner.query('SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows)).toBe(true);
    await session(owner,db=>migrate(db));expect((await owner.query("SELECT count(*)::int n FROM schema_migration WHERE name LIKE '060%'")).rows[0].n).toBe(1);
    expect((await owner.query('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  },60000);
});
