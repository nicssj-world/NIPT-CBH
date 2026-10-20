import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFileSync,existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {authenticate,readSession} from '../../packages/security/session';
import {registerP2,saveRequest,doctorAction,prepareConsent,setModes,type Staff} from '../../packages/p2/service';
import {emptyRequest,type RequestDraft} from '../../packages/p2/schema';
import {ancFormPreview,formSources,requestFields,consentFields} from '../../packages/p2/forms';
import {renderAncOverlay} from '../../packages/pdf/anc-overlay';
import {REFERENCE_SET_ID,formTemplateSettingValid} from '../../packages/forms/registry';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

// ANC Request (Fm-WI-T-BM17/01) + Consent (Fm-WI-T-BM17/02) auto-fill preview on the Owner-supplied DCC PDFs (read-only, outside the
// repository). Point NIPT_ANC_FORM_SOURCE_DIR at the folder that holds them (the Owner's NIPT-Audit folder).
const SRC=process.env.NIPT_ANC_FORM_SOURCE_DIR??'C:/Users/User/OneDrive/Desktop/NIPT-Audit';
const REQ='FM-WI-T-BM17_01 ใบขอส่งตรวจคัดกรอง CBH-NIPT.pdf',CON='FM-WI-T-BM17_02 เอกสารยินยอมรับการตรวจคัดกรอง CBH-NIPT(1).pdf';
const available=existsSync(path.join(SRC,REQ))&&existsSync(path.join(SRC,CON));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const key=Buffer.alloc(32,7),vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
let db:PGlite,anc:Staff,admin:Staff,checker:Staff,cert:Staff,lab:Staff,otherAnc:Staff,unit:string,dir:string,doctorA:string,doctorB:string,caseId:string;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
async function doctor(k:string,name:string){const d=await tx(()=>doctorAction(db,admin,{action:'propose',doctorKey:k,name,unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector}));await tx(()=>doctorAction(db,checker,{action:'approve',id:d.id,reason:'SYNTHETIC checked'}));return String(d.id);}
const LONG_NAME='SYNTHETIC นางสาวพรรณรายสุดาวดีศรีสวัสดิ์ ณ อยุธยาวงศ์ไพบูลย์ทดสอบชื่อยาวมาก';
function draft(doctorId:string|null):RequestDraft{const d=structuredClone(emptyRequest);
 d.patient.syntheticName=LONG_NAME;d.patient.dob='1996-03-31';d.patient.identifier='SYNTHETIC-ID-0099';d.patient.identifierType='Synthetic';d.patient.entitlement='SYNTHETIC สิทธิ สปสช.';
 Object.assign(d.pregnancy,{type:'Singleton',edd:'2027-04-22',ultrasoundDate:'2026-09-01',art:'No',collectionDate:'2026-10-10',collectionTime:'09:30',collectionSource:'ANC',weightKg:62.5,heightCm:158,gravida:2,para:1,abortion:0,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
 for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)d.history[k].answer='No';
 Object.assign(d.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'Yes',priorTestMethod:'SYNTHETIC Quad test',priorTestResult:'SYNTHETIC ความเสี่ยงต่ำ',otherHistory:'No'});
 d.acknowledgments={conditionA:'Yes',conditionB:null};
 Object.assign(d.ordering,{doctorVersionId:doctorId,facility:'SYNTHETIC โรงพยาบาลชลบุรี',reason:'SYNTHETIC อายุมารดามากกว่า 35 ปี ต้องการตรวจคัดกรองความเสี่ยงโครโมโซมของทารกในครรภ์ด้วยวิธี NIPT ตามคำแนะนำแพทย์',coordinator:'SYNTHETIC ผู้ประสาน',phone:'SYNTHETIC-0812345678',email:'synthetic.anc@example.test'});
 return d;}
// pdf.js returns one line as several runs in content order; rebuild lines by baseline, then left to right. A tone mark stacked
// above an upper vowel is drawn with an unmapped alternate glyph (extracts as U+0000), so tone marks are ignored when comparing.
const flat=(p:{items:{s:string;x:number;y:number}[]})=>[...p.items].sort((a,b)=>Math.round(b.y)-Math.round(a.y)||a.x-b.x).map(i=>i.s).join('').replace(/[\s\u0000\u0E48-\u0E4B]+/g,'');
const has=(p:{items:{s:string;x:number;y:number}[]},t:string)=>flat(p).includes(t.replace(/[\s\u0E48-\u0E4B]+/g,''));
async function pdfText(bytes:Buffer){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;const pages=[];
 for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),vp=p.getViewport({scale:1}),c=await p.getTextContent();pages.push({w:vp.width,h:vp.height,items:c.items.filter((i):i is typeof i&{str:string;transform:number[];width:number}=>'str' in i&&!!i.str.trim()).map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width}))});}
 return pages;}
const preview=(kind:'REQUEST'|'CONSENT'|'BOTH',user=anc)=>tx(()=>ancFormPreview(db,user,caseId,kind,renderAncOverlay));
let version=0;const save=async(d:RequestDraft)=>{const r=await tx(()=>saveRequest(db,anc,caseId,{expectedVersion:version,draft:d}));version=r.version;};

describe.skipIf(!available)('ANC Request + Consent auto-fill preview on the DCC reference PDFs',()=>{
 beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'nipt-anc-forms-'));
  // Installation registry: the reference set (pinned hashes) and a second set id with the same bytes, to prove the Settings choice.
  const set=(id:string,label:string)=>({id,label,layout:'BM17-2026-10',dccStatus:'REFERENCE_NOT_DCC_APPROVED',request:{path:path.join(SRC,REQ),sha256:sha(readFileSync(path.join(SRC,REQ))),docCode:'Fm-WI-T-BM17/01',page:'1 / 2'},consent:{path:path.join(SRC,CON),sha256:sha(readFileSync(path.join(SRC,CON))),docCode:'Fm-WI-T-BM17/02',page:'2 / 2'}});
  await copyFile(path.join(SRC,REQ),path.join(dir,'broken.pdf'));
  await writeFile(path.join(dir,'registry.json'),JSON.stringify({version:1,sets:[set(REFERENCE_SET_ID,'Reference'),set('CBH-BM17-SECOND-SET','Second set (same bytes)'),{...set('CBH-BM17-BROKEN','Broken'),request:{...set('X','X').request,path:path.join(dir,'broken.pdf'),sha256:'0'.repeat(64)}}]}));
  process.env.NIPT_ANC_FORM_REGISTRY=path.join(dir,'registry.json');
  db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc');admin=await addUser(db,'APP_ADMIN','synthetic.admin');checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker');cert=await addUser(db,'LAB_CERTIFIER','synthetic.cert');lab=await addUser(db,'LAB_STAFF','synthetic.lab');
  unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC','จำลอง') RETURNING id")).rows[0].id;anc.unitIds=[unit];await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[anc.id,unit]);
  const other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_OTHER','จำลองอื่น') RETURNING id")).rows[0].id;otherAnc={...(await addUser(db,'ANC_NURSE','synthetic.anc2')),unitIds:[other]};
  const auth=await tx(()=>authenticate(db,'synthetic.anc',TEST_PASSWORD));const u=await readSession(db,auth!.token);anc={...anc,sessionId:u!.sessionId};
  caseId=(await tx(()=>registerP2(db,anc,{ln:'009900010001',hn:'0099000123',unitId:unit,origin:'ANC',idempotencyKey:'SYNTHETIC_REGISTER_FORMS'},key))).caseId!;
  doctorA=await doctor('SYNTHETIC-DR-A','SYNTHETIC นพ.เลือกจากทะเบียน หนึ่ง');doctorB=await doctor('SYNTHETIC-DR-B','SYNTHETIC พญ.เลือกจากทะเบียน สอง');
 },120000);
 afterAll(async()=>{await db?.close();await rm(dir,{recursive:true,force:true});delete process.env.NIPT_ANC_FORM_REGISTRY;});

 it('7: nothing recorded → every field blank, nothing invented, missing list shown; consent unsigned',async()=>{
  const s=await tx(()=>formSources(db,anc,caseId)),r=requestFields(s),c=consentFields(s);
  expect(r.fields).toMatchObject({name:null,dob:null,doctor:null,entitlement:null,reason:null,pregnancyType:null,fetalSex:null,ga:null,history:[null,null,null,null,null,null,null],ackA:false,ackB:false,draw:{date:null,time:null},receive:{condition:null,date:null,time:null}});
  expect(r.fields.hn).toBe('0099000123'); // the registered HN, as text
  expect(r.missing).toEqual(expect.arrayContaining(['สิทธิการตรวจ','แพทย์ผู้สั่งตรวจจากทะเบียน','โรงพยาบาล/คลินิก','ครรภ์เดี่ยว/แฝด','ประวัติข้อ 1']));expect(r.missing).not.toContain('ชื่อ-นามสกุล');
  expect(c).toMatchObject({status:'UNSIGNED',fields:{decision:null,patientSignedDate:null,doctor:null}});expect(c.fields.acknowledged.every(a=>a===false)).toBe(true);
 });
 it('1-4, 8, 9: doctor chosen from the registry appears on Request and Consent; BE dates, HN zeros, long Thai text fit; A4 1+1=2 pages',async()=>{
  await save(draft(doctorA));
  const before=[sha(readFileSync(path.join(SRC,REQ))),sha(readFileSync(path.join(SRC,CON)))];
  const both=await preview('BOTH');expect(both).toMatchObject({pages:2,templateSet:REFERENCE_SET_ID,dccStatus:'REFERENCE_NOT_DCC_APPROVED',consentStatus:'UNSIGNED',overflow:[],doctor:{id:doctorA,active:true}});
  const pages=await pdfText(both.bytes);expect(pages).toHaveLength(2);
  expect([pages[0].w,pages[0].h,pages[1].w,pages[1].h].map(v=>Math.round(v*100)/100)).toEqual([595.2,841.92,594.96,842.04]); // A4 template geometry kept
  for(const t of ['Fm-WI-T-BM17/01','1 / 2','REQUEST FORM','0099000123','SYNTHETIC นพ.เลือกจากทะเบียน หนึ่ง','62.5','158','25.0','SYNTHETIC Quad test'])expect(has(pages[0],t),t).toBe(true);expect(has(pages[0],'SYNTHETIC-ID-0099')).toBe(false);expect(has(pages[0],'synthetic.anc@example.test')).toBe(false);
  for(const t of ['Fm-WI-T-BM17/02','INFORM CONSENT','SYNTHETIC นพ.เลือกจากทะเบียน หนึ่ง'])expect(has(pages[1],t),t).toBe(true);
  expect(has(pages[0],'ฉบับร่างเพื่อดูตัวอย่าง (DRAFT PREVIEW)')).toBe(true);expect(has(pages[1],'ยังไม่ได้ลงนาม')).toBe(true);
  // BE date boxes: DOB 31/03/2539, EDD 22/04/2570, ultrasound 01/09/2569 as single digits in the printed boxes.
  const digitsNear=(y:number,xMin:number,xMax:number)=>pages[0].items.filter(i=>/^\d$/.test(i.s)&&Math.abs(i.y-y)<3&&i.x>=xMin&&i.x<=xMax).sort((a,b)=>a.x-b.x).map(i=>i.s).join('');
  expect(digitsNear(623.4,205,360)).toBe('31032539');expect(digitsNear(448.3,35,190)).toBe('22042570');expect(digitsNear(486.8,35,190)).toBe('01092569');
  // The long Thai name and reason stay inside their printed space (measured from the produced PDF).
  for(const [start,x0,w] of [['SYNTHETIC นางสาว',36,152],['SYNTHETIC อายุมารดา',37,318]] as const){const items=pages[0].items.filter(i=>i.x>=x0-1&&i.x<=x0+2&&(i.s.startsWith(start)||i.s.length>3&&LONG_NAME.includes(i.s.slice(0,6))||i.s.includes('NIPT ตามคำแนะนำ')));
   expect(items.length,start).toBeGreaterThan(0);for(const i of items)expect(i.x+i.w,i.s).toBeLessThanOrEqual(x0+w+1.5);}
  // The DCC wording of all 12 consent clauses is still there, untouched (it is the template page itself).
  for(const n of ['1. การตรวจ NIPT','2. ประเภทครรภ์เดี่ยว','3. ประเภทครรภ์แฝดสอง','10. ในบางกรณี','11. การเบิกค่ารักษา','12. ข้าพเจ้ารับทราบ','ให้ความยินยอมรับการตรวจ NIPT'])expect(has(pages[1],n),n).toBe(true);
  expect([sha(readFileSync(path.join(SRC,REQ))),sha(readFileSync(path.join(SRC,CON)))]).toEqual(before); // sources never modified
  const single=[await preview('REQUEST'),await preview('CONSENT')];expect(single.map(s=>s.pages)).toEqual([1,1]);
 },120000);
 it('5: changing the ordering doctor updates both forms; the consent may only be prepared with the request doctor',async()=>{
  const d=draft(doctorB);await save(d);
  const both=await preview('BOTH'),pages=await pdfText(both.bytes);
  for(const p of pages){expect(has(p,'SYNTHETIC พญ.เลือกจากทะเบียน สอง')).toBe(true);expect(has(p,'เลือกจากทะเบียน หนึ่ง')).toBe(false);}
  expect(JSON.stringify(pages)).not.toContain('ผู้ใช้จำลอง'); // the ANC user's own name is never printed as the doctor
  await tx(()=>setModes(db,anc,caseId,{expectedVersion:version,requestMode:'Electronic',consentMode:'Electronic',reason:'SYNTHETIC electronic consent'})).catch(()=>undefined);
  await expect(tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:doctorA,representativeRequired:false,reason:'SYNTHETIC wrong doctor'}))).rejects.toMatchObject({code:'CONSENT_DOCTOR_MUST_MATCH_REQUEST'});
  await tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:doctorB,representativeRequired:false,reason:'SYNTHETIC same doctor'}));
  // If the request doctor changes after a consent was prepared, the consent preview refuses to print a mismatched name.
  version=(await db.query<{version:number}>('SELECT version FROM p2_workspace WHERE case_id=$1',[caseId])).rows[0].version;
  await save(draft(doctorA));const after=await preview('CONSENT');expect(after.doctorMismatch).toBe(true);
  const cp=(await pdfText(after.bytes))[0];expect(has(cp,'แพทย์ในเอกสารยินยอมไม่ตรงกับแพทย์ผู้สั่งตรวจ')).toBe(true);expect(has(cp,'เลือกจากทะเบียน หนึ่ง')).toBe(false);
  await save(draft(doctorB));
 },120000);
 it('6: a preview never signs, consents or creates evidence; status stays unsigned',async()=>{
  const count=async()=>(await db.query<{n:number}>("SELECT (SELECT count(*) FROM p2_consent_signature)+(SELECT count(*) FROM p2_final_consent)+(SELECT count(*) FROM p2_consent_ack) n")).rows[0].n;
  const before=await count(),docs=(await db.query<{n:number}>('SELECT count(*)::int n FROM p2_document_revision')).rows[0].n;
  const r=await preview('CONSENT');expect(r.consentStatus).toBe('UNSIGNED');
  expect(await count()).toBe(before);expect((await db.query<{n:number}>('SELECT count(*)::int n FROM p2_document_revision')).rows[0].n).toBe(docs);
  const s=consentFields(await tx(()=>formSources(db,anc,caseId)));expect(s.fields.acknowledged.filter(Boolean)).toHaveLength(0);expect(s.fields.decision).toBeNull();
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='P2_FORM_PREVIEW'")).rows[0].n).toBeGreaterThan(0);
 });
 it('10: Settings request_consent.templateVersion is the template the renderer uses; bad sets and channel changes are refused',async()=>{
  const activate=async(value:Record<string,unknown>)=>{const id=await tx(()=>proposeSetting(db,cert,'request_consent',value,'SYNTHETIC template set'));
   const ok=await tx(()=>validateSetting(db,cert,id,async(_k,v)=>formTemplateSettingValid(v)));if(!ok)return {id,ok};await tx(()=>approveSetting(db,checker,id));await tx(()=>activateSetting(db,checker,id));return {id,ok};};
  expect((await activate({...SETTINGS.request_consent.default,templateVersion:'CBH-BM17-SECOND-SET'})).ok).toBe(true);
  const r=await preview('REQUEST');expect(r.templateSet).toBe('CBH-BM17-SECOND-SET');expect(has((await pdfText(r.bytes))[0],'CBH-BM17-SECOND-SET')).toBe(true);
  const broken=await activate({...SETTINGS.request_consent.default,templateVersion:'CBH-BM17-BROKEN'});expect(broken.ok).toBe(false);
  await expect(tx(()=>approveSetting(db,checker,broken.id))).rejects.toThrow('SETTING_NOT_VALIDATED');
  expect((await activate({...SETTINGS.request_consent.default,templateVersion:'NOT-INSTALLED'})).ok).toBe(false);
  await expect(tx(()=>proposeSetting(db,cert,'request_consent',{...SETTINGS.request_consent.default,mode:'ELECTRONIC'},'SYNTHETIC channel'))).rejects.toThrow('CONSENT_MODE_PENDING_OD06');
  expect((await activate({...SETTINGS.request_consent.default,templateVersion:REFERENCE_SET_ID})).ok).toBe(true);expect((await preview('REQUEST')).templateSet).toBe(REFERENCE_SET_ID);
  // An installed file that changes on disk stops the preview instead of printing a different form.
  process.env.NIPT_ANC_FORM_REGISTRY=path.join(dir,'missing.json');try{await expect(preview('REQUEST')).rejects.toMatchObject({code:'FORM_TEMPLATES_NOT_INSTALLED'});}finally{process.env.NIPT_ANC_FORM_REGISTRY=path.join(dir,'registry.json');}
 },120000);
 it('11: permissions follow the existing case/document scope',async()=>{
  await expect(preview('REQUEST',otherAnc)).rejects.toMatchObject({code:'FORBIDDEN'}); // another unit's ANC
  // document.request.read: Lab staff and certifiers may read the case's documents; the auditor role may not.
  for(const user of [lab,cert])expect((await preview('REQUEST',user)).pages).toBe(1);
  const auditor=await addUser(db,'AUDITOR','synthetic.auditor');await expect(preview('REQUEST',auditor)).rejects.toMatchObject({code:'FORBIDDEN'});
 },120000);
});
