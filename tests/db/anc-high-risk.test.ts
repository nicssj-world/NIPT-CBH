import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase,addUser} from '../helpers/database';
import {syntheticCase,receiveS1,tx} from '../helpers/lab';
import {dashboard} from '../../packages/anc/service';
import type {Principal} from '../../packages/security/policy';

// Owner 2026-11-11: the ANC list shows a "High Risk" badge beside "มีผลตรวจแล้ว" when the certified result has a High Risk trisomy (T21, T18 or T13).
let db:PGlite,anc:Principal,unit:string;
type Case={caseId:string;roundId:string;ln:string};
const makeCase=(ln:string)=>tx(db,async()=>{const c=await syntheticCase(db,{staff:anc,unit},{ln});await receiveS1(db,c,new Date('2026-10-01T00:00:00Z'));return c as Case;});
const parsed=(t21:string,t18:string,t13:string,xxx='Not Detected')=>({abnormal:[t21,t18,t13].includes('High Risk')||xxx==='Detected',results:{t21:{value:t21},t18:{value:t18},t13:{value:t13},xxx:{value:xxx}}});
/** A released result straight into the tables (the release-authority triggers are skipped for the fixture insert only, as the other ANC dashboard tests do). */
async function release(c:Case,p:unknown,{versionState='CertifiedReleased',releaseState='Active'}={}){
 await db.query('BEGIN');
 try{
  await db.query('SET LOCAL session_replication_role=replica');
  const id=randomUUID();
  await db.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by)
   VALUES($1,$2,$3,'RESULT','SINGLETON','SYNTHETIC-v1','SYNTHETIC-v1',$4,$5,$6,$7,$8,'MANUAL_REVIEWED',$9)`,[id,randomUUID(),id.replaceAll('-','').repeat(2),JSON.stringify(p),versionState,c.caseId,c.roundId,
   (await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[c.roundId])).rows[0].id,anc.id]);
  await db.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW',$4,$5)`,[id,c.caseId,c.roundId,releaseState,anc.id]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}
}
const flag=async(c:Case)=>(await dashboard(db,anc,{q:c.ln})).queue.items.find(i=>i.id===c.caseId);
beforeAll(async()=>{
 db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc.risk');
 unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-RISK-1','ANC risk') RETURNING id")).rows[0].id;anc={...anc,unitIds:[unit]};
});
afterAll(async()=>{await db?.close();});
describe('High Risk badge on the ANC list',()=>{
 it('flags a released result with a High Risk trisomy of any kind, and nothing else',async()=>{
  const [t21,t18,t13,low,sca]=[await makeCase('9922200001'),await makeCase('9922200002'),await makeCase('9922200003'),await makeCase('9922200004'),await makeCase('9922200005')];
  await release(t21,parsed('High Risk','Low Risk','Low Risk'));await release(t18,parsed('Low Risk','High Risk','Low Risk'));await release(t13,parsed('Low Risk','Low Risk','High Risk'));
  await release(low,parsed('Low Risk','Low Risk','Low Risk'));
  await release(sca,parsed('Low Risk','Low Risk','Low Risk','Detected'));
  for(const c of [t21,t18,t13]){const i=await flag(c);expect(i?.hasResult,c.ln).toBe(true);expect(i?.highRisk,c.ln).toBe(true);}
  expect((await flag(low))?.highRisk).toBeUndefined();
  // Owner 2026-11-13: any positive result counts, a sex-chromosome Detected too.
  const i=await flag(sca);expect(i?.hasResult).toBe(true);expect(i?.highRisk).toBe(true);
 });
 it('never flags a result that is not the active certified release',async()=>{
  const superseded=await makeCase('9922200011'),voided=await makeCase('9922200012'),pending=await makeCase('9922200013');
  await release(superseded,parsed('High Risk','Low Risk','Low Risk'),{releaseState:'Superseded'});
  await release(voided,parsed('High Risk','Low Risk','Low Risk'),{releaseState:'Voided'});
  await release(pending,parsed('High Risk','Low Risk','Low Risk'),{versionState:'PendingCertification',releaseState:'Superseded'});
  for(const c of [superseded,voided,pending])expect((await flag(c))?.highRisk,c.ln).toBeUndefined();
 });
 it('a case without any result has no flag',async()=>{
  const none=await makeCase('9922200021');const i=await flag(none);
  expect(i?.hasResult).toBe(false);expect(i?.highRisk).toBeUndefined();
 });
});
describe('High Risk filter on the ANC overview',()=>{
 it('risk=high lists only cases with a positive result, with a correct total',async()=>{
  const [pos,neg,none]=[await makeCase('9922200031'),await makeCase('9922200032'),await makeCase('9922200033')];
  await release(pos,parsed('Low Risk','Low Risk','Low Risk','Detected'));await release(neg,parsed('Low Risk','Low Risk','Low Risk'));
  const all=await dashboard(db,anc,{q:'99222000'}),high=await dashboard(db,anc,{q:'99222000',risk:'high'});
  expect(all.queue.items.map(i=>i.id)).toEqual(expect.arrayContaining([pos.caseId,neg.caseId,none.caseId]));
  expect(high.queue.items.length).toBe(high.queue.total);
  expect(high.queue.items.map(i=>i.id)).toContain(pos.caseId);
  expect(high.queue.items.map(i=>i.id)).not.toContain(neg.caseId);expect(high.queue.items.map(i=>i.id)).not.toContain(none.caseId);
  expect(high.queue.items.every(i=>i.highRisk)).toBe(true);
 });
});
