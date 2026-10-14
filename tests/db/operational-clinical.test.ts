import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {registerP2,paperReview,approveClinicalP2,setModes,getCase,type Staff} from '../../packages/p2/service';
import {paperSchema} from '../../packages/p2/schema';
let db:PGlite,lab:Staff,cert:Staff,reviewer:Staff,unit:string,caseId:string;
beforeAll(async()=>{db=await testDatabase();lab=await addUser(db,'LAB_STAFF','clinical.lab');reviewer=await addUser(db,'CLINICAL_APPROVER','clinical.reviewer');reviewer.roles=['CLINICAL_APPROVER','LAB_STAFF'];cert=await addUser(db,'LAB_CERTIFIER','clinical.cert');unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('CLINICAL-TEST','หน่วยทดสอบ') RETURNING id")).rows[0].id;await db.query("UPDATE nipt_runtime_config SET mode='operational'");});
afterAll(async()=>db.close());afterEach(()=>vi.unstubAllEnvs());
function mode(){vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.hospital.invalid');}
const review={expectedVersion:0,reason:'ทบทวนข้อมูลจากต้นฉบับแล้ว',sourceReference:'เอกสารแนวทางทดสอบ',attestation:true};
it('requires current verified Request and granted Consent before authorized positive review',async()=>{
 mode();const c=await registerP2(db,lab,{ln:'261014009999',hn:'TEST-HN-01',unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'CLINICAL-REVIEW-TEST'},Buffer.alloc(32,8));caseId=c.caseId!;
 await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('VERIFIED_REQUEST_REQUIRED');
 const panel=paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));Object.assign(panel,{requestComplete:'Complete',history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',vanishingTwin:'None',pregnancyType:'Singleton',fetalSex:'DoNotWant',collectionDate:'2026-08-01'});
 await paperReview(db,cert,caseId,{kind:'REQUEST',templateVersion:'CBH-FM01-v1',documentReference:'REQ-TEST',panel,location:'ห้องทดสอบ',reason:'ตรวจเอกสารทดสอบ',operation:'Review',previousId:null});
 await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('CURRENT_GRANTED_CONSENT_REQUIRED');
 const consent=paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));Object.assign(consent,{decision:'Granted',signatures:'Complete',representative:'NotRequired'});await paperReview(db,cert,caseId,{kind:'CONSENT',templateVersion:'CBH-FM02-v1',documentReference:'CONSENT-TEST',panel:consent,location:'ห้องทดสอบ',reason:'ตรวจเอกสารทดสอบ',operation:'Review',previousId:null});
 await expect(approveClinicalP2(db,lab,caseId,review)).rejects.toThrow('FORBIDDEN');
 const approved=await approveClinicalP2(db,reviewer,caseId,review);expect(approved).toMatchObject({passed:true,state:'ClinicalPassed',reviewerId:reviewer.id});expect((await db.query('SELECT p2_clinical_ready($1) AS ready',[(await getCase(db,reviewer,caseId)).case.current_round_id])).rows[0]).toEqual({ready:true});expect((await getCase(db,reviewer,caseId)).gate.passed).toBe(true);
 await setModes(db,lab,caseId,{expectedVersion:0,requestMode:'Paper',consentMode:'Paper',reason:'ทดสอบเปลี่ยนรุ่นข้อมูล'});expect((await getCase(db,reviewer,caseId)).gate.passed).toBe(false);
});
it('rejects forged source hashes at SQL boundary and synthetic runtime approval',async()=>{
 mode();const round=(await getCase(db,reviewer,caseId)).case.current_round_id;
 await expect(db.query("INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,'CBH-AUTHORIZED-REVIEW-v1',p2_clinical_source($2),$3)",[caseId,round,{state:'ClinicalPassed',passed:true,authority:'AUTHORIZED_CLINICAL_REVIEW',reviewerId:reviewer.id,sourceHash:'a'.repeat(64)}])).rejects.toThrow('AUTHORIZED_CURRENT_CLINICAL_REVIEW_REQUIRED');
 vi.stubEnv('NIPT_MODE','synthetic');await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('OPERATIONAL_MODE_REQUIRED');
});
