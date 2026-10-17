import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf} from '../helpers/lab';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import {gestationalAge,GA_WARNING_DAYS} from '../../packages/lab/core';
import type {Queryable} from '../../packages/db/connection';

// Master Owner Directive 2026-10-18 targeted workflow corrections. Synthetic PGlite database only.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{vi.unstubAllEnvs();await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const operational=async<T>(fn:()=>Promise<T>)=>{vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');try{return await fn();}finally{vi.unstubAllEnvs();}};
const requestEdd=(c:{caseId:string;roundId:string},edd:string)=>db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC_REVIEW',$4)",
 [c.caseId,c.roundId,JSON.stringify({pregnancyType:'Singleton',edd,collectionDate:'2026-10-09'}),u.staff.id]);

it('OD-R2 interim (Rev 3.4 §11A fix 8): operational mode refuses an S3+ redraw that HIS PET could never receive; S2 ordering is unchanged',async()=>{
 const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c));
 const s2=await operational(()=>run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'})));
 expect(s2.newRoundNumber).toBe(2);
 // Operational S2 receipt is the new HIS PET only; the local receive path stays closed.
 await expect(operational(()=>run(t=>intake.receiveRedraw(t,u.staff,{roundId:s2.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'})))).rejects.toMatchObject({code:'REDRAW_REQUIRES_NEW_HIS_PET'});
 await run(t=>intake.receiveRedraw(t,u.staff,{roundId:s2.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'})); // synthetic stand-in for the S2 PET
 await expect(operational(()=>run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง ขอเจาะครั้งที่สาม'})))).rejects.toMatchObject({code:'REDRAW_BEYOND_S2_PENDING_OD_R2',status:409});
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM specimen_round WHERE case_id=$1',[c.caseId])).rows[0].n).toBe(2);
 expect((await db.query<{state:string}>('SELECT state FROM specimen_round WHERE id=$1',[s2.newRoundId])).rows[0].state).toBe('ReceivedInNIPT'); // nothing changed
});

it('GA ≥ 22+0 is a warning only: shown on the worklist and slot, never changes gate, FIFO or the override rule',async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 // receiveS1 records HIS collection 2026-10-10. EDD +126 d → 154 d = 22+0; EDD +127 d → 153 d = 21+6.
 const older=await run(t=>syntheticCase(t,u)),newer=await run(t=>syntheticCase(t,u)),none=await run(t=>syntheticCase(t,u));
 await run(t=>receiveS1(t,older,new Date(Date.now()-2*3600000)));await run(t=>receiveS1(t,newer,new Date(Date.now()-3600000)));await run(t=>receiveS1(t,none,new Date()));
 const before=(await run(t=>intake.labWorklist(t,u.staff))).attempts.map(a=>[a.roundId,a.category]);
 await requestEdd(older,'2027-02-14');await requestEdd(newer,'2027-02-13');
 const w=await run(t=>intake.labWorklist(t,u.staff)),by=(id:string)=>w.attempts.find(a=>a.roundId===id)!;
 expect(by(older.roundId).ga).toEqual({days:153,weeks:21,remainder:6,warning:false,collectionBasis:'HIS_RECEIPT'});
 expect(by(newer.roundId).ga).toEqual({days:154,weeks:22,remainder:0,warning:true,collectionBasis:'HIS_RECEIPT'});
 expect(by(none.roundId).ga).toBeNull(); // no EDD → unknown, not a warning
 expect(w.attempts.map(a=>[a.roundId,a.category])).toEqual(before); // same order and same gate outcome
 // Overtaking still needs a reason with or without the GA warning; the FIFO head needs none.
 const b=await run(t=>batch.createBatch(t,u.staff));const newerAttempt=await attemptOf(q(),newer.roundId);
 expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[newerAttempt.id]}))).toEqual({overtaken:1,reasonRequired:true});
 const placed=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[newerAttempt.id],queueOverrideReason:'จำลอง ผู้ใช้เลือกแทรกคิว'}));
 const slot=(await run(t=>batch.batchDetail(t,u.staff,b.batchId))).slots.find(s=>s.slot===placed.placed[0].slot)!;
 expect(slot.assignment?.ga).toMatchObject({weeks:22,remainder:0,warning:true});
});

it('gestationalAge boundary and sources',()=>{
 expect(GA_WARNING_DAYS).toBe(154);
 expect(gestationalAge({ga_edd:'2027-02-13',ga_request_collection:'2026-10-10',round_collection_date:null})).toMatchObject({days:154,warning:true,collectionBasis:'REQUEST'});
 expect(gestationalAge({ga_edd:'2027-02-14',ga_request_collection:'2026-10-10',round_collection_date:null})?.warning).toBe(false);
 expect(gestationalAge({ga_edd:null,ga_request_collection:'2026-10-10',round_collection_date:'2026-10-10'})).toBeNull();
 expect(gestationalAge({ga_edd:'2027-02-13',ga_request_collection:null,round_collection_date:null})).toBeNull();
 expect(gestationalAge({ga_edd:'2030-01-01',ga_request_collection:'2026-10-10',round_collection_date:null})).toBeNull(); // implausible (<0) → unknown
});
