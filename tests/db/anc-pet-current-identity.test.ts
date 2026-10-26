import {it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle,rows} from '../helpers/inbound';
import {getCase,setModes,refusePaperConsent,withdraw,listP2Cases} from '../../packages/p2/service';
import {dashboard} from '../../packages/anc/service';
import {currentPatient} from '../../packages/anc/current-patient';
it('safe compensation preserves entered identity and workspace version with receipt API guards',async()=>{
 const f=await inboundFixture();try{const id=await register(f,{ln:'990001000001',hn:'9900001001'}),{anc}=await registrar(f.db);
 const w=(await rows<{round_id:string;draft:Record<string,unknown>}>(f.db,'SELECT * FROM p2_workspace WHERE case_id=$1',[id]))[0];
 await f.db.query('UPDATE p2_workspace SET draft=$2,version=version+1 WHERE round_id=$1',[w.round_id,{...w.draft,patient:{...(w.draft.patient as object),syntheticName:'SYNTHETIC ANC old',dob:'1989-05-15'}}]);
 await writePet(f.root,'20261012',{ln:'990001000001',hn:'9900001001',name:'SYNTHETIC PET current',dob:'19900101',receivedAt:'20261012101500'});await cycle(f,{now:new Date('2026-10-12T05:00:00Z')});
 const sourceBefore=await rows(f.db,'SELECT p2_clinical_source($1) source FROM p2_workspace WHERE round_id=$1',[w.round_id]);
 const c=await getCase(f.db,anc,id);expect(c.workspace.draft.patient).toMatchObject({syntheticName:'SYNTHETIC ANC old',dob:'1989-05-15'});expect(c.workspace.version).toBe(1);expect(c.hasEverReceived).toBe(true);
 expect(c.patientName).toBe('SYNTHETIC PET current');expect(c.currentPatient).toMatchObject({name:'SYNTHETIC PET current',dob:'1990-01-01',source:'HIS_PET_RECEIPT',roundId:w.round_id});expect(c.currentPatient.inboundFileId).toBeTruthy();
 const identityEvents=await rows<{details:{before:unknown;after:unknown;source:string;roundId:string;inboundFileId:string;recordedAt:string}}>(f.db,"SELECT details FROM case_event WHERE case_id=$1 AND event_type='PET_CURRENT_IDENTITY_APPLIED'",[id]);
 expect(identityEvents).toHaveLength(1);expect(identityEvents[0].details.before).toMatchObject({name:'SYNTHETIC ANC old',dob:'1989-05-15',source:'ANC'});expect(identityEvents[0].details.after).toEqual(c.currentPatient);expect(identityEvents[0].details).toMatchObject({source:'HIS_PET_RECEIPT',roundId:w.round_id,inboundFileId:c.currentPatient.inboundFileId});expect(Number.isNaN(Date.parse(identityEvents[0].details.recordedAt))).toBe(false);
 expect((await listP2Cases(f.db,anc,{q:'PET current'})).cases.map(x=>x.id)).toContain(id);
 expect((await dashboard(f.db,anc,{q:'PET current'})).queue.items.map(x=>x.id)).toContain(id);
 expect(await rows(f.db,'SELECT p2_clinical_source($1) source FROM p2_workspace WHERE round_id=$1',[w.round_id])).toEqual(sourceBefore);
 expect(await rows(f.db,"SELECT details FROM case_event WHERE case_id=$1 AND event_type='PET_CURRENT_IDENTITY_APPLIED'",[id])).toEqual(identityEvents);
 expect(await rows(f.db,"SELECT 1 FROM case_event WHERE case_id=$1 AND event_type='PET_CURRENT_IDENTITY_RECONCILED'",[id])).toEqual([]);
 await expect(setModes(f.db,anc,id,{expectedVersion:c.workspace.version,requestMode:'Paper',consentMode:'Paper'})).rejects.toThrow('ACTION_UNAVAILABLE_AFTER_FIRST_RECEIPT');
 await expect(refusePaperConsent(f.db,anc,id,{expectedVersion:c.workspace.version,reason:'SYNTHETIC test reason'})).rejects.toThrow('ACTION_UNAVAILABLE_AFTER_FIRST_RECEIPT');
 }finally{await f.close();}
},30000);

it('current PET projection preserves confirmed request and consent snapshots and rejects unrelated intake identity',async()=>{
 const f=await inboundFixture();try{const id=await register(f,{ln:'990001000003',hn:'9900001003'}),{anc}=await registrar(f.db);
 const w=(await rows<{round_id:string;draft:Record<string,unknown>}>(f.db,'SELECT * FROM p2_workspace WHERE case_id=$1',[id]))[0];
 const draft={...w.draft,patient:{...(w.draft.patient as object),syntheticName:'SYNTHETIC historical identity',dob:'1988-02-03'}};
 await f.db.query('UPDATE p2_workspace SET draft=$2,version=version+1 WHERE round_id=$1',[w.round_id,draft]);
 expect(await currentPatient(f.db,id)).toMatchObject({name:'SYNTHETIC historical identity',dob:'1988-02-03',source:'ANC',inboundFileId:null});
 for(const kind of ['REQUEST','CONSENT'])await f.db.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,$3,1,'SYNTHETIC-FM01-v1',$4,$5,'SYNTHETIC original evidence',$6)",[id,w.round_id,kind,{draft,workspaceVersion:1},'b'.repeat(64),anc.id]);
 const originals=await rows(f.db,'SELECT * FROM p2_document_revision WHERE case_id=$1 ORDER BY kind',[id]);
 await writePet(f.root,'20261012',{ln:'990001000003',hn:'9900001003',name:'SYNTHETIC authoritative PET',dob:'19910102',receivedAt:'20261012101500'});await cycle(f,{now:new Date('2026-10-12T05:00:00Z')});
 const after=await getCase(f.db,anc,id);expect(after.currentPatient).toMatchObject({name:'SYNTHETIC authoritative PET',dob:'1991-01-02',source:'HIS_PET_RECEIPT'});
 expect(after.workspace.version).toBe(1);expect(after.workspace.draft).toEqual(draft);
 expect(await rows(f.db,'SELECT * FROM p2_document_revision WHERE case_id=$1 ORDER BY kind',[id])).toEqual(originals);
 const other=await register(f,{ln:'990001000004',hn:'9900001004'});expect(await currentPatient(f.db,other)).toMatchObject({name:null,source:'ANC',inboundFileId:null});
 await expect(getCase(f.db,{...anc,unitIds:[]},id)).rejects.toThrow('FORBIDDEN');
 }finally{await f.close();}
},30000);

it('Owner final ANC lock hides and rejects withdrawal after analysis without changing evidence',async()=>{
 const f=await inboundFixture();try{
  const id=await register(f,{ln:'990001000002',hn:'9900001002'}),{anc}=await registrar(f.db);
  expect((await getCase(f.db,anc,id)).allowedActions).toContain('consent.withdraw.receive');
  await f.db.query('UPDATE specimen_round SET analysis_started=true WHERE case_id=$1',[id]);
  const before=await rows(f.db,'SELECT * FROM result_report_version WHERE case_id=$1',[id]);
  expect((await getCase(f.db,anc,id)).allowedActions).not.toContain('consent.withdraw.receive');
  await expect(withdraw(f.db,anc,id,{reason:'SYNTHETIC prohibited ANC withdrawal after analysis'})).rejects.toMatchObject({code:'WITHDRAWAL_UNAVAILABLE_AFTER_ANALYSIS',status:409});
  expect(await rows(f.db,'SELECT * FROM p2_revocation WHERE case_id=$1',[id])).toEqual([]);
  expect(await rows(f.db,'SELECT * FROM result_report_version WHERE case_id=$1',[id])).toEqual(before);
  expect(await rows(f.db,"SELECT * FROM case_event WHERE case_id=$1 AND event_type='P2_WITHDRAWAL_NOTICE_RECEIVED'",[id])).toHaveLength(0);
 }finally{await f.close();}
},30000);
