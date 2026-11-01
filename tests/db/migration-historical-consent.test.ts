import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createHash} from 'node:crypto';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {authenticate,readSession} from '../../packages/security/session';
import {registerP2,saveRequest,prepareConsent,setModes,refusePaperConsent,getCase,type Staff} from '../../packages/p2/service';
import {emptyRequest} from '../../packages/p2/schema';
import {factsSql} from '../../packages/anc/service';

// Owner 2026-10-27: a migrated Historical case whose result was already issued is never put through request/consent preparation again, and no
// request revision, consent or signature is created retroactively. Cases still in progress and new ANC registrations keep the ordinary rules.
const key=Buffer.alloc(32,7),NO_RETROACTIVE='HISTORICAL_RESULT_READY_NO_RETROACTIVE_DOCUMENTS';
let db:PGlite,anc:Staff,unit:string,execution:string;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
async function register(n:number){return (await tx(()=>registerP2(db,anc,{ln:`00990003${String(n).padStart(4,'0')}`,hn:`009900030${n}`,unitId:unit,origin:'ANC',idempotencyKey:`SYNTHETIC_HISTORICAL_${n}`},key))).caseId!;}
async function mark(caseId:string,classification:string,n:number){
 await db.query("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,'IMPORTED')",[execution,'historical-'+n,n+1,`00990003${String(n).padStart(4,'0')}`,`26B2610140${String(n).padStart(2,'0')}`,classification,caseId]);
}
const documents=async(caseId:string)=>(await db.query<{n:number}>("SELECT (SELECT count(*) FROM p2_document_revision WHERE case_id=$1)::int+(SELECT count(*) FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=$1)::int n",[caseId])).rows[0].n;
beforeAll(async()=>{
 db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc');
 unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC','จำลอง') RETURNING id")).rows[0].id;anc.unitIds=[unit];
 await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[anc.id,unit]);
 const auth=await tx(()=>authenticate(db,'synthetic.anc',TEST_PASSWORD));anc={...anc,sessionId:(await readSession(db,auth!.token))!.sessionId};
 execution=(await db.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by) VALUES($1,'{}',$2) RETURNING id",[createHash('sha256').update('historical-consent').digest('hex'),anc.id])).rows[0].id;
},120000);
afterAll(async()=>{await db?.close();});
it('flags a result-ready historical case and refuses every retroactive request/consent action without creating evidence',async()=>{
 const ready=await register(1);await mark(ready,'QUALIFIED_PDF_PENDING',1);
 const view=await tx(()=>getCase(db,anc,ready));expect(view.historicalMigration).toEqual({resultReady:true});
 const version=view.workspace.version;
 const before=await documents(ready);
 const attempts:Array<[string,()=>Promise<unknown>]>=[
  ['electronic consent',()=>prepareConsent(db,anc,ready,{doctorVersionId:'00000000-0000-4000-8000-000000000001',representativeRequired:false})],
  ['paper consent / mode change',()=>setModes(db,anc,ready,{expectedVersion:version,requestMode:'Paper',consentMode:'Paper',reason:'SYNTHETIC mode'})],
  ['consent refusal',()=>refusePaperConsent(db,anc,ready,{expectedVersion:version,reason:'SYNTHETIC refusal'})],
  ['request draft',()=>saveRequest(db,anc,ready,{expectedVersion:version,draft:emptyRequest,saveMode:'Manual'})]];
 for(const [label,run] of attempts)await expect(tx(run),label).rejects.toMatchObject({code:NO_RETROACTIVE,status:409});
 expect(await documents(ready)).toBe(before);
 expect((await db.query("SELECT 1 FROM p2_paper_review WHERE case_id=$1 AND kind='CONSENT'",[ready])).rows).toHaveLength(0);
 // The migration classification is the only thing that changes behaviour: the same state is also reported for released/review classes.
 for(const [n,classification] of [[2,'PDF_REVIEW'],[3,'CERTIFIED_RELEASED']] as const){const id=await register(n);await mark(id,classification,n);expect((await tx(()=>getCase(db,anc,id))).historicalMigration).toEqual({resultReady:true});}
});
it('an in-progress migrated case and a new ANC registration keep the ordinary request/consent workflow',async()=>{
 const progress=await register(4),fresh=await register(5);await mark(progress,'NO_HALOS',4);
 for(const id of [progress,fresh]){
  const view=await tx(()=>getCase(db,anc,id));expect(view.historicalMigration).toEqual({resultReady:false});
  const out=await tx(()=>setModes(db,anc,id,{expectedVersion:view.workspace.version,requestMode:'Electronic',consentMode:'Paper',reason:'SYNTHETIC ANC selected paper consent'}));expect(out).toBeTruthy();
 }
});
it('the ANC queue raises no missing-documents flag for result-ready historical cases only',async()=>{
 const ready=await register(6),progress=await register(7),fresh=await register(8);await mark(ready,'QUALIFIED_PDF_PENDING',6);await mark(progress,'NO_HALOS',7);
 const rows=(await db.query<{id:string;documentsReady:boolean}>(factsSql,[[unit]])).rows,by=(id:string)=>rows.find(r=>r.id===id)?.documentsReady;
 expect(by(ready)).toBe(true);expect(by(progress)).toBe(false);expect(by(fresh)).toBe(false);
});
