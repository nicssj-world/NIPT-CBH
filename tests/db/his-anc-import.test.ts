import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inboundFixture,registrar,writePet,cycle,registerP2Case,type InboundFixture} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {addUser} from '../helpers/database';
import {lookupRegistrationPet,registerFromPet} from '../../packages/p2/pet-registration';
import {doctorAction,paperReview,type Staff} from '../../packages/p2/service';
import {paperSchema,REQUEST_TEMPLATE} from '../../packages/p2/schema';
import {previewHisAnc} from '../../packages/his-anc/import';
import {hisAncWorkbook,hisAncRow,type HisAncFixtureRow} from '../helpers/his-anc-workbook';

// Owner 2026-11-18: the HIS ANC export fills blanks on cases already waiting; preview first.
let f:InboundFixture,u:Awaited<ReturnType<typeof registrar>>,admin:Staff;
const vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
beforeEach(async()=>{f=await inboundFixture();u=await registrar(f.db);admin=await addUser(f.db,'APP_ADMIN','his.anc.admin');});
afterEach(async()=>{await f.close();});

const iso=(d:Date)=>d.toISOString().slice(0,10),dmy=(isoDate:string)=>isoDate.split('-').reverse().join('/');
const shift=(isoDate:string,days:number)=>iso(new Date(Date.parse(isoDate+'T00:00:00Z')+days*86400000));
/** A Lab paper-route case from its PET (the import runs after PET matching). */
async function labCase(n:number){
 const ln=`99000123${4560+n}`,hn=`99000${12340+n}`,identity=`SYNTHETIC-ID-ANC${n}`;
 await writePet(f.root,'20261020',{ln,hn,identity,receivedAt:'20261020101112',specimenAt:'20261020090000'});await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});
 const deps={store:f.store,lookupKey:f.lookupKey},p=(await tx(f.db,db=>lookupRegistrationPet(db,u.lab,{ln},deps))).candidates[0];
 const r=await tx(f.db,db=>registerFromPet(db,u.lab,{ln,fileId:p.fileId,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()},deps));
 const collected=(await f.db.query<{d:string}>("SELECT COALESCE((SELECT collection_date::text FROM p2_collection_fact WHERE round_id=c.current_round_id ORDER BY sequence DESC LIMIT 1),(SELECT collection_date::text FROM specimen_round_current WHERE id=c.current_round_id)) d FROM nipt_case c WHERE c.id=$1",[r.caseId])).rows[0].d;
 return {caseId:r.caseId!,ln,hn,cid:identity,collected};
}
const preview=(rows:HisAncFixtureRow[],user:Staff=u.lab)=>tx(f.db,db=>previewHisAnc(db,user,hisAncWorkbook(rows),f.lookupKey));
const row=(c:{hn:string;cid:string;collected:string},over:HisAncFixtureRow={})=>hisAncRow({hn:c.hn,cid:c.cid,date_serv:dmy(shift(c.collected,-3)),ga:'16+2',edc:dmy(shift(c.collected,-3+280-114)),provider:'พญ.SYNTHETIC ใหม่ หนึ่ง',...over});
const registryDoctor=async(name:string)=>String((await tx(f.db,db=>doctorAction(db,admin,{action:'save',doctorKey:'SYNTHETIC-HIS-ANC-'+randomUUID().slice(0,8).toUpperCase(),name,unitId:u.unit,vector}))as {id:string}).id);
const count=async(table:string)=>(await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

describe('preview',()=>{
 it('a matched, unchecked Lab case fills doctor (to be added), GA counted to the blood-draw date, ครรภ์ที่, Singleton, weight and height',async()=>{
  const c=await labCase(1);expect(c.collected).toBeTruthy();
  const plan=await preview([row(c)]);
  expect(plan.counts.FILL).toBe(1);
  expect(plan.items[0]).toMatchObject({outcome:'FILL',caseId:c.caseId,ln:c.ln,fills:{doctor:{name:'พญ.SYNTHETIC ใหม่ หนึ่ง',versionId:null},gaWeeks:16,gaDays:5,gravida:2,pregnancyType:'Singleton',weightKg:99.6,heightCm:160}});
 });
 it('a provider one letter off a registry doctor uses that doctor',async()=>{
  const c=await labCase(2),id=await registryDoctor('SYNTHETIC ทดสอบ สมชาย');
  const plan=await preview([row(c,{provider:'พญ.SYNTHETIC ทดสอบ สมชัย'})]);
  expect(plan.items[0].fills.doctor).toEqual({name:'SYNTHETIC ทดสอบ สมชาย',versionId:id});
 });
 it('CID right but HN wrong is not matched',async()=>{
  const c=await labCase(3);expect((await preview([row(c,{hn:'9900099999'})])).items[0]).toMatchObject({outcome:'NOT_MATCHED',caseId:null,fills:{}});
 });
 it('a case whose request was already checked is skipped',async()=>{
  const c=await labCase(4),doctor=await registryDoctor('SYNTHETIC แพทย์ เดิม');
  const panel={...paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null]))),doctorVersionId:doctor,gaWeeks:16,gaDays:2,pregnancyType:'Singleton' as const};
  await tx(f.db,db=>paperReview(db,u.lab,c.caseId,{kind:'REQUEST',templateVersion:REQUEST_TEMPLATE,panel,operation:'Review',previousId:null}));
  expect((await preview([row(c)])).items[0]).toMatchObject({outcome:'ALREADY_CHECKED',fills:{}});
 });
 it('an ANC case with an electronic request is skipped',async()=>{
  const ln='990001239001',hn='9900039001',identity='SYNTHETIC-ID-ANCE';
  const caseId=(await registerP2Case(f,{ln,hn,origin:'ANC'})).caseId!;
  await writePet(f.root,'20261020',{ln,hn,identity,receivedAt:'20261020101112'});await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});
  expect((await preview([hisAncRow({hn,cid:identity})])).items[0]).toMatchObject({outcome:'ELECTRONIC_REQUEST',caseId});
 });
 it('a provider who is not พญ./นพ. skips the row with nothing filled',async()=>{
  const c=await labCase(5);expect((await preview([row(c,{provider:'น.ส.SYNTHETIC พยาบาล'})])).items[0]).toMatchObject({outcome:'NOT_A_DOCTOR',fills:{}});
 });
 it('an incomplete HIS row is skipped with its reason',async()=>{
  const c=await labCase(6);expect((await preview([row(c,{gravida:'0'})])).items[0]).toMatchObject({outcome:'HIS_INCOMPLETE',reason:'G_ZERO',fills:{}});
 });
 it('weight already on the request is not filled again',async()=>{
  const c=await labCase(7);
  await f.db.query("UPDATE p2_workspace SET draft=jsonb_set(draft,'{pregnancy,weightKg}','61'),version=version+1 WHERE case_id=$1",[c.caseId]);
  const fills=(await preview([row(c)])).items[0].fills;expect(fills).not.toHaveProperty('weightKg');expect(fills.heightCm).toBe(160);
 });
 it('two visits of one patient: the newest is used, the other is a duplicate',async()=>{
  const c=await labCase(8),plan=await preview([row(c,{date_serv:dmy(shift(c.collected,-10)),ga:'15+2',edc:dmy(shift(c.collected,-10+280-107))}),row(c)]);
  expect(plan.items.map(i=>i.outcome)).toEqual(['DUPLICATE_IN_FILE','FILL']);
 });
 it('preview writes nothing',async()=>{
  const c=await labCase(9),before=[await count('p2_paper_review'),await count('p2_doctor_version')];
  await preview([row(c)]);expect([await count('p2_paper_review'),await count('p2_doctor_version')]).toEqual(before);
 });
 it('a user without paper.verify is refused',async()=>{
  const c=await labCase(10);await expect(preview([row(c)],u.anc)).rejects.toThrow('FORBIDDEN');
 });
});
