import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {inboundFixture,writePet,register,cycle,caseState,rows,type InboundFixture} from '../helpers/inbound';
import {addUser} from '../helpers/database';
import {registerCase} from '../../packages/db/registration';
import {lnHnKey} from '../../packages/inbound/identity';
import {linkIntakeAtRegistration} from '../../packages/inbound/registration-link';

const NOW=new Date('2026-10-12T05:00:00Z'),DAY='20261012',HN='9900001001';
let f:InboundFixture;
beforeEach(async()=>{f=await inboundFixture();await f.db.exec(await readFile('packages/db/roles.sql','utf8'));await f.db.exec(await readFile('packages/db/roles-p3.sql','utf8'));await f.db.exec('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');});
afterEach(async()=>{await f.db.query('RESET ROLE');await f.close();});

describe('P3 least-privilege DB roles (worker_rw / app_rw) and LD-04 guard',()=>{
 it('a full inbound cycle runs as worker_rw with only P1 + roles-p3 grants',async()=>{
  const caseId=await register(f.db,f.lookupKey,{ln:'990001000101',hn:HN});
  await writePet(f.root,DAY,{ln:'990001000101',hn:HN,receivedAt:'20261012090000'});await writePet(f.root,DAY,{ln:'990001000102',hn:HN,receivedAt:'20261012090000'});
  await f.db.query('SET ROLE worker_rw');
  const r=await cycle(f,{now:NOW});expect(r.counts).toMatchObject({stored:2,outcome_APPLIED_S1:1,outcome_UNLINKED:1});
  await f.db.query('RESET ROLE');expect((await caseState(f.db,caseId)).rounds[0].state).toBe('ReceivedInHIS');
 });

 it('worker_rw can never insert or update specimen rounds >= 2 (AT-HISIN-11 DB role)',async()=>{
  const caseId=await register(f.db,f.lookupKey,{ln:'990001000111',hn:HN});
  await writePet(f.root,DAY,{ln:'990001000111',hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  const s1=(await rows<{id:string;case_ln_id:string}>(f.db,'SELECT id,case_ln_id FROM specimen_round WHERE case_id=$1',[caseId]))[0];
  await f.db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[s1.id]);
  const redraw=(await rows<{id:string}>(f.db,"INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,'SYNTHETIC') RETURNING id",[caseId,s1.id]))[0].id;
  await f.db.query('SET ROLE worker_rw');
  await expect(f.db.query('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3)',[caseId,s1.case_ln_id,redraw])).rejects.toThrow(/WORKER_ROUND2_PROHIBITED|permission/);
  await f.db.query('RESET ROLE');
  const s2=(await rows<{id:string}>(f.db,'INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[caseId,s1.case_ln_id,redraw]))[0].id;
  const staff=await addUser(f.db,'LAB_STAFF','synthetic.p3.role');
  await f.db.query('SET ROLE worker_rw');
  await expect(f.db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,receipt_check='{\"identity\":true,\"label\":true}' WHERE id=$1",[s2,staff.id])).rejects.toThrow('WORKER_ROUND2_PROHIBITED');
  await expect(f.db.query("UPDATE specimen_round SET analysis_started=analysis_started WHERE id=$1",[s2])).rejects.toThrow('WORKER_ROUND2_PROHIBITED');
  await f.db.query('RESET ROLE');
  // The web role (P4 NIPT receipt path) is not affected by the worker guard.
  await f.db.query('SET ROLE app_rw');
  await f.db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,receipt_check='{\"identity\":true,\"label\":true}' WHERE id=$1",[s2,staff.id]);
 });

 it('registration + intake link (D-49) runs as app_rw inside one transaction',async()=>{
  const ln='990001000121';
  await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  await f.db.query('SET ROLE app_rw');await f.db.query('BEGIN');
  const r=await registerCase(f.db,{ln,identityKey:lnHnKey(ln,HN,f.lookupKey),origin:'LAB_DIRECT',idempotencyKey:'p3_role_'+randomUUID().replaceAll('-','')});
  expect(await linkIntakeAtRegistration(f.db,{caseId:r.caseId,ln,hn:HN,identifierSource:'TUBE_LABEL'},f.deps)).toEqual({outcome:'APPLIED_S1'});
  await f.db.query('COMMIT');await f.db.query('RESET ROLE');
  expect((await caseState(f.db,r.caseId!)).rounds[0].state).toBe('ReceivedInHIS');
 });

 it('issue history is append-only and closed issues cannot be reopened or re-pointed',async()=>{
  const caseId=await register(f.db,f.lookupKey,{ln:'990001000131',hn:'9900009999'});
  await writePet(f.root,DAY,{ln:'990001000131',hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  const issue=(await rows<{id:string}>(f.db,'SELECT id FROM his_intake_issue'))[0].id;
  await expect(f.db.query('DELETE FROM his_intake_issue_event')).rejects.toThrow('append-only');
  await expect(f.db.query('DELETE FROM his_intake_issue')).rejects.toThrow('append-only');
  await expect(f.db.query('DELETE FROM his_inbound_scan_run')).rejects.toThrow('append-only');
  await expect(f.db.query("UPDATE his_intake_issue SET kind='UNLINKED' WHERE id=$1",[issue])).rejects.toThrow('immutable intake issue lineage');
  await expect(f.db.query('UPDATE his_intake_issue SET case_id=NULL WHERE id=$1',[issue])).rejects.toThrow('immutable intake issue lineage');
  await f.db.query("UPDATE his_intake_issue SET state='Resolved',closed_at=now() WHERE id=$1",[issue]);
  await expect(f.db.query("UPDATE his_intake_issue SET state='Open',closed_at=NULL WHERE id=$1",[issue])).rejects.toThrow('closed intake issue');
  expect(caseId).toBeTruthy();
 });
});
