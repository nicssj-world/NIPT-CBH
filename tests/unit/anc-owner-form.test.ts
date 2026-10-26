import {it,expect} from 'vitest';
import {ageOnDate,calculations,emptyRequest} from '../../packages/p2/schema';
import {CONSENT_SIGNATURE_LAYOUT,consentItems} from '../../packages/forms/layout';
it('shows chronological age today independently of the clinical collection-date age',()=>{const d=structuredClone(emptyRequest);d.patient.dob='1989-05-15';expect(ageOnDate(d.patient.dob,'2026-10-25')).toBe(37);expect(calculations(d).ageYears).toBeNull();d.pregnancy.collectionDate='2026-05-14';expect(calculations(d).ageYears).toBe(36);expect(ageOnDate(null,'2026-10-25')).toBeNull();});
it('keeps two balanced signature columns and date below both name rows',()=>{expect(CONSENT_SIGNATURE_LAYOUT.patient.width).toBe(CONSENT_SIGNATURE_LAYOUT.doctor.width);const items=consentItems({patientName:'ผู้รับบริการชื่อยาว ทดสอบชื่อและนามสกุล',doctor:'แพทย์ชื่อยาว ทดสอบ',acknowledged:[],decision:null,patientSignedDate:'25/10/2569',documentCreatedDate:'25/10/2569'}).filter(x=>x.kind==='text');const dates=items.filter(x=>x.text.startsWith('วันที่'));expect(dates).toHaveLength(2);expect(dates.every(x=>x.y<135)).toBe(true);});

it('only a Request from the current round disables draft autosave',async()=>{const {currentRequestLocked}=await import('../../src/components/p2/request-history-contract');const prior=[{kind:'REQUEST',payload:{identity:{roundId:'prior'}}}];expect(currentRequestLocked(prior,'current')).toBe(false);expect(currentRequestLocked([...prior,{kind:'REQUEST',payload:{identity:{roundId:'current'}}}],'current')).toBe(true);expect(currentRequestLocked([{kind:'CONSENT',payload:{identity:{roundId:'current'}}}],'current')).toBe(false);});

it('links amendment audit to its exact round when workspace versions collide after redraw',async()=>{
 const {requestAuditRevisionId}=await import('../../src/components/p2/request-history-contract');
 const firstRound='5346ce29-4be6-4314-ad98-c6a6c816f864',redrawRound='9b1d0e97-371e-4b1a-8704-f98b64437341';
 const original={id:'original-request',kind:'REQUEST',payload:{workspaceVersion:1,identity:{roundId:firstRound}}},redraw={id:'redraw-request',kind:'REQUEST',payload:{workspaceVersion:1,identity:{roundId:redrawRound}}};
 const revisions=[redraw,original];
 expect(requestAuditRevisionId({roundId:firstRound,workspaceVersion:1},revisions)).toBe(original.id);
 expect(requestAuditRevisionId({roundId:redrawRound,workspaceVersion:1},revisions)).toBe(redraw.id);
 expect(requestAuditRevisionId({revisionId:original.id,roundId:redrawRound,workspaceVersion:1},revisions)).toBe(original.id);
 expect(requestAuditRevisionId({workspaceVersion:1},revisions)).toBeUndefined();
 expect(requestAuditRevisionId({roundId:firstRound},revisions)).toBeUndefined();
 expect(requestAuditRevisionId({roundId:firstRound,workspaceVersion:1},[...revisions,{...original,id:'another-legacy-confirmation'}])).toBeUndefined();
});
