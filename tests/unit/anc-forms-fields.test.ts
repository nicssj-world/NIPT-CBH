import {DCC_CONSENT} from '../../packages/forms/consent-content';
import {describe,it,expect} from 'vitest';
import {requestFields,consentFields,type formSources} from '../../packages/p2/forms';
import {emptyRequest,type RequestDraft} from '../../packages/p2/schema';
import {requestItems,consentItems} from '../../packages/forms/layout';

// Field mapping without a database: only recorded facts reach the form; the consent shows acknowledgement, decision and signing
// date only from a completed signing (12 recorded acknowledgements + signature) or a verified paper review.
type Sources=Awaited<ReturnType<typeof formSources>>;
const base=(draft:RequestDraft,extra:Partial<Sources>={}):Sources=>({c:{id:'c',ln:'009900010001',hn:'0099000123',registration_origin:'ANC',current_round_id:'r',unit_id:'u',state:'Expected',analysis_started:false,round_number:1},
 draft,requestMode:'Electronic',consentMode:'Electronic',doctor:{id:'d1',name:'SYNTHETIC นพ.ทะเบียน',doctor_key:'K',active:true},fact:null,round:{received_at:null,received_source:null},acceptance:null,consentDoc:null,final:null,paperConsent:null,revoked:false,...extra}) as Sources;

describe('ANC form field mapping',()=>{
 it('does not print a passport or hospital identifier in the DCC national-ID field',()=>{
  const d=structuredClone(emptyRequest);d.patient.identifier='TEST-PASSPORT';d.patient.identifierType='Passport';
  expect(requestFields(base(d)).fields.nationalId).toBeNull();
  d.patient.identifierType='ThaiNationalId';d.patient.identifier='1234567890123';expect(requestFields(base(d)).fields.nationalId).toBeNull();
  d.patient.identifier='0000000000001';expect(requestFields(base(d)).fields.nationalId).toBe('0000000000001');
 });

 it('keeps a legacy signature as history without projecting its choice, date or acknowledgments onto the current DCC preview',()=>{
  const legacy={content_hash:'a'.repeat(64),payload:{signature:{decision:'Granted',signed_at:'2026-10-12T02:00:00Z'},acknowledgments:Array.from({length:12},(_,i)=>({item:i+1}))}};
  const before=structuredClone(legacy);
  const result=consentFields(base(structuredClone(emptyRequest),{consentDoc:{round_id:'r',template_version:'CBH-FM02-v1',content_hash:'a'.repeat(64),id:'legacy',payload:{doctor:{id:'d1'}}},final:legacy}));
  expect(result).toMatchObject({status:'LEGACY_ELECTRONIC',fields:{decision:null,patientSignedDate:null}});
  expect(result.fields.acknowledged.some(Boolean)).toBe(false);expect(consentItems(result.fields).filter(i=>i.kind==='check')).toEqual([]);
  expect(legacy).toEqual(before);
 });
 it('twins never print a fetal-sex choice; unanswered items stay blank; entitlement only from recorded text',()=>{
  const d=structuredClone(emptyRequest);d.pregnancy.type='Twins';d.pregnancy.fetalSex='Want';d.history.tumor='Unknown';d.patient.entitlement='SYNTHETIC เรียกเก็บเงิน';
  const r=requestFields(base(d)).fields;
  expect(r.fetalSex).toBeNull();expect(r.pregnancyType).toBe('Twins');expect(r.history[5]).toBeNull();expect(r.entitlement).toBe('SELF_PAY');
  expect(requestItems(r).filter(i=>i.kind==='check')).toHaveLength(2); // Twins + เรียกเก็บเงิน, nothing else ticked
  const none=requestFields(base(structuredClone(emptyRequest),{doctor:null})).fields;expect(requestItems(none).filter(i=>i.kind!=='text'||i.text!=='0099000123')).toEqual([]);
 });
 it('staff sections come only from recorded events (collection fact, HIS PET receipt, Lab specimen check)',()=>{
  const r=requestFields(base(structuredClone(emptyRequest),{fact:{collection_date:'2026-10-10',collection_time:'09:30:00',source:'ANC'},
   round:{received_at:new Date('2026-10-13T03:00:00Z'),received_source:'HIS_PET_RECEIPT'},acceptance:{condition:'REJECTED',reason:'SYNTHETIC hemolysed',created_at:new Date()}})).fields;
  expect(r.draw).toEqual({date:'10102569'.split(''),time:'09:30 น.'});expect(r.receive).toEqual({condition:'REJECTED',reason:'SYNTHETIC hemolysed',date:'13/10/2569',time:'10:00 น.'});
  const local=requestFields(base(structuredClone(emptyRequest),{round:{received_at:new Date(),received_source:'NIPT_LOCAL_RECEIPT'}})).fields;expect(local.receive.date).toBeNull(); // only the HIS receipt is the reception
 });
 it('consent: unsigned → nothing ticked; completed signing → 12 ticks, decision and signing date; partial evidence → no ticks',()=>{
  const unsigned=consentFields(base(structuredClone(emptyRequest)));
  expect(unsigned).toMatchObject({status:'UNSIGNED',fields:{decision:null,patientSignedDate:null}});expect(consentItems(unsigned.fields).filter(i=>i.kind==='check')).toEqual([]);
  const final=(n:number)=>({content_hash:'a'.repeat(64),payload:{consentContent:DCC_CONSENT,signature:{decision:'Granted',signed_at:'2026-10-12T02:00:00Z'},acknowledgments:Array.from({length:n},(_,i)=>({item:i+1,clauseId:DCC_CONSENT.clauses[i]?.id,contentVersion:DCC_CONSENT.id,contentSha256:DCC_CONSENT.sha256}))}});
  const signed=consentFields(base(structuredClone(emptyRequest),{consentDoc:{round_id:'r',template_version:'CBH-FM02-v1',content_hash:'a'.repeat(64),id:'doc',payload:{doctor:{id:'d1'},consentContent:DCC_CONSENT}},final:final(12)}));
  expect(signed).toMatchObject({status:'SIGNED_ELECTRONIC',fields:{decision:'Granted',patientSignedDate:'12/10/2569'}});expect(signed.fields.acknowledged.every(Boolean)).toBe(true);
  expect(consentItems(signed.fields).filter(i=>i.kind==='check')).toHaveLength(13); // 12 clauses + ยินยอม
  expect(consentFields(base(structuredClone(emptyRequest),{consentDoc:{round_id:'r',template_version:'CBH-FM02-v1',content_hash:'a'.repeat(64),id:'doc',payload:{}},final:final(11)})).fields.acknowledged.some(Boolean)).toBe(false);
  expect(consentFields(base(structuredClone(emptyRequest),{revoked:true})).status).toBe('REVOKED');
  const paper=consentFields(base(structuredClone(emptyRequest),{paperConsent:{panel:{decision:'Declined'}}}));expect(paper).toMatchObject({status:'PAPER_VERIFIED',fields:{decision:'Declined',patientSignedDate:null}});
  expect(paper.fields.acknowledged.some(Boolean)).toBe(false); // paper ticks are on the paper original, not invented
  const marker=consentFields(base(structuredClone(emptyRequest),{consentMode:'Paper'}));expect(marker).toMatchObject({status:'PAPER_SELECTED',fields:{decision:null,patientSignedDate:null}}); // the marker is not signing evidence
  expect(consentItems(marker.fields).filter(i=>i.kind==='check')).toEqual([]);
  const refused=consentFields(base(structuredClone(emptyRequest),{consentMode:'Paper',paperRefused:true} as Partial<Sources>));expect(refused).toMatchObject({status:'PAPER_REFUSED',fields:{decision:null,patientSignedDate:null}}); // staff-recorded refusal: still no decision tick, signature or date inferred
  expect(consentItems(refused.fields).filter(i=>i.kind==='check')).toEqual([]);
 });
 it('the doctor printed is the registry doctor of the request; an inactive or mismatched doctor is left blank, never replaced',()=>{
  const d=structuredClone(emptyRequest);
  expect(requestFields(base(d,{doctor:{id:'d1',name:'SYNTHETIC นพ.ทะเบียน',doctor_key:'K',active:false}})).fields.doctor).toBeNull();
  const mismatch=consentFields(base(d,{consentDoc:{round_id:'r',template_version:'CBH-FM02-v1',content_hash:'a'.repeat(64),id:'doc',payload:{doctor:{id:'other'}}}}));expect(mismatch).toMatchObject({doctorMismatch:true,fields:{doctor:null}});
 });
});
