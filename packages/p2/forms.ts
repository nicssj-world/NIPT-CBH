import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {operationalDataEnabled} from '../security/runtime';
import {readActiveSettings} from '../settings/service';
import {SETTINGS} from '../settings/catalog';
import {displayBe,displayBeDateTime} from '../domain/thai-date';
import {scopedCase,P2Error,type Staff} from './service';
import {calculations,emptyRequest,type RequestDraft} from './schema';
import {loadTemplates,type LoadedTemplates} from '../forms/registry';
import {requestItems,consentItems,REQUEST_PAGE,CONSENT_PAGE,type RequestFields,type ConsentFields,type Digits8,type Answer,type OverlayPage} from '../forms/layout';
import {composeForms,fits,textLayout,type overlaySchema} from '../pdf/anc-overlay';
import type {z} from 'zod';

// ANC "fill once" preview of the DCC Request (Fm-WI-T-BM17/01) and Consent (Fm-WI-T-BM17/02). Values come only from what is
// recorded: the ANC request draft, the case identity (HN as text), the ordering doctor the ANC nurse chose from the Doctor Registry,
// actual collection / HIS receipt / specimen-check events, and actual consent evidence. Nothing missing is invented, nothing is
// signed or consented by opening a preview, and the preview is never a controlled document.
export type FormKind='REQUEST'|'CONSENT'|'BOTH';
export type OverlayRenderer=(input:z.infer<typeof overlaySchema>)=>Promise<Buffer[]>;
const beDigits=(iso:string|null|undefined):Digits8=>{if(!iso)return null;const s=displayBe(iso,'');const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);return m?(m[1]+m[2]+m[3]).split('') as Digits8:null;};
const yesNo=(a:string|null|undefined):Answer=>a==='Yes'?'Yes':a==='No'?'No':null;
const clean=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null;
const fmt=(n:number|null|undefined,digits=0)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(digits):null;
const bangkokToday=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const ageOn=(dob:string|null,on:string|null)=>{if(!dob||!on)return null;const a=new Date(dob),b=new Date(on);return b.getUTCFullYear()-a.getUTCFullYear()-(b.toISOString().slice(5,10)<a.toISOString().slice(5,10)?1:0);};
const thaiTime=(instant:Date|string|null)=>{if(!instant)return null;const s=displayBeDateTime(instant,'');const m=/(\d{2}:\d{2})/.exec(s);return m?m[1]+' น.':null;};

export async function formSources(db:Queryable,user:Staff,caseId:string){
 const c=await scopedCase(db,user,caseId,'document.request.read','read');
 const w=(await db.query<{draft:RequestDraft;request_mode:string;consent_mode:string;version:number}>('SELECT draft,request_mode,consent_mode,version FROM p2_workspace WHERE round_id=$1',[c.current_round_id])).rows[0];
 const draft:RequestDraft=w?.draft??emptyRequest;
 // The ordering doctor is the Doctor Registry version the ANC nurse selected on this round's request; never the user's own name.
 const doctorId=draft.ordering?.doctorVersionId??null;
 const doctor=doctorId?(await db.query<{id:string;name:string;doctor_key:string;active:boolean}>(`SELECT v.id,v.name,v.doctor_key,
   -- same rule as activeDoctor(): this unit, effective, latest event Approved, no newer approved version of the same doctor
   (v.unit_id=$2 AND v.effective_from<=now() AND (SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1)='Approved'
    AND NOT EXISTS(SELECT 1 FROM p2_doctor_version n JOIN p2_doctor_event e ON e.doctor_version_id=n.id AND e.event_type='Approved' WHERE n.doctor_key=v.doctor_key AND n.version>v.version AND n.effective_from<=now())) active
   FROM p2_doctor_version v WHERE v.id=$1`,[doctorId,c.unit_id])).rows[0]??null:null;
 const fact=(await db.query<{collection_date:string;collection_time:string|null;source:string}>("SELECT collection_date::text,collection_time,source FROM p2_collection_fact WHERE round_id=$1 ORDER BY sequence DESC LIMIT 1",[c.current_round_id])).rows[0]??null;
 const round=(await db.query<{received_at:Date|null;received_source:string|null}>('SELECT received_at,received_source FROM specimen_round WHERE id=$1',[c.current_round_id])).rows[0];
 const acceptance=(await db.query<{condition:'ACCEPTABLE'|'REJECTED';reason:string;created_at:Date}>('SELECT condition,reason,created_at FROM specimen_acceptance WHERE round_id=$1 ORDER BY created_at DESC LIMIT 1',[c.current_round_id]).catch(()=>({rows:[]}))).rows[0]??null;
 const consentDoc=(await db.query<{id:string;payload:{doctor?:{id?:string;name?:string}}}>("SELECT id,payload FROM p2_document_revision WHERE round_id=$1 AND kind='CONSENT' ORDER BY version DESC LIMIT 1",[c.current_round_id])).rows[0]??null;
 const final=consentDoc?(await db.query<{payload:{signature?:{decision?:string;signed_at?:string};acknowledgments?:{item:number|string}[]}}>('SELECT payload FROM p2_final_consent WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1',[consentDoc.id])).rows[0]??null:null;
 const paperConsent=(await db.query<{panel:{decision?:string;signatures?:string}}>("SELECT panel FROM p2_paper_review WHERE round_id=$1 AND kind='CONSENT' AND status='Verified' ORDER BY created_at DESC LIMIT 1",[c.current_round_id])).rows[0]??null;
 const revoked=(await db.query('SELECT 1 FROM p2_revocation WHERE case_id=$1 LIMIT 1',[c.id])).rows.length>0;
 return {c,draft,requestMode:w?.request_mode??null,consentMode:w?.consent_mode??null,doctor,fact,round,acceptance,consentDoc,final,paperConsent,revoked};
}
type Sources=Awaited<ReturnType<typeof formSources>>;

export function requestFields(s:Sources):{fields:RequestFields;missing:string[]}{
 const d=s.draft,p=d.pregnancy,h=d.history,o=d.ordering,calc=calculations(d),missing:string[]=[];
 const need=<T>(v:T|null|undefined,label:string)=>{if(v===null||v===undefined||v==='')missing.push(label);return v??null;};
 const entitlementText=clean(d.patient.entitlement);
 const entitlement=entitlementText&&/สปสช|NHSO|UC\b/i.test(entitlementText)?'NHSO' as const:entitlementText&&/เรียกเก็บ|ชำระเอง|SELF/i.test(entitlementText)?'SELF_PAY' as const:null;
 if(!entitlement)missing.push('สิทธิการตรวจ');
 const gpa=p.gravida!==null||p.para!==null||p.abortion!==null&&p.abortion!==undefined?`G${p.gravida??'-'} P${p.para??'-'} A${p.abortion??'-'}`:null;
 const age=ageOn(d.patient.dob,p.collectionDate??bangkokToday());
 const doctorName=s.doctor?.active?s.doctor.name:null;if(!doctorName)missing.push(s.doctor?'แพทย์ผู้สั่งตรวจ (ทะเบียนแพทย์ไม่ active)':'แพทย์ผู้สั่งตรวจ');
 const coordinator=[clean(o.coordinator),clean(o.phone)].filter(Boolean).join(' / ')||null;
 const fields:RequestFields={
  name:need(clean(d.patient.syntheticName),'ชื่อ-นามสกุล'),hn:need(s.c.hn,'HN'),nationalId:clean(d.patient.identifier),
  dob:beDigits(need(d.patient.dob,'วันเกิด')),age:age!==null&&age>=0?String(age):null,weight:fmt(p.weightKg,1),height:fmt(p.heightCm,0),bmi:fmt(calc.bmi,1),
  entitlement,reason:need(clean(o.reason),'เหตุผลในการส่งตรวจ'),facility:need(clean(o.facility),'โรงพยาบาล/คลินิก'),doctor:doctorName,coordinatorPhone:coordinator,email:clean(o.email),
  ultrasound:beDigits(p.ultrasoundDate),edd:beDigits(need(p.edd,'วันกำหนดคลอด')),
  ga:calc.gaWeeks!==null&&calc.gaRemainder!==null&&calc.gaDays!==null&&calc.gaDays>=0?{w:String(calc.gaWeeks),d:String(calc.gaRemainder)}:null,
  pregnancyType:p.type==='Singleton'||p.type==='Twins'?p.type:null,vanishing:yesNo(p.vanishingTwin),
  vanishingGa:p.vanishingTwin==='Yes'&&p.vanishingGaDays!==null?`${Math.floor(p.vanishingGaDays/7)}+${p.vanishingGaDays%7} สป.`:null,drawAfter8:p.vanishingTwin==='Yes'&&p.drawEightWeeksAfterLoss==='Yes',
  art:yesNo(p.art),pregnancyNumber:p.gravida!==null?String(p.gravida):null,gpa,
  history:[yesNo(h.transfusion4months.answer),yesNo(h.heparin24h.answer),yesNo(h.immune1month.answer),yesNo(h.cancerTreatment),yesNo(h.gaUnder8),yesNo(h.tumor),yesNo(h.priorChromosomeTest)],
  priorMethod:h.priorChromosomeTest==='Yes'?clean(h.priorTestMethod):null,priorResult:h.priorChromosomeTest==='Yes'?clean(h.priorTestResult):null,
  item8:h.otherHistory==='Yes'?clean(h.otherDetails):null,
  // Fetal sex is printed only for a singleton and only as recorded; twins never get a sex choice.
  fetalSex:p.type==='Singleton'&&(p.fetalSex==='Want'||p.fetalSex==='DoNotWant')?p.fetalSex:null,
  // Staff sections only from events that happened: the recorded collection fact, the HIS PET receipt, the Lab specimen check.
  draw:{date:beDigits(s.fact?.collection_date),time:s.fact?.collection_time?s.fact.collection_time.slice(0,5)+' น.':null},
  receive:{condition:s.acceptance?.condition??null,reason:s.acceptance?.condition==='REJECTED'?clean(s.acceptance.reason):null,
   date:s.round?.received_at&&s.round.received_source==='HIS_PET_RECEIPT'?displayBe(new Date(s.round.received_at.getTime()+7*3600000).toISOString().slice(0,10),''):null,
   time:s.round?.received_at&&s.round.received_source==='HIS_PET_RECEIPT'?thaiTime(s.round.received_at):null},
  ackA:d.acknowledgments.conditionA==='Yes',ackB:d.acknowledgments.conditionB==='Yes',
 };
 for(const [i,a] of fields.history.entries())if(a===null)missing.push(`ประวัติข้อ ${i+1}`);
 if(fields.pregnancyType===null)missing.push('ครรภ์เดี่ยว/แฝด');
 return {fields,missing};
}
export function consentFields(s:Sources):{fields:ConsentFields;status:'UNSIGNED'|'SIGNED_ELECTRONIC'|'PAPER_VERIFIED'|'PAPER_SELECTED'|'REVOKED';doctorMismatch:boolean}{
 const sig=s.final?.payload.signature,acks=new Set((s.final?.payload.acknowledgments??[]).map(a=>Number(a.item)));
 const decision=sig?.decision==='Granted'||sig?.decision==='Declined'?sig.decision:s.paperConsent?.panel.decision==='Granted'||s.paperConsent?.panel.decision==='Declined'?s.paperConsent.panel.decision as 'Granted'|'Declined':null;
 const doctorMismatch=!!(s.consentDoc?.payload.doctor?.id&&s.doctor&&s.consentDoc.payload.doctor.id!==s.doctor.id);
 return {fields:{patientName:clean(s.draft.patient.syntheticName),doctor:s.doctor?.active&&!doctorMismatch?s.doctor.name:null,
   // "เข้าใจแล้ว" only for clauses acknowledged in a completed signing session (p2_consent_ack → final consent); never from a preview.
   acknowledged:Array.from({length:12},(_,i)=>!!sig&&acks.has(i+1)&&acks.size===12),
   decision,patientSignedDate:sig?.signed_at?displayBe(new Date(new Date(sig.signed_at).getTime()+7*3600000).toISOString().slice(0,10),''):null},
  status:s.revoked?'REVOKED':sig?'SIGNED_ELECTRONIC':s.paperConsent?'PAPER_VERIFIED':s.consentMode==='Paper'?'PAPER_SELECTED':'UNSIGNED',doctorMismatch};
}
const STATUS_TEXT={UNSIGNED:'ยังไม่ได้ลงนาม ยังไม่ได้ให้ความยินยอม',PAPER_SELECTED:'เลือกใช้ Paper Consent — ไม่ใช่หลักฐานการลงนาม',SIGNED_ELECTRONIC:'ลงนามอิเล็กทรอนิกส์แล้ว — หลักฐานอยู่ในระบบ ไม่ใช่ฉบับร่างนี้',PAPER_VERIFIED:'มีเอกสารกระดาษที่ตรวจแล้ว — ต้นฉบับกระดาษคือหลักฐาน',REVOKED:'ถอนความยินยอมแล้ว'};

/** Builds the preview PDF (1 or 2 pages) from the active template set chosen in Settings. Never stored, never a controlled copy. */
export async function ancFormPreview(db:Queryable,user:Staff,caseId:string,kind:FormKind,render:OverlayRenderer,templates?:LoadedTemplates){
 const s=await formSources(db,user,caseId);
 const setting=SETTINGS.request_consent.schema.parse((await readActiveSettings(db)).request_consent??SETTINGS.request_consent.default);
 let t:LoadedTemplates;try{t=templates??await loadTemplates(setting.templateVersion);}catch(e){throw new P2Error(e instanceof Error?e.message:'FORM_TEMPLATE_UNAVAILABLE',409);}
 const r=requestFields(s),cf=consentFields(s);
 const approved=t.set.dccStatus==='DCC_APPROVED',when=displayBeDateTime(new Date(),'');
 const banner=(code:string,extra:string)=>`${approved?'ฉบับพิมพ์ตัวอย่าง':'ฉบับร่างเพื่อดูตัวอย่าง (DRAFT PREVIEW) — ไม่ใช่เอกสารควบคุม · DCC ยังไม่อนุมัติ'} · ${code} · ชุดแบบฟอร์ม ${t.set.id} · ${when} · ${extra}`;
 const watermark=approved?'':'ฉบับร่าง — ไม่ใช่เอกสารควบคุม';
 const reqPage:OverlayPage={...REQUEST_PAGE,items:requestItems(r.fields),banner:banner(t.set.request.docCode,r.missing.length?`ยังไม่มีข้อมูล ${r.missing.length} รายการ (เว้นว่างตามจริง)`:'ข้อมูลครบตามที่บันทึก'),watermark};
 const conPage:OverlayPage={...CONSENT_PAGE,items:consentItems(cf.fields),banner:banner(t.set.consent.docCode,`สถานะความยินยอม: ${STATUS_TEXT[cf.status]}${cf.doctorMismatch?' · แพทย์ในเอกสารยินยอมไม่ตรงกับแพทย์ผู้สั่งตรวจ':''}`),watermark};
 const wanted=kind==='REQUEST'?[reqPage]:kind==='CONSENT'?[conPage]:[reqPage,conPage];
 const overlays=await render({pages:wanted});
 if(overlays.length!==wanted.length)throw new P2Error('RENDERER_FAILED',502);
 const bytes=await composeForms(wanted.map((p,i)=>({template:p===reqPage?t.request:t.consent,overlay:overlays[i],width:p.width,height:p.height})),`DRAFT ${kind} ${t.set.id}`);
 const overflow=wanted.flatMap(p=>p.items.flatMap(i=>{if(i.kind!=='text')return [];const l=textLayout(i);return fits(i.text,i.w*l.lines,l.size)?[]:[i.text.slice(0,20)];}));
 const hash=createHash('sha256').update(bytes).digest('hex');
 await appendAudit(db,{actorId:user.id,action:'P2_FORM_PREVIEW',resourceType:'nipt_case',resourceId:s.c.id,details:{outcome:'DRAFT_PREVIEW',reasonCode:kind,version:t.set.id.slice(0,79).replace(/[^A-Za-z0-9_.-]/g,'_'),synthetic:!operationalDataEnabled()}});
 return {bytes,hash,templateSet:t.set.id,dccStatus:t.set.dccStatus,pages:wanted.length,missing:r.missing,consentStatus:cf.status,doctorMismatch:cf.doctorMismatch,overflow,
  doctor:s.doctor?{id:s.doctor.id,name:s.doctor.name,active:s.doctor.active}:null};
}
