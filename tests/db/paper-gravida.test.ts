import {afterAll,beforeAll,afterEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {registerP2,paperReview,doctorAction,setModes,getCase,type Staff} from '../../packages/p2/service';
import {paperSchema,REQUEST_TEMPLATE,type RequestDraft} from '../../packages/p2/schema';

// Owner 2026-11-14: "ครรภ์ที่" entered in the short paper request check reaches the request (G on the case page), like type, EDD and doctor.
let db:PGlite,lab:Staff,admin:Staff,checker:Staff,unit:string,doctor:string;
const vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
beforeAll(async()=>{
 db=await testDatabase();lab=await addUser(db,'LAB_STAFF','gravida.lab');admin=await addUser(db,'APP_ADMIN','gravida.admin');checker=await addUser(db,'CLINICAL_APPROVER','gravida.checker');
 unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_GRAVIDA','จำลอง') RETURNING id")).rows[0].id;
 const d=await tx(()=>doctorAction(db,admin,{action:'propose',doctorKey:'SYNTHETIC-DR-G',name:'SYNTHETIC นพ.ทะเบียน จี',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector}));
 await tx(()=>doctorAction(db,checker,{action:'approve',id:d.id,reason:'SYNTHETIC checked'}));doctor=String(d.id);
});
afterAll(async()=>db.close());afterEach(()=>vi.unstubAllEnvs());
const shortPanel=(gravida:number|null)=>{const p=paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));return {...p,doctorVersionId:doctor,gaWeeks:16,gaDays:2,gravida,pregnancyType:'Singleton' as const};};
const gOf=async(id:string)=>((await db.query<{draft:RequestDraft}>('SELECT w.draft FROM p2_workspace w JOIN nipt_case c ON c.current_round_id=w.round_id WHERE c.id=$1',[id])).rows[0].draft.pregnancy.gravida??null);

it('the verified short paper check copies ครรภ์ที่ to the request; a later check without it keeps the value',async()=>{
 const c=await tx(()=>registerP2(db,lab,{ln:'0099014001',hn:'0099014001',unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'GRAVIDA-REQUEST-TEST-1'},Buffer.alloc(32,9)));
 const id=c.caseId!;
 await tx(()=>setModes(db,lab,id,{expectedVersion:0,requestMode:'Paper',consentMode:'Paper'}));
 // The blood-draw date comes with the HIS receipt; set it on the round directly (fixture, triggers off).
 await tx(async()=>{await db.query('SET LOCAL session_replication_role=replica');await db.query("UPDATE specimen_round SET collection_date='2026-11-01' WHERE id=(SELECT current_round_id FROM nipt_case WHERE id=$1)",[id]);});
 const first=await tx(()=>paperReview(db,lab,id,{kind:'REQUEST',templateVersion:REQUEST_TEMPLATE,panel:shortPanel(3),operation:'Review',previousId:null}));
 expect(first).toMatchObject({status:'Verified'});
 expect(await gOf(id)).toBe(3);
 const previous=(await getCase(db,lab,id)).paper.find(p=>p.kind==='REQUEST')!;
 await tx(()=>paperReview(db,lab,id,{kind:'REQUEST',templateVersion:REQUEST_TEMPLATE,panel:shortPanel(null),operation:'Amend',previousId:previous.id,reason:'SYNTHETIC amend',documentReference:'SYNTHETIC-REF',location:'SYNTHETIC-LOC'}));
 expect(await gOf(id)).toBe(3);
});
