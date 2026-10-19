import {it,expect} from 'vitest';
import {resultFixture,receivedCase,importReport,rowVersion} from '../helpers/results';
import {emptyRequest,paperSchema} from '../../packages/p2/schema';
import {proposeLink,decideLink} from '../../packages/results/service';
it('Paper result linkage uses recorded DOB/EDD of the current round and never falls back to an obsolete Electronic request',async()=>{
 const f=await resultFixture();try{
  const c=await receivedCase(f,{fetalSex:'Want'});
  await f.db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Paper','Paper',$4)",[c.roundId,c.caseId,emptyRequest,f.u.staff.id]);
  const imported=await importReport(f,{kind:'SINGLETON',labNumber:c.labNumber,hn:c.hn,collection:'10-Oct-2026'});
  const propose=()=>f.run(async t=>proposeLink(t,f.u.staff,{versionId:imported.versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC_PAPER_SOURCE_TEST',expectedRowVersion:(await rowVersion(f,imported.versionId)).row_version}));
  const missing=await propose();expect(missing.cross.dob).toBe('NOT_AVAILABLE');expect(missing.cross.gestationalAge).toBe('NOT_AVAILABLE');
  await f.run(async t=>decideLink(t,f.u.certifier,{versionId:imported.versionId,decision:'REJECT',reason:'SYNTHETIC_MISSING_PAPER_DATES',expectedRowVersion:(await rowVersion(f,imported.versionId)).row_version}));
  const panel=paperSchema.parse({...Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])),requestComplete:'Complete',pregnancyType:'Singleton',fetalSex:'Want',dob:'1996-03-31',edd:'2027-04-22',collectionDate:c.collection});
  await f.db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-PAPER-DATES',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC_REVIEW',$4)",[c.caseId,c.roundId,panel,f.u.staff.id]);
  const actual=await propose();expect(actual.cross).toMatchObject({hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH'});
  expect(paperSchema.safeParse({...panel,dob:'1996-02-31'}).success).toBe(false);
 }finally{await f.close();}
},120000);
