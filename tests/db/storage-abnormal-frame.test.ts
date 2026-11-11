import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {histFixture} from '../helpers/historical';
import {syntheticCase,receiveS1} from '../helpers/lab';
import {storageSearch,storageCommand} from '../../packages/lab/sample-storage';

// Owner 2026-11-11: in Sample Storage a sample whose current result is abnormal (High Risk, or a sex-chromosome Detected) gets a red frame.
type F=Awaited<ReturnType<typeof histFixture>>;
const stored=(f:F,ln:string,at:string)=>f.run(async db=>{const c=await syntheticCase(db,f.u,{ln});await receiveS1(db,c,new Date(at));return c;});
/** Direct fixture rows in a later state: the "starts Imported" guard is a trigger, so the test bypasses it for the insert only (as the ANC dashboard test does). */
const version=async(f:F,c:{caseId:string;roundId:string},abnormal:boolean,state:string,changed:string)=>{
 await f.db.query('BEGIN');
 try{
  await f.db.query('SET LOCAL session_replication_role=replica');
  const attempt=(await f.db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1 ORDER BY attempt_number DESC LIMIT 1',[c.roundId])).rows[0].id;
  await f.db.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,attempt_id,link_mode,imported_by,state,state_changed_at) VALUES($1,$2,$3,'RESULT','SINGLETON','f','f',$4,$5,$6,$7,'MANUAL_REVIEWED',$8,$9,$10)",
   [randomUUID(),randomUUID(),randomUUID().replaceAll('-','').repeat(2),JSON.stringify({abnormal}),c.caseId,c.roundId,attempt,f.u.staff.id,state,changed]);
  await f.db.query('COMMIT');
 }catch(e){await f.db.query('ROLLBACK');throw e;}
};

it('frames only the samples whose newest result that is not superseded or voided is abnormal',async()=>{
 const f=await histFixture();try{
  const pair=await f.run(db=>storageCommand(db,f.maker,{action:'createBoxPair'}));
  const names=['9911100001','9911100002','9911100003','9911100004','9911100005'];
  const cs=[];for(const [i,ln] of names.entries())cs.push(await stored(f,ln,`2026-10-0${i+1}T03:00:00Z`));
  const [abnormal,normal,corrected,voided,none]=cs;
  await version(f,abnormal,true,'PendingCertification','2026-11-01T01:00:00Z');   // abnormal, not released yet: framed
  await version(f,normal,false,'CertifiedReleased','2026-11-01T01:00:00Z');       // normal: not framed
  await version(f,corrected,true,'Superseded','2026-11-01T01:00:00Z');            // an abnormal report replaced by a normal one: not framed
  await version(f,corrected,false,'CertifiedReleased','2026-11-02T01:00:00Z');
  await version(f,voided,true,'Voided','2026-11-01T01:00:00Z');                   // an abnormal report that was cancelled: not framed
  const plan=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP']}));
  await f.run(db=>storageCommand(db,f.maker,{action:'autoFillConfirm',storageTypes:['BACKUP'],planHash:plan.planHash}));
  const open=await f.run(db=>storageSearch(db,f.maker,{activeBoxId:pair.boxes[0].id}));
  const flag=(c:{roundId:string})=>open.activeBox!.grid.find(g=>g.roundId===c.roundId)?.abnormal;
  expect(flag(abnormal)).toBe(true);
  for(const c of [normal,corrected,voided,none])expect(flag(c)).toBe(false);
  expect(open.activeBox!.grid.filter(g=>g.abnormal)).toHaveLength(1);
  expect(open.activeBox!.grid.filter(g=>!g.occupied).every(g=>g.abnormal===false)).toBe(true);
 }finally{await f.close();}
},90000);
