import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import fc from 'fast-check';
import {readFile,readdir,utimes} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inboundFixture,writePet,register,cycle,caseState,rows,treeChecksum,openIssues,type InboundFixture} from '../helpers/inbound';
import {addUser} from '../helpers/database';
import {registerCase} from '../../packages/db/registration';
import {lnHnKey} from '../../packages/inbound/identity';
import {linkIntakeAtRegistration} from '../../packages/inbound/registration-link';
import {proposeResolution,decideResolution} from '../../packages/inbound/resolution';
import {testInboundConnection} from '../../packages/inbound/connection-test';
import type {SyntheticPetSpec} from '../../packages/inbound/wire';

const HN='9900001001',DAYS=['20261012','20261013','20261014'];
const at=(day:string,minute:number)=>new Date(Date.UTC(+day.slice(0,4),+day.slice(4,6)-1,+day.slice(6,8),5,minute));

describe('AT-HISIN-11 property: any S1 PET sequence never changes rounds >= 2 (LD-04)',()=>{
 let f:InboundFixture,serial=0;
 beforeAll(async()=>{f=await inboundFixture();});afterAll(async()=>{await f.close();});
 type Op={kind:'resend'|'order'|'identity'|'touch';day:number;field:number;s2Received:boolean};
 const op=fc.record({kind:fc.constantFrom('resend','order','identity','touch'),day:fc.integer({min:0,max:2}),field:fc.integer({min:0,max:3}),s2Received:fc.boolean()}) as fc.Arbitrary<Op>;
 it('random resend/changed/late/cross-folder PET sequences with S2 Expected or received',async()=>{
  await fc.assert(fc.asyncProperty(fc.array(op,{minLength:1,maxLength:6}),fc.boolean(),async(ops,s2Received)=>{
   const ln=`99000${String(++serial).padStart(7,'0')}`,caseId=await register(f.db,f.lookupKey,{ln,hn:HN});
   const base:SyntheticPetSpec={ln,hn:HN,receivedAt:'20261012090000',specimenAt:'20261012070000',orderAt:'20261011160000'};
   const first=await writePet(f.root,DAYS[0],base,{mtime:at(DAYS[0],0)});await cycle(f,{now:at(DAYS[0],1),lookbackDays:3});
   const s1=(await rows<{id:string;case_ln_id:string;received_at:Date}>(f.db,'SELECT id,case_ln_id,received_at FROM specimen_round WHERE case_id=$1',[caseId]))[0];
   await f.db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[s1.id]);
   const redraw=(await rows<{id:string}>(f.db,"INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,'SYNTHETIC') RETURNING id",[caseId,s1.id]))[0].id;
   const s2=(await rows<{id:string}>(f.db,'INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[caseId,s1.case_ln_id,redraw]))[0].id;
   if(s2Received){const u=await addUser(f.db,'LAB_STAFF','synthetic.prop.'+serial);await f.db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,receipt_check='{\"identity\":true,\"label\":true}' WHERE id=$1",[s2,u.id]);}
   const round2=async()=>JSON.stringify(await rows(f.db,'SELECT * FROM specimen_round WHERE case_id=$1 AND round_number>=2',[caseId]));
   const before=await round2();let minute=2;
   for(const o of ops){
    const day=DAYS[o.day];minute+=2;
    if(o.kind==='touch'){await utimes(first.path,at(day,minute),at(day,minute));}
    else{const spec={...base};
     if(o.kind==='order')Object.assign(spec,[{receivedAt:'20261013083000'},{specimenAt:'20261012073000'},{orderAt:'20261011170000'},{ward:'SYNTHETIC-W9'}][o.field]);
     if(o.kind==='identity')Object.assign(spec,[{hn:'9900008888'},{name:'SYNTHETIC^^นาง อื่น'},{dob:'19990101'},{sex:'M'}][o.field]);
     await writePet(f.root,day,spec,{mtime:at(day,minute)});}
    await cycle(f,{now:at(DAYS[2],minute),lookbackDays:3});
    expect(await round2()).toBe(before);
    const now=await caseState(f.db,caseId);expect(now.orders).toHaveLength(1);expect(now.rounds[0].received_at).toEqual(s1.received_at);
   }
  }),{numRuns:20,seed:20261012});
 },180_000);
});

type Step='pet'|'registerHook'|'registerPlain';
describe('AT-LDR-08 order independence (sequential interleavings, incl. replay and an aborted transaction)',()=>{
 const orders:Step[][]=[['pet','registerHook'],['pet','registerPlain'],['registerHook','pet'],['registerPlain','pet']];
 for(const matching of [true,false])it(`one case, ≤1 his_order, same terminal state in every order (${matching?'matching':'mismatching'} identifiers)`,async()=>{
  const finals:string[]=[];
  for(const order of orders){
   const f=await inboundFixture();
   try{
    const ln='990001000201',registrantHn=matching?HN:'9900006666',key='p3_ldr08_'+randomUUID().replaceAll('-','');
    const reg=async(hook:boolean,abort=false)=>{await f.db.query('BEGIN');try{const r=await registerCase(f.db,{ln,identityKey:lnHnKey(ln,registrantHn,f.lookupKey),origin:'LAB_DIRECT',idempotencyKey:key});if(hook)await linkIntakeAtRegistration(f.db,{caseId:r.caseId,ln,hn:registrantHn,identifierSource:'TUBE_LABEL'},f.deps);if(abort)throw Error('SIMULATED_ABORT');await f.db.query('COMMIT');}catch(e){await f.db.query('ROLLBACK');if(!abort)throw e;}};
    let minute=0;
    for(const step of order){
     minute+=5;
     if(step==='pet'){await writePet(f.root,'20261012',{ln,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:new Date(Date.UTC(2026,9,12,5,minute))});}
     else{await reg(step==='registerHook',true);await reg(step==='registerHook');await reg(step==='registerHook');} // aborted attempt, real attempt, replay (same key)
    }
    await cycle(f,{now:new Date(Date.UTC(2026,9,12,6,0))}); // worker rematch safety net
    const counts=(await rows<{cases:number;lns:number;orders:number}>(f.db,'SELECT (SELECT count(*)::int FROM nipt_case) AS cases,(SELECT count(*)::int FROM case_ln) AS lns,(SELECT count(*)::int FROM his_order) AS orders'))[0];
    const round=(await rows<{state:string}>(f.db,'SELECT state FROM specimen_round'))[0];
    const files=(await rows<{state:string}>(f.db,'SELECT state FROM his_inbound_file')).map(x=>x.state);
    finals.push(JSON.stringify({counts,round,files,issues:(await openIssues(f.db)).map(i=>i.kind),attempts:(await rows(f.db,'SELECT DISTINCT outcome FROM registration_attempt')).length}));
   }finally{await f.close();}
  }
  expect(new Set(finals).size).toBe(1);
  const final=JSON.parse(finals[0]);
  expect(final.counts).toEqual({cases:1,lns:1,orders:matching?1:0});
  expect(final).toMatchObject(matching?{round:{state:'ReceivedInHIS'},files:['Applied(S1)'],issues:[]}:{round:{state:'Expected'},files:['Unlinked'],issues:['IDENTITY_MISMATCH']});
 },120_000);
});

describe('AT-HISIN-08 read-only proof across the whole lifecycle',()=>{
 it('simulator tree checksum is unchanged after scans, test connection, linking, conflicts, redraw and two-person resolution',async()=>{
  const f=await inboundFixture();
  try{
   const ln='990001000301',other='990001000302';
   await writePet(f.root,'20261012',{ln,hn:HN,receivedAt:'20261012090000'});await writePet(f.root,'20261012',{ln:other,hn:HN,receivedAt:'20261012090000'},{ok:false});
   await writePet(f.root,'20261012',{ln:'99000123456',hn:HN,receivedAt:'20261012090000',section:'60'});
   await writePet(f.root,'20261013',{ln,hn:'9900007777',receivedAt:'20261013090000'});
   const before=await treeChecksum(f.root);
   const caseId=await register(f.db,f.lookupKey,{ln,hn:HN});
   await testInboundConnection(f.root,{now:new Date('2026-10-13T05:00:00Z')});
   await cycle(f,{now:new Date('2026-10-12T05:00:00Z')});
   const s1=(await rows<{id:string;case_ln_id:string}>(f.db,'SELECT id,case_ln_id FROM specimen_round WHERE case_id=$1',[caseId]))[0];
   await f.db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[s1.id]);
   const redraw=(await rows<{id:string}>(f.db,"INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,'SYNTHETIC') RETURNING id",[caseId,s1.id]))[0].id;
   await f.db.query('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3)',[caseId,s1.case_ln_id,redraw]);
   await cycle(f,{now:new Date('2026-10-13T05:00:00Z'),lookbackDays:2,trigger:'DEEP'});
   const issue=(await rows<{id:string}>(f.db,"SELECT id FROM his_intake_issue WHERE kind='LN_REUSED_DIFFERENT_PATIENT'"))[0].id;
   const staff=await addUser(f.db,'LAB_STAFF','synthetic.ro.s'),cert=await addUser(f.db,'LAB_CERTIFIER','synthetic.ro.c');
   await proposeResolution(f.db,staff,issue,{action:'keep_existing',reason:'SYNTHETIC verified in HIS'});await decideResolution(f.db,cert,issue,{decision:'APPROVED',reason:'SYNTHETIC second check'},f.deps);
   expect(await treeChecksum(f.root)).toEqual(before);
  }finally{await f.close();}
 });

 it('inbound modules contain no filesystem write, rename, delete or permission API (static guard)',async()=>{
  const dir='packages/inbound';
  for(const name of await readdir(dir)){
   const source=await readFile(path.join(dir,name),'utf8');
   expect(source,name).not.toMatch(/\b(writeFile|appendFile|mkdir|rename|unlink|rmdir|rm|copyFile|cp|utimes|chmod|chown|symlink|link|truncate|createWriteStream|open)\s*\(/);
   expect(source,name).not.toMatch(/immutableWrite|atomicImmutableWrite|confined\([^)]*,\s*true\)/);
  }
 });
});
