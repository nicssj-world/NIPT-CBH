import {it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {orderRepeat,orderRedraw,previewLabels,receiveRedraw} from '../../packages/lab/intake';
import {worklistRow} from '../../packages/lab/worklist';
import {attemptFacts,candidatePrintedId} from '../../packages/lab/core';

it.each(['S2','S3'] as const)('Task1 persisted case ordinals and exceptional %s lineage with repeated nonunique IDs',async(specimen)=>{
 const f=await inboundFixture();try{
  const ln='990001009231',hn='9900001231',caseId=await register(f,{ln,hn}),{lab}=await registrar(f.db);
  const pet=async(day:string)=>{await writePet(f.root,day,{ln,hn,receivedAt:day+'090000',specimenAt:day+'080000'});return cycle(f,{now:new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T05:00:00Z')});};
  await pet('20261021');
  // Verified pregnancy per specimen is separate from immutable identity; no patient data.
  const current=async()=>{const a=(await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[caseId]))[0];await f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC','{\"pregnancyType\":\"Twins\"}','Verified','SYNTHETIC','SYNTHETIC task1 fixture',$3)",[caseId,a.round_id,lab.id]);return (await attemptFacts(f.db,'a.id=$1',[a.attempt_id]))[0];};
  const first=await current(),base=first.ln_halos!;expect(candidatePrintedId(first).id).toBe(base+'D-1');
  const fail=async(id:string)=>{await f.db.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=(SELECT repeat_order_id FROM analytical_attempt WHERE id=$1) AND state='RepeatPendingBatch'",[id]);await f.db.query("UPDATE analytical_attempt SET state='Assigned' WHERE id=$1",[id]);await f.db.query("UPDATE analytical_attempt SET state='InProgress' WHERE id=$1",[id]);await f.db.query("UPDATE analytical_attempt SET state='QcFailed',qc_failed_stage='QC1' WHERE id=$1",[id]);};
  await fail(first.attempt_id);
  const second=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:first.attempt_id,level:'RE_EXTRACTION',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC confirmed extraction failure'}));
  expect(second.printedSampleId).toBe(base+'D-2');
  await fail(second.attemptId);
  await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'QC1_FAILED',note:'SYNTHETIC new specimen request S2'}));
  expect((await pet('20261022')).counts.outcome_APPLIED_REDRAW).toBe(1);
  const third=await current();expect(candidatePrintedId(third).id).toBe(base+'DR-1');await fail(third.attempt_id);
  const fourth=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:third.attempt_id,level:'RE_LIBRARY',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC confirmed library failure'}));
  expect(fourth.printedSampleId).toBe(base+'DR-2');
  await expect(tx(f.db,db=>orderRepeat(db,lab,{attemptId:fourth.attemptId,level:'RE_LIBRARY',reasonCode:'OTHER',note:'SYNTHETIC scheduling is not a failure'}))).rejects.toThrow('REPEAT_REQUIRES_FAILED_OR_STOPPED_ATTEMPT');
  await fail(fourth.attemptId);
  expect(worklistRow((await attemptFacts(f.db,'a.id=$1',[fourth.attemptId]))[0],'HOLD').outcomeStatus).toBe('รอพิจารณาหลังครบ 4 ครั้ง');
  await expect(tx(f.db,db=>orderRepeat(db,lab,{attemptId:fourth.attemptId,level:'RE_LIBRARY',reasonCode:'OTHER'}))).rejects.toThrow();
  let fifth;
  if(specimen==='S3'){
   const s3=await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'QC_SAMPLE_FAILED',note:'SYNTHETIC exceptional new specimen S3'}));
   await expect(tx(f.db,db=>receiveRedraw(db,lab,{roundId:s3.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-23'}))).rejects.toThrow('REDRAW_REQUIRES_NEW_HIS_PET');
   await f.db.exec(await (await import('node:fs/promises')).readFile('packages/db/roles.sql','utf8'));
   await writePet(f.root,'20261023',{ln,hn:'9900099999',receivedAt:'20261023090000',specimenAt:'20261023080000'});
   await cycle(f,{now:new Date('2026-10-23T05:00:00Z')});
   expect((await f.db.query<{received_at:Date|null}>('SELECT received_at FROM specimen_round WHERE id=$1',[s3.newRoundId])).rows[0].received_at).toBeNull();
   await f.db.query('SET ROLE worker_rw');
   try{expect((await pet('20261023')).counts.outcome_APPLIED_REDRAW).toBe(1);}finally{await f.db.query('RESET ROLE');}
   fifth=await current();
  }else{
   const repeat=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:fourth.attemptId,level:'RE_EXTRACTION',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC exceptional repeat on existing S2'}));
   fifth=(await attemptFacts(f.db,'a.id=$1',[repeat.attemptId]))[0];
  }
  expect(candidatePrintedId(fifth).id).toBe(base+'DR-1');await fail(fifth.attempt_id);
  const sixth=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:fifth.attempt_id,level:'RE_EXTRACTION',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC exceptional repeat on existing specimen'}));expect(sixth.printedSampleId).toBe(base+'DR-1');
  const label=await previewLabels(f.db,lab,{roundIds:[fifth.round_id],includeName:false});
  expect(label.html.match(/class="sticker"/g)).toHaveLength(4);expect(label.html.match(/LN: /g)).toHaveLength(8);
  expect(label.html).toContain(base+'DR');expect(label.html).not.toContain(base+'DRR');
  const all=await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal',[caseId]);
  expect(all.map(a=>a.overall_ordinal)).toEqual([1,2,3,4,5,6]);expect(new Set(all.map(a=>a.attempt_id)).size).toBe(6);
  for(const a of all)await f.db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[a.attempt_id,candidatePrintedId(a).id]);
  expect((await cycle(f,{now:new Date('2026-10-23T05:00:00Z')})).counts.outcome_APPLIED_REDRAW??0).toBe(0);
  expect((await f.db.query('SELECT * FROM his_order')).rows).toHaveLength(specimen==='S3'?3:2);
  await expect(tx(f.db,db=>db.query('UPDATE analytical_attempt SET overall_ordinal=9 WHERE id=$1',[sixth.attemptId]))).rejects.toThrow('IMMUTABLE');
  if(specimen==='S3')expect((await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'OTHER',note:'SYNTHETIC further specimen owner authorized'}))).newRoundNumber).toBe(4);
 }finally{await f.close();}
},120000);

it('Owner early-redraw decision: repeated S2 work before overall LAB5 keeps R-2 then global5 resets R-1',async()=>{
 const f=await inboundFixture();try{
  const ln='990001009238',hn='9900001238',caseId=await register(f,{ln,hn}),{lab}=await registrar(f.db);
  const receive=async(day:string)=>{await writePet(f.root,day,{ln,hn,receivedAt:day+'090000'});await cycle(f,{now:new Date('2026-10-23T05:00:00Z')});};
  const latest=async()=>(await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[caseId]))[0];
  const fail=async()=>{const a=await latest();await f.db.query("UPDATE analytical_attempt SET state='Assigned' WHERE id=$1",[a.attempt_id]);if(a.repeat_order_id)await f.db.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=$1",[a.repeat_order_id]);await f.db.query("UPDATE analytical_attempt SET state='InProgress' WHERE id=$1",[a.attempt_id]);await f.db.query("UPDATE analytical_attempt SET state='QcFailed',qc_failed_stage='QC1' WHERE id=$1",[a.attempt_id]);return a;};
  await receive('20261021');await fail();
  await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'SPECIMEN_PROBLEM',note:'SYNTHETIC early redraw existing workflow'}));await receive('20261022');const second=await fail();
  await tx(f.db,db=>orderRepeat(db,lab,{attemptId:second.attempt_id,level:'RE_LIBRARY',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC shared S2 repeat'}));const third=await fail();
  await f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC','{\"pregnancyType\":\"Singleton\"}','Verified','SYNTHETIC','SYNTHETIC early resampling',$3)",[caseId,third.round_id,lab.id]);
  const fourth=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:third.attempt_id,level:'RE_EXTRACTION',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC owner authorized early redraw repeat'}));expect(fourth.printedSampleId).toBe(third.ln_halos+'R-2');
  await fail();const fifth=await tx(f.db,db=>orderRepeat(db,lab,{attemptId:fourth.attemptId,level:'RE_LIBRARY',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC owner exceptional repeated specimen'}));expect(fifth.printedSampleId).toBe(third.ln_halos+'R-1');
  expect((await f.db.query('SELECT id FROM analytical_attempt WHERE case_id=$1',[caseId])).rows).toHaveLength(5);
 }finally{await f.close();}
},120000);


it('Owner early Re-Sampling: S3 before LAB4 and S4 onward use genuine newer PET with one persistent R and no new base',async()=>{
 const f=await inboundFixture();try{
  const ln='990001009239',hn='9900001239',caseId=await register(f,{ln,hn}),{lab}=await registrar(f.db);
  const latest=async()=>(await attemptFacts(f.db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[caseId]))[0];
  const ids:string[]=[],rounds:string[]=[],display:string[]=[];let base='';
  await f.db.exec(await (await import('node:fs/promises')).readFile('packages/db/roles.sql','utf8'));
  for(let n=1;n<=6;n++){
   const day=`202610${20+n}`;
   if(n>1){const request=await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'SPECIMEN_PROBLEM',note:'SYNTHETIC early further redraw authorized by Owner'}));expect(request.newRoundNumber).toBe(n);}
   await writePet(f.root,day,{ln,hn,receivedAt:day+'090000',specimenAt:day+'080000'});
   await f.db.query('SET ROLE worker_rw');try{const result=await cycle(f,{now:new Date(`2026-10-${20+n}T05:00:00Z`)});expect(result.counts[n===1?'outcome_APPLIED_S1':'outcome_APPLIED_REDRAW']).toBe(1);}finally{await f.db.query('RESET ROLE');}
   const a=await latest();if(n===1)base=a.ln_halos!;expect(a.ln_halos).toBe(base);expect(a.overall_ordinal).toBe(n);expect(a.round_number).toBe(n);
   await f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC','{\"pregnancyType\":\"Twins\"}','Verified','SYNTHETIC','SYNTHETIC early resampling',$3)",[caseId,a.round_id,lab.id]);
   const full=(await attemptFacts(f.db,'a.id=$1',[a.attempt_id]))[0];ids.push(a.attempt_id);rounds.push(a.round_id);display.push(candidatePrintedId(full).id!);
   if(n>1){const labels=await previewLabels(f.db,lab,{roundIds:[a.round_id],includeName:false});expect(labels.html).toContain(base+'DR');expect(labels.html).not.toContain(base+'DRR');}
   expect((await cycle(f,{now:new Date(`2026-10-${20+n}T05:00:00Z`)})).counts.outcome_APPLIED_REDRAW??0).toBe(0);
  }
  expect(display).toEqual([base+'D-1',...Array(5).fill(base+'DR-1')]);expect(new Set(ids).size).toBe(6);expect(new Set(rounds).size).toBe(6);
  expect((await f.db.query('SELECT ln FROM case_ln WHERE case_id=$1',[caseId])).rows).toEqual([{ln}]);expect((await f.db.query('SELECT id FROM his_order')).rows).toHaveLength(6);
 }finally{await f.close();}
},120000);
