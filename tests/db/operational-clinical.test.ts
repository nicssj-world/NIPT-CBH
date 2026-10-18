import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {registerP2,paperReview,approveClinicalP2,setModes,getCase,type Staff} from '../../packages/p2/service';
import {paperSchema} from '../../packages/p2/schema';
let db:PGlite,lab:Staff,cert:Staff,reviewer:Staff,unit:string,caseId:string;
beforeAll(async()=>{db=await testDatabase();lab=await addUser(db,'LAB_STAFF','clinical.lab');reviewer=await addUser(db,'CLINICAL_APPROVER','clinical.reviewer');reviewer.roles=['CLINICAL_APPROVER','LAB_STAFF'];cert=await addUser(db,'LAB_CERTIFIER','clinical.cert');unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('CLINICAL-TEST','หน่วยทดสอบ') RETURNING id")).rows[0].id;await db.query("UPDATE nipt_runtime_config SET mode='operational'");});
afterAll(async()=>db.close());afterEach(()=>vi.unstubAllEnvs());
function mode(){vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.hospital.invalid');}
const requestPanel=()=>{const panel=paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));Object.assign(panel,{requestComplete:'Complete',history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',vanishingTwin:'None',pregnancyType:'Singleton',fetalSex:'DoNotWant',collectionDate:'2026-08-01'});return panel;};
const review={expectedVersion:0,reason:'ทบทวนข้อมูลจากต้นฉบับแล้ว',sourceReference:'เอกสารแนวทางทดสอบ',attestation:true};
it('requires a current verified Request; a Paper Consent marker proceeds without any paper consent review',async()=>{
 mode();const c=await registerP2(db,lab,{ln:'261014009999',hn:'TEST-HN-01',unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'CLINICAL-REVIEW-TEST'},Buffer.alloc(32,8));caseId=c.caseId!;
 await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('VERIFIED_REQUEST_REQUIRED');
 await paperReview(db,cert,caseId,{kind:'REQUEST',templateVersion:'CBH-FM01-v1',documentReference:'REQ-TEST',panel:requestPanel(),location:'ห้องทดสอบ',reason:'ตรวจเอกสารทดสอบ',operation:'Review',previousId:null});
 const round=(await getCase(db,reviewer,caseId)).case.current_round_id;
 // A LAB_DIRECT case does NOT start with the Paper Consent marker: nobody has selected it yet, so the consent gate stays closed.
 expect((await getCase(db,reviewer,caseId)).workspace).toMatchObject({request_mode:'Paper',consent_mode:'Electronic'});
 expect((await db.query('SELECT p2_clinical_documents_ready($1) AS ready',[round])).rows[0]).toEqual({ready:false});
 await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('CURRENT_GRANTED_CONSENT_REQUIRED');
 await setModes(db,lab,caseId,{expectedVersion:0,requestMode:'Paper',consentMode:'Paper',reason:'ANC/Lab เลือกใช้ Paper Consent'});
 // Owner 2026-10-18: the marker alone (consent_mode='Paper') is enough; no print, upload, receipt or verification of the consent paper.
 expect((await getCase(db,reviewer,caseId)).workspace.consent_mode).toBe('Paper');
 expect((await db.query("SELECT count(*)::int n FROM p2_paper_review WHERE round_id=$1 AND kind='CONSENT'",[round])).rows[0]).toEqual({n:0});
 expect((await db.query('SELECT p2_clinical_documents_ready($1) AS ready',[round])).rows[0]).toEqual({ready:true});
 const current={...review,expectedVersion:(await getCase(db,reviewer,caseId)).workspace.version};
 await expect(approveClinicalP2(db,lab,caseId,current)).rejects.toThrow('FORBIDDEN');
 const approved=await approveClinicalP2(db,reviewer,caseId,current);expect(approved).toMatchObject({passed:true,state:'ClinicalPassed',reviewerId:reviewer.id});expect((await db.query('SELECT p2_clinical_ready($1) AS ready',[round])).rows[0]).toEqual({ready:true});expect((await getCase(db,reviewer,caseId)).gate.passed).toBe(true);
 // The marker is not signing evidence: nothing about a signature or consent decision was created.
 expect((await db.query("SELECT (SELECT count(*) FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=$1)::int sig,(SELECT count(*) FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1)::int fin",[caseId])).rows[0]).toEqual({sig:0,fin:0});
 await setModes(db,lab,caseId,{expectedVersion:current.expectedVersion,requestMode:'Paper',consentMode:'Paper',reason:'ทดสอบเปลี่ยนรุ่นข้อมูล'});expect((await getCase(db,reviewer,caseId)).gate.passed).toBe(false);
});
it('a recorded paper refusal or a withdrawal still stops a Paper Consent round; Digital Consent still needs the signed consent',async()=>{
 mode();const c=await registerP2(db,lab,{ln:'261014009998',hn:'TEST-HN-02',unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'CLINICAL-REVIEW-DECLINED'},Buffer.alloc(32,8));const id=c.caseId!;
 await paperReview(db,cert,id,{kind:'REQUEST',templateVersion:'CBH-FM01-v1',documentReference:'REQ-TEST-2',panel:requestPanel(),location:'ห้องทดสอบ',reason:'ตรวจเอกสารทดสอบ',operation:'Review',previousId:null});
 const round=(await getCase(db,reviewer,id)).case.current_round_id;
 await setModes(db,lab,id,{expectedVersion:0,requestMode:'Paper',consentMode:'Paper',reason:'เลือกใช้ Paper Consent'});
 const consent=paperSchema.parse(Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])));Object.assign(consent,{decision:'Declined',signatures:'Complete',representative:'NotRequired'});
 await paperReview(db,cert,id,{kind:'CONSENT',templateVersion:'CBH-FM02-v1',documentReference:'CONSENT-DECLINED',panel:consent,location:'ห้องทดสอบ',reason:'บันทึกการไม่ยินยอม',operation:'Review',previousId:null});
 expect((await db.query('SELECT p2_clinical_documents_ready($1) AS ready',[round])).rows[0]).toEqual({ready:false});
 await expect(approveClinicalP2(db,reviewer,id,{...review,expectedVersion:(await getCase(db,reviewer,id)).workspace.version})).rejects.toThrow('CONSENT_DECLINED');
 const v=(await getCase(db,reviewer,id)).workspace.version;
 await setModes(db,lab,id,{expectedVersion:v,requestMode:'Paper',consentMode:'Electronic',reason:'ทดสอบช่องทางอิเล็กทรอนิกส์'});
 expect((await db.query('SELECT p2_clinical_documents_ready($1) AS ready',[round])).rows[0]).toEqual({ready:false});
 await expect(approveClinicalP2(db,reviewer,id,{...review,expectedVersion:v+1})).rejects.toThrow('CURRENT_GRANTED_CONSENT_REQUIRED');
});
it('rejects forged source hashes at SQL boundary and synthetic runtime approval',async()=>{
 mode();const round=(await getCase(db,reviewer,caseId)).case.current_round_id;
 await expect(db.query("INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,'CBH-AUTHORIZED-REVIEW-v1',p2_clinical_source($2),$3)",[caseId,round,{state:'ClinicalPassed',passed:true,authority:'AUTHORIZED_CLINICAL_REVIEW',reviewerId:reviewer.id,sourceHash:'a'.repeat(64)}])).rejects.toThrow('AUTHORIZED_CURRENT_CLINICAL_REVIEW_REQUIRED');
 vi.stubEnv('NIPT_MODE','synthetic');await expect(approveClinicalP2(db,reviewer,caseId,review)).rejects.toThrow('OPERATIONAL_MODE_REQUIRED');
});
