import {beforeEach,afterEach,it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle,rows,type InboundFixture} from '../helpers/inbound';
import {orderRedraw,labWorklist,previewLabels,printLabels} from '../../packages/lab/intake';
import {tx,labUsers} from '../helpers/lab';
import {printedSampleId} from '../../packages/lab/rules';

// Owner Lock OD-R1 / OD-R1a: redraw S2 (HIS PET) = S1 base + R, Twins D before R; labels, print audit and screens show it;
// the base, monthly sequence and lineage are unchanged. Synthetic PGlite database only (all migrations incl. 099).
let f:InboundFixture;
const now=new Date('2026-10-14T06:00:00Z');
beforeEach(async()=>{f=await inboundFixture();});
afterEach(async()=>{await f.close();});
const confirmPregnancy=(caseId:string,roundId:string,userId:string,type:'Singleton'|'Twins')=>f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC review',$4)",[caseId,roundId,JSON.stringify({pregnancyType:type}),userId]);
async function redrawCase(ln:string,hn:string,pregnancy:'Singleton'|'Twins'){
 const caseId=await register(f,{ln,hn});
 await writePet(f.root,'20261013',{ln,hn,receivedAt:'20261013080000'});await cycle(f,{now});
 const {lab}=await registrar(f.db);const {certifier}=await labUsers(f.db);
 const s1=(await rows<{id:string}>(f.db,'SELECT id FROM specimen_round WHERE case_id=$1 AND round_number=1',[caseId]))[0].id;await confirmPregnancy(caseId,s1,lab.id,pregnancy);
 const base=(await rows<{ln_halos:string}>(f.db,'SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[s1]))[0].ln_halos;
 const counter=async()=>(await rows<{v:number}>(f.db,'SELECT sum(last_value)::int v FROM ln_halos_monthly_sequence'))[0].v;
 const before=await counter();
 const next=await tx(f.db,()=>orderRedraw(f.db,certifier,{caseId,reasonCode:'OTHER',note:'SYNTHETIC redraw due to specimen condition'}));
 await writePet(f.root,'20261014',{ln,hn,receivedAt:'20261014090000'});await cycle(f,{now});
 await confirmPregnancy(caseId,next.newRoundId,lab.id,pregnancy);
 return {caseId,s1,s2:next.newRoundId,base,lab,counterUnchanged:(await counter())===before};
}
it('S2 labels/print audit/worklist show BASE[D]R while S1 keeps BASE; base, counter and lineage unchanged; twins D before R',async()=>{
 const single=await redrawCase('990001009201','9900002001','Singleton');
 const twin=await redrawCase('990001009202','9900002002','Twins');
 for(const c of [single,twin]){
  expect(c.counterUnchanged).toBe(true); // no monthly sequence on redraw
  const lineage=await rows<{round_id:string;ln_halos:string;original_round_id:string|null}>(f.db,'SELECT round_id,ln_halos,original_round_id FROM specimen_lab_number WHERE case_id=$1 ORDER BY original_round_id NULLS FIRST',[c.caseId]);
  expect(lineage).toEqual([{round_id:c.s1,ln_halos:c.base,original_round_id:null},{round_id:c.s2,ln_halos:c.base,original_round_id:c.s1}]);
 }
 const s1Code=single.base,s2Code=single.base+'R',twinS1=twin.base+'D',twinS2=twin.base+'DR';
 const preview=await tx(f.db,()=>previewLabels(f.db,single.lab,{roundIds:[single.s1,single.s2,twin.s1,twin.s2],includeName:false}));
 expect(preview.codes).toEqual([s1Code,s2Code,twinS1,twinS2]);
 // Same 4 stickers / 8 halves pattern per sample with CODE = BASE[D][R]; -1/-2/-3 are label composition only.
 for(const code of [s2Code,twinS2])for(const half of [code,`${code}-1`,`${code}-2`,`${code}-3`])expect(preview.html).toContain(`>${half}</div>`);
 expect(preview.html).not.toMatch(/RR|DD|RD/);
 // Corners carry the base NNN for S1 and S2 alike: 4 per half × 8 halves × 2 samples per base.
 for(const base of [single.base,twin.base])expect((preview.html.match(new RegExp(`>${base.slice(-3)}</span>`,'g'))??[]).length).toBe(4*8*2);
 const print=await tx(f.db,()=>printLabels(f.db,single.lab,{roundIds:[single.s2,twin.s2],includeName:false}));
 expect(print.kind).toBe('PRINT');
 expect(await rows(f.db,'SELECT printed_code FROM label_print_item WHERE job_id=$1 ORDER BY position',[print.jobId])).toEqual([{printed_code:s2Code},{printed_code:twinS2}]);
 await expect(tx(f.db,()=>printLabels(f.db,single.lab,{roundIds:[single.s2],includeName:false}))).rejects.toThrow('REPRINT_REASON_REQUIRED');
 const reprint=await tx(f.db,()=>printLabels(f.db,single.lab,{roundIds:[single.s2],includeName:false,reason:'จำลอง สติ๊กเกอร์เสียหาย'}));
 expect(reprint.kind).toBe('REPRINT');
 expect(await rows(f.db,'SELECT count(*)::int n FROM specimen_lab_number WHERE case_id=ANY($1::uuid[])',[[single.caseId,twin.caseId]])).toEqual([{n:4}]); // print never issues a number
 const list=JSON.stringify(await labWorklist(f.db,single.lab));
 // The worklist lists the current round only: S2 shows the redraw code (S1's code is checked via the label preview above).
 for(const code of [s2Code,twinS2])expect(list).toContain(`"labelCode":"${code}"`);
 expect(list).not.toContain(`"labelCode":"${s1Code}"`);
});

it('Owner early Re-Sampling permits S3 before four attempts while requiring a new PET receipt',async()=>{
 const c=await redrawCase('990001009203','9900002003','Singleton');
 const {lab}=await registrar(f.db);
 const s3=await tx(f.db,()=>orderRedraw(f.db,lab,{caseId:c.caseId,reasonCode:'OTHER',note:'SYNTHETIC Owner authorized early new specimen'}));expect(s3.newRoundNumber).toBe(3);
 expect(await rows(f.db,'SELECT id,state,received_at FROM specimen_round WHERE case_id=$1 AND round_number=3',[c.caseId])).toEqual([{id:s3.newRoundId,state:'Expected',received_at:null}]);
 expect(printedSampleId({base:c.base,pregnancy:'Singleton',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:3,receivedSource:'HIS_PET_RECEIPT'})).toBe(c.base+'R-1');
});
