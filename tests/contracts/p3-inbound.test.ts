import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {utimes,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import iconv from 'iconv-lite';
import {inboundFixture,writePet,writeOk,register,registerP2Case,registerWithoutHook,registrar,cycle,caseState,openIssues,fileStates,rows,type InboundFixture} from '../helpers/inbound';
import {addUser} from '../helpers/database';
import {lnHnKey,type RegistrantIdentitySource} from '../../packages/inbound/identity';
import {discoverInbound} from '../../packages/inbound/discovery';
import {processPending} from '../../packages/inbound/process';
import {intakePresence,linkIntakeAtRegistration} from '../../packages/inbound/registration-link';
import {proposeResolution,decideResolution} from '../../packages/inbound/resolution';
import {inboundQueue} from '../../packages/inbound/queue';
import {inboundHealth} from '../../packages/inbound/health';
import {testInboundConnection} from '../../packages/inbound/connection-test';
import {FileStore} from '../../packages/storage';

const NOW=new Date('2026-10-12T05:00:00Z'),DAY='20261012',later=(minutes:number)=>new Date(NOW.getTime()+minutes*60_000);
const LN='990001000001',HN='9900001001';
let f:InboundFixture;
beforeEach(async()=>{f=await inboundFixture();});
afterEach(async()=>{await f.close();});

async function redrawToRound2(caseId:string,received:boolean){
 const s1=(await rows<{id:string;case_ln_id:string}>(f.db,'SELECT id,case_ln_id FROM specimen_round WHERE case_id=$1 AND round_number=1',[caseId]))[0];
 await f.db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[s1.id]);
 const redraw=(await rows<{id:string}>(f.db,"INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,'SYNTHETIC_REDRAW') RETURNING id",[caseId,s1.id]))[0].id;
 const s2=(await rows<{id:string}>(f.db,'INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[caseId,s1.case_ln_id,redraw]))[0].id;
 await f.db.query('UPDATE nipt_case SET current_round_id=$1 WHERE id=$2',[s2,caseId]);
 if(received){const staff=await addUser(f.db,'LAB_STAFF','synthetic.receiver');await f.db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=$2,received_by=$3,receipt_check='{\"identity\":true,\"label\":true}' WHERE id=$1",[s2,later(600),staff.id]);}
 return s2;
}
const round2=async(caseId:string)=>JSON.stringify(await rows(f.db,'SELECT * FROM specimen_round WHERE case_id=$1 AND round_number>=2 ORDER BY round_number',[caseId]));

describe('P3 HIS inbound — synthetic simulator acceptance (AT-HISIN, AT-LIN, AT-LDR, AT-ID-REG)',()=>{
 it('AT-HISIN-01 100 synthetic pairs map P[2]/P[3]/P[7]/P[21]/P[23]^0/O[14]/P[33] exactly, leading zeros kept, ID stored as HMAC only',async()=>{
  const manifest=Array.from({length:100},(_,i)=>({ln:(i%10===0?'00':'')+`99000${String(2000+i).padStart(7,'0')}`,hn:`99000${String(i).padStart(5,'0')}`,dob:`19${80+(i%20)}0${1+(i%9)}1${i%10}`,receivedAt:`202610120${i%10}${String(i%60).padStart(2,'0')}00`,specimenAt:'20261012070000',orderAt:'20261011160000',ward:`SYNTHETIC-W${i%7}`,identity:`SYNTHETIC-ID-${String(i).padStart(4,'0')}`}));
  for(const m of manifest)await writePet(f.root,DAY,m);
  const r=await cycle(f,{now:NOW});expect(r.counts).toMatchObject({stored:100,parseError:0,notNipt:0});
  const parsed=await rows<{parsed:Record<string,string>}>(f.db,'SELECT parsed FROM his_inbound_file ORDER BY ln');
  const byLn=new Map(parsed.map(p=>[p.parsed.ln,p.parsed]));
  for(const m of manifest){const p=byLn.get(m.ln)!;expect(p).toBeDefined();expect(p.hn).toBe(m.hn);expect(p.dob.slice(0,10)).toBe(`${m.dob.slice(0,4)}-${m.dob.slice(4,6)}-${m.dob.slice(6,8)}`);expect(p.receivedAt).toBe(`${m.receivedAt.slice(0,4)}-${m.receivedAt.slice(4,6)}-${m.receivedAt.slice(6,8)}T${m.receivedAt.slice(8,10)}:${m.receivedAt.slice(10,12)}:${m.receivedAt.slice(12,14)}+07:00`);expect(p.specimenAt).toBe('2026-10-12T07:00:00+07:00');expect(p.orderAt).toBe('2026-10-11T16:00:00+07:00');expect(p.ward).toBe(m.ward);expect(p.identityLastFour).toBe(m.identity.slice(-4));expect(p).not.toHaveProperty('identity');expect(JSON.stringify(p)).not.toContain(m.identity);}
  expect([...byLn.keys()].filter(k=>k.startsWith('00'))).toHaveLength(10);
 });

 it('AT-HISIN-03 a .pet without .ok is never read; when .ok arrives later the S1 receipt applies at P[21]',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const pet=await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012101500'},{ok:false});
  const first=await cycle(f,{now:NOW});
  expect(first.counts).toMatchObject({waitingOk:1,stored:0});expect(await rows(f.db,'SELECT 1 FROM his_inbound_file')).toHaveLength(0);
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('Expected');
  await writeOk(f.root,DAY,pet.filename);
  const second=await cycle(f,{now:later(1)});expect(second.counts).toMatchObject({okArrived:1,stored:1,outcome_APPLIED_S1:1});
  const s=await caseState(f.db,caseId);
  expect(s.rounds[0]).toMatchObject({state:'ReceivedInHIS',received_source:'HIS_PET_RECEIPT'});expect(new Date(s.rounds[0].received_at!).toISOString()).toBe('2026-10-12T03:15:00.000Z');
  const request=(await rows<{draft:{patient:{syntheticName:string;dob:string}}}>(f.db,'SELECT w.draft FROM p2_workspace w JOIN specimen_round r ON r.id=w.round_id WHERE w.case_id=$1 AND r.round_number=1',[caseId]))[0].draft;
  expect(request.patient).toMatchObject({syntheticName:'SYNTHETIC^^นาง จำลอง',dob:'2000-01-01'});
  expect(s.orders).toHaveLength(1);expect(s.ln.verification).toBe('VERIFIED_BY_PET');expect(await openIssues(f.db)).toEqual([]);
 });

 it('PET identity never overwrites ANC name or date of birth already entered',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const workspace=(await rows<{round_id:string;draft:Record<string,unknown>}>(f.db,'SELECT w.round_id,w.draft FROM p2_workspace w JOIN specimen_round r ON r.id=w.round_id WHERE w.case_id=$1 AND r.round_number=1',[caseId]))[0];
  const draft={...workspace.draft,patient:{...(workspace.draft.patient as Record<string,unknown>),syntheticName:'ANC entered name',dob:'1999-01-01'}};
  await f.db.query('UPDATE p2_workspace SET draft=$2,version=version+1 WHERE round_id=$1',[workspace.round_id,draft]);
  await writePet(f.root,DAY,{ln:LN,hn:HN,name:'SYNTHETIC PET name',dob:'20000101',receivedAt:'20261012101500'});
  await cycle(f,{now:NOW});
  const saved=(await rows<{draft:{patient:{syntheticName:string;dob:string}}}>(f.db,'SELECT draft FROM p2_workspace WHERE round_id=$1',[workspace.round_id]))[0].draft;
  expect(saved.patient).toMatchObject({syntheticName:'ANC entered name',dob:'1999-01-01'});
  const event=(await rows<{details:{fields:string[]}}>(f.db,"SELECT details FROM case_event WHERE case_id=$1 AND event_type='PET_IDENTITY_CONFLICT'",[caseId]))[0];
  expect(event.details.fields.sort()).toEqual(['dob','name']);
 });

 it('AT-HISIN-04 idempotent replay, path versions, semantic duplicates, identity change → Conflict, other change → S1IntegrityEvent without state change',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const base={ln:LN,hn:HN,receivedAt:'20261012101500',specimenAt:'20261012070000',orderAt:'20261011160000'};
  const original=await writePet(f.root,DAY,base);await cycle(f,{now:NOW});
  const applied=await caseState(f.db,caseId);
  const replay=await cycle(f,{now:later(1)});expect(replay.counts).toMatchObject({unchanged:1,stored:0});
  await utimes(original.path,later(2),later(2));
  const touched=await cycle(f,{now:later(3)});expect(touched.counts).toMatchObject({sameContent:1,stored:0});
  expect(await rows(f.db,'SELECT 1 FROM his_inbound_file')).toHaveLength(1);expect(await rows(f.db,'SELECT 1 FROM his_inbound_source')).toHaveLength(1);
  await writePet(f.root,DAY,{...base,headerAt:'20261012111111'},{mtime:later(4)});
  const semantic=await cycle(f,{now:later(5)});expect(semantic.counts).toMatchObject({stored:1,newPathVersion:1,outcome_DUPLICATE:1});
  await writePet(f.root,DAY,{...base,specimenAt:'20261012080000'},{mtime:later(6)});
  const integrity=await cycle(f,{now:later(7)});expect(integrity.counts.outcome_S1_INTEGRITY_EVENT).toBe(1);
  await writePet(f.root,DAY,{...base,receivedAt:'20261012180000'},{mtime:later(8)});await cycle(f,{now:later(9)});
  await writePet(f.root,DAY,{...base,name:'SYNTHETIC^^นาง เปลี่ยนชื่อ'},{mtime:later(10)});
  const conflict=await cycle(f,{now:later(11)});expect(conflict.counts.outcome_LN_REUSED_OR_CHANGED).toBe(1);
  expect((await fileStates(f.db,LN)).map(x=>x.state)).toEqual(['Applied(S1)','DuplicateSameContent','S1IntegrityEvent','S1IntegrityEvent','Conflict']);
  expect(await rows(f.db,'SELECT path_version FROM his_inbound_file ORDER BY path_version')).toEqual([1,2,3,4,5].map(path_version=>({path_version})));
  expect(await caseState(f.db,caseId)).toEqual(applied);
  const issues=await openIssues(f.db,LN);
  expect(issues.map(i=>[i.kind,i.details.fields])).toEqual([['LN_REUSED_OR_CHANGED',['name']],['S1_INTEGRITY_EVENT',['specimenAt']],['S1_INTEGRITY_EVENT',['receivedAt']]]);
  expect(JSON.stringify(issues)).not.toContain('เปลี่ยนชื่อ');
  expect((await rows<{event_type:string}>(f.db,'SELECT event_type FROM case_event WHERE case_id=$1 ORDER BY created_at',[caseId])).map(e=>e.event_type)).toEqual(['PET_IDENTITY_UPDATED','HIS_S1_RECEIVED','S1_INTEGRITY_EVENT','S1_INTEGRITY_EVENT','HIS_LN_CONFLICT']);
 });

 it('AT-HISIN-05 Unlinked links when the registrant identifiers match (registration hook and worker rematch); mismatch → IDENTITY_MISMATCH',async()=>{
  const lns=['990001000011','990001000012','990001000013'];
  for(const ln of lns)await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012090000'});
  expect((await cycle(f,{now:NOW})).counts.outcome_UNLINKED).toBe(3);
  // (a) P2 registration runs the hook in the same transaction
  const a=await registerP2Case(f,{ln:lns[0],hn:HN,identifierSource:'REQUEST_FORM'});
  expect(a).toMatchObject({outcome:'CREATED',intake:{outcome:'APPLIED_S1',fields:[]}});
  // (b) a P2 case registered before the hook existed (pre-integration data): the worker rematch applies on the next cycle
  const b=await registerWithoutHook(f,{ln:lns[1],hn:HN});
  // (c) same, but the registrant HN differs
  const c=await registerWithoutHook(f,{ln:lns[2],hn:'9900009999'});
  const rematch=await cycle(f,{now:later(1)});expect(rematch.counts).toMatchObject({outcome_APPLIED_S1:1,outcome_IDENTITY_MISMATCH:1});
  expect((await caseState(f.db,a.caseId!)).rounds[0].state).toBe('ReceivedInHIS');
  expect((await caseState(f.db,b)).rounds[0].state).toBe('ReceivedInHIS');
  expect((await caseState(f.db,c)).rounds[0].state).toBe('Expected');
  expect(await openIssues(f.db)).toEqual([{kind:'IDENTITY_MISMATCH',state:'Open',case_id:c,details:{fields:['hn']}}]);
  expect(await fileStates(f.db,lns[2])).toEqual([{state:'Unlinked',error_code:null}]);
 });

 it('AT-HISIN-06 identity mismatch never advances status; queue + two-person link (proposer cannot approve)',async()=>{
  const caseId=await register(f,{ln:LN,hn:'9900009999'});
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('Expected');
  const issue=(await rows<{id:string}>(f.db,"SELECT id FROM his_intake_issue WHERE kind='IDENTITY_MISMATCH'"))[0].id;
  const staff=await addUser(f.db,'LAB_STAFF','synthetic.p3.staff'),certifier=await addUser(f.db,'LAB_CERTIFIER','synthetic.p3.cert'),anc=await addUser(f.db,'ANC_NURSE','synthetic.p3.anc');
  await expect(proposeResolution(f.db,anc,issue,{action:'link_case',caseId,reason:'SYNTHETIC checked HIS screen'})).rejects.toThrow('FORBIDDEN');
  await expect(proposeResolution(f.db,certifier,issue,{action:'link_case',caseId,reason:'SYNTHETIC checked HIS screen'})).rejects.toThrow('FORBIDDEN');
  await expect(proposeResolution(f.db,staff,issue,{action:'keep_existing',reason:'SYNTHETIC not allowed here'})).rejects.toThrow('ACTION_NOT_ALLOWED_FOR_ISSUE');
  await proposeResolution(f.db,staff,issue,{action:'link_case',caseId,reason:'SYNTHETIC checked HIS screen'});
  const dualRole={...staff,roles:['LAB_STAFF','LAB_CERTIFIER'] as const};
  await expect(decideResolution(f.db,dualRole,issue,{decision:'APPROVED',reason:'SYNTHETIC self approval'},f.deps)).rejects.toThrow('SECOND_PERSON_REQUIRED');
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('Expected');
  await expect(f.db.query("INSERT INTO his_intake_issue_event(issue_id,event,action,case_id,actor_id,reason) VALUES($1,'APPROVED','link_case',$2,$3,'SYNTHETIC direct')",[issue,caseId,staff.id])).rejects.toThrow('SECOND_PERSON_REQUIRED');
  await decideResolution(f.db,certifier,issue,{decision:'APPROVED',reason:'SYNTHETIC second check'},f.deps);
  const s=await caseState(f.db,caseId);expect(s.rounds[0].state).toBe('ReceivedInHIS');expect(s.orders).toHaveLength(1);
  expect(await openIssues(f.db)).toEqual([]);
  expect((await rows<{event:string}>(f.db,'SELECT event FROM his_intake_issue_event WHERE issue_id=$1 ORDER BY sequence',[issue])).map(e=>e.event)).toEqual(['OPENED','PROPOSED','APPROVED']);
 });

 it('AT-HISIN-07 broken CP874, section-60 11-digit LN and non-70096 orders: nothing applied, non-NIPT never stored',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const good=await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'},{ok:false});
  const broken=Buffer.concat([good.bytes.subarray(0,60),Buffer.from([0xdb]),good.bytes.subarray(61)]);
  const {writeFile}=await import('node:fs/promises');await writeFile(good.path,broken);await writeOk(f.root,DAY,good.filename);
  await writePet(f.root,DAY,{ln:'99000123456',hn:HN,receivedAt:'20261012090000',section:'60'});
  await writePet(f.root,DAY,{ln:'990001000099',hn:HN,receivedAt:'20261012090000',testCode:'11111'});
  const r=await cycle(f,{now:NOW});
  expect(r.counts).toMatchObject({petSeen:3,notNipt:2,parseError:1,stored:0});
  expect(await rows(f.db,'SELECT ln,state,error_code,parsed FROM his_inbound_file')).toEqual([{ln:LN,state:'ParseError',error_code:'INVALID_ENCODING',parsed:null}]);
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('Expected');
  await expect(readdir(path.join(path.dirname(f.root),'files'))).rejects.toThrow();
  expect(r.outcome).toBe('SUCCESS');
 });

 it('AT-HISIN-09 share unavailable or worker silent → Enabled but not Alive + alert, backoff, and no intake lost',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const settings={enabled:true,intervalSeconds:30};
  expect((await inboundHealth(f.db,settings,NOW))).toMatchObject({Enabled:true,Alive:false,healthy:false,alerts:['INBOUND_NOT_ALIVE']});
  await rename(path.join(f.root,'.nipt-synthetic-root'),path.join(f.root,'.marker-offline'));
  await expect(cycle(f,{trigger:'INTERVAL',now:NOW})).rejects.toThrow('INBOUND_SHARE_UNAVAILABLE');
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});
  await expect(cycle(f,{trigger:'INTERVAL',now:later(1)})).rejects.toThrow('INBOUND_SHARE_UNAVAILABLE');
  expect(await cycle(f,{trigger:'INTERVAL',now:later(1.5)})).toMatchObject({outcome:'SKIPPED_BACKOFF',counts:{}});
  const down=await inboundHealth(f.db,settings,later(1.6));
  expect(down).toMatchObject({Enabled:true,shareStatus:'BACKOFF',consecutiveFailures:2,healthy:false});expect(down.alerts).toContain('INBOUND_SHARE_UNAVAILABLE');expect(down.nextRetryAt).not.toBeNull();
  expect((await inboundHealth(f.db,settings,later(30))).Alive).toBe(false);
  await rename(path.join(f.root,'.marker-offline'),path.join(f.root,'.nipt-synthetic-root'));
  const manual=await cycle(f,{trigger:'MANUAL',now:later(31)});expect(manual.outcome).toBe('SUCCESS');
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('ReceivedInHIS');
  expect(await inboundHealth(f.db,settings,later(31.5))).toMatchObject({Alive:true,shareStatus:'UP',consecutiveFailures:0,healthy:true,LastError:null});
  expect((await rows<{outcome:string}>(f.db,'SELECT outcome FROM his_inbound_scan_run ORDER BY finished_at')).map(r=>r.outcome)).toEqual(['SHARE_UNAVAILABLE','SHARE_UNAVAILABLE','SKIPPED_BACKOFF','SUCCESS']);
 });

 it('AT-HISIN-09 worker restart and mid-transaction failure: Ready intakes survive and are retried; error codes are recorded then cleared',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});
  await discoverInbound(f.db,f.store,{root:f.root,lookbackDays:1,now:NOW,lookupKey:f.lookupKey}); // "crash" after discovery commits
  expect(await fileStates(f.db,LN)).toEqual([{state:'Ready',error_code:null}]);
  let calls=0;const flaky=new FileStore(f.store.root);flaky.get=async hash=>{if(++calls===1)throw Error('SIMULATED_STORE_OUTAGE');return f.store.get(hash);};
  const failed=await processPending(f.db,{...f.deps,store:flaky});expect(failed.failures).toEqual([{id:expect.any(String),code:'SIMULATED_STORE_OUTAGE'}]);
  expect(await fileStates(f.db,LN)).toEqual([{state:'Ready',error_code:'SIMULATED_STORE_OUTAGE'}]);
  expect((await caseState(f.db,caseId)).orders).toHaveLength(0);
  const retry=await cycle(f,{now:later(1)});expect(retry.counts.outcome_APPLIED_S1).toBe(1);
  expect(await fileStates(f.db,LN)).toEqual([{state:'Applied(S1)',error_code:null}]);
 });

 it('AT-HISIN-10 Asia/Bangkok day folders across midnight; lookback covers the previous folder; P[21] kept as +07:00',async()=>{
  const midnight=new Date('2026-10-12T17:30:00Z'); // 00:30 on 2026-10-13 in Bangkok
  const a='990001000021',b='990001000022';const ca=await register(f,{ln:a,hn:HN}),cb=await register(f,{ln:b,hn:HN});
  await writePet(f.root,'20261012',{ln:a,hn:HN,receivedAt:'20261012235930'});await writePet(f.root,'20261013',{ln:b,hn:HN,receivedAt:'20261013000500'});
  expect((await cycle(f,{now:midnight,lookbackDays:1})).counts).toMatchObject({dayFolders:1,stored:1});
  expect((await caseState(f.db,ca)).rounds[0].state).toBe('Expected');
  expect((await cycle(f,{now:midnight,lookbackDays:2})).counts).toMatchObject({dayFolders:2,stored:1,unchanged:1});
  expect(new Date((await caseState(f.db,ca)).rounds[0].received_at!).toISOString()).toBe('2026-10-12T16:59:30.000Z');
  expect(new Date((await caseState(f.db,cb)).rounds[0].received_at!).toISOString()).toBe('2026-10-12T17:05:00.000Z');
  expect((await rows<{d:string}>(f.db,"SELECT to_char(collection_date,'YYYY-MM-DD') AS d FROM specimen_round WHERE case_id=$1",[ca]))[0].d).toBe('2026-10-12');
 });

 it('AT-ID-REG-01 an LN typed wrongly onto another patient\'s order is caught by HN, or queued IDENTITY_UNVERIFIED without an HN',async()=>{
  const typo='990001000031';const wrong=await register(f,{ln:typo,hn:'9900002002'});
  await writePet(f.root,DAY,{ln:typo,hn:'9900003003',receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  expect((await caseState(f.db,wrong)).rounds[0].state).toBe('Expected');expect((await openIssues(f.db,typo))[0]).toMatchObject({kind:'IDENTITY_MISMATCH',details:{fields:['hn']}});
  const none:RegistrantIdentitySource={forCase:async()=>({scheme:'NONE'})};
  const unverified='990001000032';const c=await register(f,{ln:unverified,hn:HN});
  await writePet(f.root,DAY,{ln:unverified,hn:HN,receivedAt:'20261012090000'});
  await discoverInbound(f.db,f.store,{root:f.root,lookbackDays:1,now:later(1),lookupKey:f.lookupKey});await processPending(f.db,{...f.deps,identity:none});
  expect((await caseState(f.db,c)).rounds[0].state).toBe('Expected');expect((await openIssues(f.db,unverified))[0]).toMatchObject({kind:'IDENTITY_UNVERIFIED'});
 });

 it('AT-LIN-03 LN reused for a different patient after S1: no link, no state change, no new round; two-person keep_existing; LN generation needs P2',async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  const before=await caseState(f.db,caseId);
  await writePet(f.root,DAY,{ln:LN,hn:'9900007777',name:'SYNTHETIC^^นาง ผู้ป่วยอื่น',receivedAt:'20261012150000'},{mtime:later(1)});
  expect((await cycle(f,{now:later(2)})).counts.outcome_LN_REUSED_DIFFERENT_PATIENT).toBe(1);
  expect(await caseState(f.db,caseId)).toEqual(before);expect(await rows(f.db,'SELECT 1 FROM specimen_round WHERE case_id=$1',[caseId])).toHaveLength(1);
  expect(await rows(f.db,'SELECT 1 FROM nipt_case')).toHaveLength(1);
  const issue=(await rows<{id:string;details:{fields:string[]}}>(f.db,"SELECT id,details FROM his_intake_issue WHERE kind='LN_REUSED_DIFFERENT_PATIENT'"))[0];expect(issue.details.fields).toEqual(['hn','name']);
  const staff=await addUser(f.db,'LAB_STAFF','synthetic.p3.s'),cert=await addUser(f.db,'LAB_CERTIFIER','synthetic.p3.c');
  await expect(proposeResolution(f.db,staff,issue.id,{action:'link_case',caseId,reason:'SYNTHETIC wrong action'})).rejects.toThrow('ACTION_NOT_ALLOWED_FOR_ISSUE');
  await expect(proposeResolution(f.db,staff,issue.id,{action:'new_generation',reason:'SYNTHETIC needs P2'})).rejects.toThrow();
  await proposeResolution(f.db,staff,issue.id,{action:'keep_existing',reason:'SYNTHETIC verified in HIS'});
  await decideResolution(f.db,cert,issue.id,{decision:'APPROVED',reason:'SYNTHETIC second check'},f.deps);
  expect(await caseState(f.db,caseId)).toEqual(before);expect(await openIssues(f.db)).toEqual([]);
 });

 for(const s2Received of [false,true])it(`AT-LIN-08 new PET while S2 is ${s2Received?'already received in NIPT':'Expected'}: only an expected redraw receives the new P[21]; S1 immutable`,async()=>{
  const caseId=await register(f,{ln:LN,hn:HN});
  const base={ln:LN,hn:HN,receivedAt:'20261012090000'};const first=await writePet(f.root,DAY,base);await cycle(f,{now:NOW});
  const s1=(await caseState(f.db,caseId)).rounds[0];await redrawToRound2(caseId,s2Received);const s2=await round2(caseId);
  await utimes(first.path,later(5),later(5));
  await writePet(f.root,'20261013',base,{mtime:later(6)});
  await writePet(f.root,'20261013',{...base,receivedAt:'20261013083000'},{mtime:later(7)});
  await writePet(f.root,'20261014',{...base,name:'SYNTHETIC^^นาง แก้ไข'},{mtime:later(8)});
  await cycle(f,{now:new Date('2026-10-14T05:00:00Z'),lookbackDays:5});
  const after=await caseState(f.db,caseId);expect(after.rounds[0].received_at).toEqual(s1.received_at);
  if(s2Received){expect(await round2(caseId)).toBe(s2);expect(after.orders).toHaveLength(1);expect((await openIssues(f.db)).map(i=>i.kind)).toEqual(['LN_REUSED_OR_CHANGED','S1_INTEGRITY_EVENT']);}
  else{expect(after.rounds[1]).toMatchObject({state:'ReceivedInHIS',received_source:'HIS_PET_RECEIPT'});expect(after.rounds[1].received_at?.toISOString()).toBe('2026-10-13T01:30:00.000Z');expect(after.orders).toHaveLength(2);expect((await openIssues(f.db)).map(i=>i.kind)).toEqual(['LN_REUSED_OR_CHANGED']);}
 });

 it('AT-LDR-02 PET first → Lab blind entry: presence only, never HIS values; match links at P[21]; mismatch → IDENTITY_MISMATCH; identifier source recorded',async()=>{
  const match='990001000041',miss='990001000042';
  await writePet(f.root,DAY,{ln:match,hn:HN,dob:'19950505',receivedAt:'20261012081500'});await writePet(f.root,DAY,{ln:miss,hn:HN,receivedAt:'20261012081500'});await cycle(f,{now:NOW});
  const presence=await intakePresence(f.db,match);expect(presence).toEqual({unlinkedIntake:true});expect(await intakePresence(f.db,'990009999999')).toEqual({unlinkedIntake:false});
  const {lab}=await registrar(f.db);
  const registerLab=async(ln:string,hn:string,identifierSource:'TUBE_LABEL'|'REQUEST_FORM')=>{const r=await registerP2Case(f,{ln,hn,origin:'LAB_DIRECT',identifierSource});return {caseId:r.caseId!,link:'intake' in r?r.intake:null};};
  const ok=await registerLab(match,HN,'TUBE_LABEL');expect(ok.link).toEqual({outcome:'APPLIED_S1',fields:[]});
  const s=await caseState(f.db,ok.caseId);expect(s.rounds[0].state).toBe('ReceivedInHIS');expect(new Date(s.rounds[0].received_at!).toISOString()).toBe('2026-10-12T01:15:00.000Z');
  const bad=await registerLab(miss,'9900005555','REQUEST_FORM');expect(bad.link).toEqual({outcome:'IDENTITY_MISMATCH',fields:['hn']});
  expect((await caseState(f.db,bad.caseId)).rounds[0].state).toBe('Expected');expect(await fileStates(f.db,miss)).toEqual([{state:'Unlinked',error_code:null}]);
  // Once a case exists the presence probe answers false and never reveals the case.
  expect(await intakePresence(f.db,miss)).toEqual({unlinkedIntake:false});
  const events=await rows<{details:Record<string,unknown>}>(f.db,"SELECT details FROM case_event WHERE event_type='INTAKE_LINK_AT_REGISTRATION' ORDER BY created_at");
  expect(events.map(e=>[e.details.outcome,e.details.identifierSource,e.details.blindEntry,e.details.actorId])).toEqual([['APPLIED_S1','TUBE_LABEL',true,lab.id],['IDENTITY_MISMATCH','REQUEST_FORM',true,lab.id]]);
  expect(await rows(f.db,"SELECT origin,outcome,identifier_source FROM registration_attempt WHERE case_id IN ($1,$2) ORDER BY identifier_source DESC",[ok.caseId,bad.caseId])).toEqual([{origin:'LAB_DIRECT',outcome:'CREATED',identifier_source:'TUBE_LABEL'},{origin:'LAB_DIRECT',outcome:'CREATED',identifier_source:'REQUEST_FORM'}]);
  await expect(linkIntakeAtRegistration(f.db,lab,{caseId:ok.caseId,ln:miss,hn:HN,identifierSource:'TUBE_LABEL'},f.deps)).rejects.toThrow('CASE_LN_MISMATCH');
 });

 it('AT-HISIN-11 / LD-04 / P3 build: HISTORICAL LN intake is queued separately, never applied and never promoted',async()=>{
  await f.db.query('ALTER TABLE nipt_case DISABLE TRIGGER case_guard'); // fixture stands in for a P5H promotion
  const hc=(await rows<{id:string}>(f.db,"INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1) RETURNING id",[lnHnKey(LN,HN,f.lookupKey)]))[0].id;
  await f.db.query('ALTER TABLE nipt_case ENABLE TRIGGER case_guard');
  await f.db.query("INSERT INTO case_ln(case_id,ln,source,verification) VALUES($1,$2,'HISTORICAL_DOCUMENT','DOCUMENT_VERIFIED')",[hc,LN]);
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});
  expect((await cycle(f,{now:NOW})).counts.outcome_HISTORICAL_LN_INTAKE).toBe(1);
  expect(await rows(f.db,'SELECT 1 FROM his_order')).toHaveLength(0);expect(await rows(f.db,'SELECT 1 FROM specimen_round')).toHaveLength(0);
  expect(await rows(f.db,'SELECT registration_origin FROM nipt_case')).toEqual([{registration_origin:'HISTORICAL'}]);
  expect(await fileStates(f.db,LN)).toEqual([{state:'HistoricalIntake',error_code:null}]);
  expect((await openIssues(f.db)).map(i=>i.kind)).toEqual(['HISTORICAL_LN_INTAKE']);
 });

 it('operational queue and health are PHI-free; Admin sees a masked LN; Test Connection is read-only and passes on the simulator',async()=>{
  await register(f,{ln:LN,hn:'9900009999'});
  await writePet(f.root,DAY,{ln:LN,hn:HN,name:'SYNTHETIC^^นาง ห้ามแสดง',dob:'19911111',receivedAt:'20261012090000',identity:'SYNTHETIC-ID-SECRET'});await cycle(f,{now:NOW});
  const lab=await addUser(f.db,'LAB_STAFF','synthetic.p3.q1'),admin=await addUser(f.db,'APP_ADMIN','synthetic.p3.q2');
  const forLab=await inboundQueue(f.db,lab),forAdmin=await inboundQueue(f.db,admin);
  const noPrivateFields=(value:unknown):void=>{if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){expect(['hn','dob','dateOfBirth','patientName','name','identity','parsed','raw','payload']).not.toContain(key);noPrivateFields(child);}};
  for(const q of [forLab,forAdmin]){const text=JSON.stringify(q);for(const secret of [HN,'ห้ามแสดง','19911111','1991-11-11','SECRET'])expect(text).not.toContain(secret);noPrivateFields(q);}
  expect(forLab.issues[0]).toMatchObject({ln:LN,kind:'IDENTITY_MISMATCH',fields:['hn']});expect(forAdmin.issues[0].ln).toBe('••••0001');expect(forAdmin.issues[0].caseId).toBeNull();
  const report=await testInboundConnection(f.root,{now:NOW});
  expect(report).toMatchObject({passed:true,dayFolders:1,petFiles:1,pairedPetFiles:1,sampleParse:'PASSED'});expect(JSON.stringify(report)).not.toContain(LN);
  expect((await testInboundConnection(path.join(f.root,'missing'))).passed).toBe(false);
 });

 it('UTF-8 or truncated content is a ParseError with a stable code, and never blocks the rest of the batch',async()=>{
  const c=await register(f,{ln:LN,hn:HN});
  const pet=await writePet(f.root,DAY,{ln:'990001000051',hn:HN,receivedAt:'20261012090000'},{ok:false});
  const {writeFile}=await import('node:fs/promises');
  await writeFile(pet.path,iconv.encode(iconv.decode(pet.bytes,'windows-874').split('\r\n').slice(0,2).join('\r\n'),'windows-874'));await writeOk(f.root,DAY,pet.filename);
  await writePet(f.root,DAY,{ln:LN,hn:HN,receivedAt:'20261012090000'});
  const r=await cycle(f,{now:NOW});expect(r.counts).toMatchObject({parseError:1,stored:1,outcome_APPLIED_S1:1});
  expect(await fileStates(f.db,'990001000051')).toEqual([{state:'ParseError',error_code:'INVALID_FIELDS'}]);expect((await caseState(f.db,c)).rounds[0].state).toBe('ReceivedInHIS');
 });
});
