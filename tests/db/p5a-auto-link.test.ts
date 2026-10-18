import {it,expect,describe,beforeEach,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resultFixture,receivedCase,importReport,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import * as results from '../../packages/results/service';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting} from '../../packages/settings/service';

// Owner P5-A (2026-10-18) + migration 100: a final result PDF with exactly one clean match is linked by the system, without a second
// person, only while result_management.linkageMode = UNIQUE_AUTO_LINK (Settings maker-checker). Nothing is released or sent to HIS.
let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
async function linkage(mode:'UNIQUE_AUTO_LINK'|'MANUAL_REVIEWED_ONLY'){
 const id=await f.run(t=>proposeSetting(t,f.u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:mode},'Owner P5-A linkage mode'));
 await f.run(t=>validateSetting(t,f.u.certifier,id,async()=>true));await f.run(t=>approveSetting(t,f.u.approver,id));await f.run(t=>activateSetting(t,f.u.approver,id));return id;
}
// The lab number a report carries: the printed sample ID once placed, otherwise the round's LN Halos (both are matching keys).
const printed=async(attemptId:string)=>(await f.db.query<{id:string}>('SELECT coalesce(a.printed_sample_id,n.ln_halos) id FROM analytical_attempt a JOIN specimen_lab_number n ON n.round_id=a.round_id WHERE a.id=$1',[attemptId])).rows[0].id;
const spec=async(c:{hn:string;collection:string;attemptId:string},extra:Record<string,unknown>={})=>({kind:'SINGLETON' as const,labNumber:await printed(c.attemptId),hn:c.hn,collection:pdfDate(c.collection),...extra});
const links=async(versionId:string)=>(await f.db.query<{event:string;mode:string;actor_id:string;match_evidence:Record<string,unknown>|null}>('SELECT event,mode,actor_id,match_evidence FROM result_link_event WHERE version_id=$1 ORDER BY sequence',[versionId])).rows;
const skipped=async()=>(await f.db.query<{reason:string}>("SELECT details->>'reasonCode' reason FROM audit_chain WHERE action='RESULT_AUTO_LINK_SKIPPED' ORDER BY sequence")).rows.map(r=>r.reason);

describe('P5-A system link of a single clean match',()=>{
 it('positive: one clean match links with AUTO_UNIQUE evidence, no second person, no release, no HIS job',async()=>{
  await linkage('UNIQUE_AUTO_LINK');const c=await receivedCase(f);
  const r=await importReport(f,await spec(c));
  const v=await rowVersion(f,r.versionId);
  expect(['PendingCertification','ValidationBlocked']).toContain(v.state);
  expect((await f.db.query('SELECT link_mode,round_id,attempt_id FROM result_report_version WHERE id=$1',[r.versionId])).rows[0]).toEqual({link_mode:'AUTO_UNIQUE',round_id:c.roundId,attempt_id:c.attemptId});
  const l=await links(r.versionId);expect(l.map(x=>x.event)).toEqual(['AUTO_LINKED']);
  expect(l[0]).toMatchObject({mode:'AUTO_UNIQUE',actor_id:f.u.staff.id,match_evidence:{contract:results.AUTO_LINK_CONTRACT,candidates:1,matchedOn:expect.arrayContaining(['HN','LAB_NUMBER'])}});
  expect((l[0].match_evidence!.cross as Record<string,string>).labNumber).toBe('MATCH');
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM job_outbox WHERE kind='result_release_completed'")).rows[0].n).toBe(0);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='RESULT_AUTO_LINKED'")).rows[0].n).toBe(1);
  const gate=(await results.versionDetail(f.db,f.u.certifier,r.versionId)).gate!;
  expect(gate.predicates.find(p=>p.code==='RG-03')).toMatchObject({status:'PASS',reason:'LINKED_AUTO_UNIQUE'});
  expect(gate.eligible).toBe(false); // review/certification still have to be recorded by an authorised person
 });
 it('default and rollback: MANUAL_REVIEWED_ONLY keeps the two-person proposal path; the Setting change is what turns it on and off',async()=>{
  const c=await receivedCase(f);let r=await importReport(f,await spec(c));
  expect(r.outcome).toBe('Unlinked');expect(await links(r.versionId)).toEqual([]);
  const d=await results.versionDetail(f.db,f.u.staff,r.versionId);expect(d.autoMatch).toMatchObject({roundId:c.roundId,linksDirectly:false});
  const on=await linkage('UNIQUE_AUTO_LINK');
  // proposeAuto now links an earlier import directly (same contract); before, it would only have proposed.
  const out=await f.run(async t=>results.proposeAutoMatch(t,f.u.staff,{versionId:r.versionId,expectedRowVersion:(await rowVersion(f,r.versionId)).row_version}));
  expect(out).toMatchObject({autoLinked:true});expect((await links(r.versionId)).map(x=>x.event)).toEqual(['AUTO_LINKED']);
  await linkage('MANUAL_REVIEWED_ONLY');
  const c2=await receivedCase(f);r=await importReport(f,await spec(c2));expect(r.outcome).toBe('Unlinked');expect(await links(r.versionId)).toEqual([]);
  // Rollback to the archived P5-A revision is a new version that must be validated and approved again before it acts.
  const rb=await f.run(t=>rollbackSetting(t,f.u.certifier,on,'Return to Owner P5-A system linkage'));
  await expect(f.run(t=>activateSetting(t,f.u.approver,rb))).rejects.toThrow('SETTING_APPROVAL_REQUIRED');
  const c3=await receivedCase(f);expect((await importReport(f,await spec(c3))).outcome).toBe('Unlinked');
  await f.run(t=>validateSetting(t,f.u.certifier,rb,async()=>true));await f.run(t=>approveSetting(t,f.u.approver,rb));await f.run(t=>activateSetting(t,f.u.approver,rb));
  const c4=await receivedCase(f);expect((await links((await importReport(f,await spec(c4))).versionId)).map(x=>x.event)).toEqual(['AUTO_LINKED']);
 });
 it('negative: ambiguous HN, missing/wrong identifier, mismatching DOB and notices stay Unlinked for manual review',async()=>{
  await linkage('UNIQUE_AUTO_LINK');
  const a=await receivedCase(f,{hn:'990000077001'}),b=await receivedCase(f,{hn:'990000077001'});
  expect((await importReport(f,await spec(a))).outcome).toBe('Unlinked'); // two cases share the HN (handover samples 50/51)
  const c=await receivedCase(f);
  expect((await importReport(f,await spec(c,{labNumber:'26P77000001'}))).outcome).toBe('Unlinked'); // legacy BGI number, not this attempt
  expect((await importReport(f,await spec(c,{dob:'01-Jan-1990'}))).outcome).toBe('Unlinked');
  expect((await importReport(f,{kind:'NOTICE',labNumber:await printed(c.attemptId),hn:c.hn,collection:pdfDate(c.collection)})).outcome).toBe('Unlinked');
  expect(await skipped()).toEqual(['AMBIGUOUS_CASES','NOT_A_CLEAN_MATCH','NOT_A_CLEAN_MATCH']);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_link_event WHERE event='AUTO_LINKED'")).rows[0].n).toBe(0);
  void b;
 });
 it('duplicate and series: same bytes are a Duplicate; a second report for the round (revision) and a name conflict never auto-link',async()=>{
  await linkage('UNIQUE_AUTO_LINK');const c=await receivedCase(f);
  const bytes=syntheticReportPdf(await spec(c)),name=`report-${randomUUID().slice(0,6)}.pdf`;
  const first=await importReport(f,bytes,f.u.staff,name);expect(['PendingCertification','ValidationBlocked']).toContain(first.outcome);
  const again=await importReport(f,bytes,f.u.staff,`other-${name}`);expect(again).toMatchObject({outcome:'Duplicate',versionId:first.versionId});
  const second=await importReport(f,await spec(c,{reported:'21-Oct-2026'}));expect(second.outcome).toBe('Unlinked');
  // same file name, different content (A14): the import needs acknowledgement and the system never links it
  const other=await receivedCase(f),renamed=syntheticReportPdf(await spec(other));
  const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.u.staff.id,jobId:null},renamed));
  await f.run(t=>parseIntake(t,f.store,id,{maxBytes:1e7,acceptZip:true}));
  const ack=await f.run(t=>results.confirmImport(t,f.u.staff,{intakeIds:[id],acknowledgeNameConflicts:[id]}));
  expect(ack[0]).toMatchObject({outcome:'Unlinked',autoLink:'NAME_CONFLICT'});
  expect(await skipped()).toEqual(['SERIES_NOT_EMPTY','NAME_CONFLICT']);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_link_event WHERE event='AUTO_LINKED'")).rows[0].n).toBe(1);
 });
 it('one confirmation with two PDFs for the same round links only the first; a human unlink keeps the version manual for good',async()=>{
  await linkage('UNIQUE_AUTO_LINK');const c=await receivedCase(f);
  const ids:string[]=[];for(const extra of [{},{reported:'22-Oct-2026'}]){const id=await f.run(async t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`p-${randomUUID().slice(0,6)}.pdf`,actorId:f.u.staff.id,jobId:null},syntheticReportPdf(await spec(c,extra))));await f.run(t=>parseIntake(t,f.store,id,{maxBytes:1e7,acceptZip:true}));ids.push(id);}
  const out=await f.run(t=>results.confirmImport(t,f.u.staff,{intakeIds:ids}));
  expect(out.map(o=>o.autoLink)).toEqual(['LINKED','SERIES_NOT_EMPTY']);
  const v=out[0].versionId!;
  // the database refuses the same system link even if the service check were bypassed
  await expect(f.db.query("INSERT INTO result_link_event(version_id,event,mode,case_id,round_id,attempt_id,outcome,reason,match_evidence,actor_id) VALUES($1,'AUTO_LINKED','AUTO_UNIQUE',$2,$3,$4,'Linked','direct database test',$5,$6)",
   [out[1].versionId,c.caseId,c.roundId,c.attemptId,JSON.stringify({contract:'X',candidates:1}),f.u.staff.id])).rejects.toThrow('AUTO_LINK_SERIES_NOT_EMPTY');
  await f.run(async t=>results.unlinkVersion(t,f.u.certifier,{versionId:v,reason:'Wrong patient suspected by reviewer',expectedRowVersion:(await rowVersion(f,v)).row_version}));
  await expect(f.run(async t=>results.proposeAutoMatch(t,f.u.staff,{versionId:v,expectedRowVersion:(await rowVersion(f,v)).row_version}))).rejects.toMatchObject({code:'AUTO_MATCH_NOT_UNAMBIGUOUS',details:{reason:'HUMAN_DECISION_EXISTS'}});
  // the manual two-person path is unchanged
  await f.run(async t=>results.proposeLink(t,f.u.staff,{versionId:v,roundId:c.roundId,attemptId:c.attemptId,reason:'Reviewed identity after unlink',expectedRowVersion:(await rowVersion(f,v)).row_version}));
  await expect(f.run(async t=>results.decideLink(t,f.u.staff,{versionId:v,decision:'APPROVE',reason:'Same person approving',expectedRowVersion:(await rowVersion(f,v)).row_version}))).rejects.toMatchObject({code:'SECOND_PERSON_REQUIRED'});
 });
 it('database guards: AUTO_LINKED needs evidence, an empty series, the current attempt and no human decision; AUTO_UNIQUE needs the event',async()=>{
  const c=await receivedCase(f);const r=await importReport(f,await spec(c));expect(r.outcome).toBe('Unlinked');
  const ins=(extra:Partial<{evidence:unknown;attempt:string;round:string}>={})=>f.db.query("INSERT INTO result_link_event(version_id,event,mode,case_id,round_id,attempt_id,outcome,reason,match_evidence,actor_id) VALUES($1,'AUTO_LINKED','AUTO_UNIQUE',$2,$3,$4,'Linked','direct database test',$5,$6)",
   [r.versionId,c.caseId,extra.round??c.roundId,extra.attempt??c.attemptId,extra.evidence===undefined?JSON.stringify({contract:'X',candidates:1}):extra.evidence,f.u.staff.id]);
  await expect(ins({evidence:null})).rejects.toThrow(/result_link_event/);
  await expect(ins({evidence:JSON.stringify({contract:'X',candidates:2})})).rejects.toThrow(/result_link_event_auto_linked/);
  await expect(f.db.query("INSERT INTO result_link_event(version_id,event,mode,case_id,round_id,attempt_id,reason,actor_id) VALUES($1,'PROPOSED','AUTO_UNIQUE',$2,$3,$4,'mode only for system links',$5)",[r.versionId,c.caseId,c.roundId,c.attemptId,f.u.staff.id])).rejects.toThrow(/result_link_event_mode_check/);
  await expect(f.db.query("UPDATE result_report_version SET link_mode='AUTO_UNIQUE',state='Linked',case_id=$2,round_id=$3,attempt_id=$4,row_version=row_version+1 WHERE id=$1",[r.versionId,c.caseId,c.roundId,c.attemptId])).rejects.toThrow('AUTO_LINK_EVENT_REQUIRED');
  await expect(f.db.query("UPDATE result_report_version SET link_mode='AUTO_PIC',row_version=row_version+1 WHERE id=$1",[r.versionId])).rejects.toThrow(/link_mode_check1/);
  const other=await receivedCase(f);await importReport(f,await spec(other));
  await expect(ins({round:other.roundId,attempt:other.attemptId})).rejects.toThrow(/AUTO_LINK_TARGET_NOT_CURRENT|specimen_round/);
  await f.run(async t=>results.proposeLink(t,f.u.staff,{versionId:r.versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'Manual proposal first',expectedRowVersion:(await rowVersion(f,r.versionId)).row_version}));
  await expect(ins()).rejects.toThrow('LINK_PROPOSAL_OPEN');
 });
});
