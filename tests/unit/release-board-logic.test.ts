import {describe,expect,it} from 'vitest';
import {batchSignature,canSend,outcomeText,sendTicks,selectedRows,type SendableRow,canShowOnPatient,attestErrorText} from '../../src/components/p5/release-board-logic';

const row=(o:Partial<SendableRow>={}):SendableRow=>({key:'version:a',versionId:'a',rowVersion:3,abnormal:false,reviewed:true,...o});
describe('release board send rules',()=>{
 it('needs a selection',()=>expect(canSend([],{reviewConfirmed:true,abnormalAcknowledged:true})).toBe(false));
 it('reviewed normal rows send without ticks',()=>expect(canSend([row()],{reviewConfirmed:false,abnormalAcknowledged:false})).toBe(true));
 it('an unreviewed row needs the review tick',()=>{const s=[row({reviewed:false})];expect(canSend(s,{reviewConfirmed:false,abnormalAcknowledged:false})).toBe(false);expect(canSend(s,{reviewConfirmed:true,abnormalAcknowledged:false})).toBe(true);});
 it('an abnormal row needs the abnormal tick',()=>{const s=[row({abnormal:true})];expect(canSend(s,{reviewConfirmed:true,abnormalAcknowledged:false})).toBe(false);expect(canSend(s,{reviewConfirmed:false,abnormalAcknowledged:true})).toBe(true);});
 it('ticks that were not required are not sent as given',()=>expect(sendTicks([row()],{reviewConfirmed:true,abnormalAcknowledged:true})).toEqual({reviewConfirmed:false,abnormalAcknowledged:false}));
 it('HALOS-only rows are never selectable for send',()=>expect(selectedRows([row({key:'halos:x',versionId:null,rowVersion:null}),row()],new Set(['halos:x','version:a'])).map(r=>r.key)).toEqual(['version:a']));
 it('the batch signature changes with the selection, row version or ticks',()=>{const t={reviewConfirmed:false,abnormalAcknowledged:false};const a=batchSignature([row()],t);expect(batchSignature([row()],t)).toBe(a);expect(batchSignature([row({rowVersion:4})],t)).not.toBe(a);expect(batchSignature([row()],{...t,reviewConfirmed:true})).not.toBe(a);});
});
describe('outcome text',()=>{
 const label=(c:string)=>`<${c}>`;
 it('certified',()=>expect(outcomeText({versionId:'a',outcome:'CertifiedReleased'},label)).toContain('ส่ง HIS สำเร็จ'));
 it('blocked lists reasons',()=>expect(outcomeText({versionId:'a',outcome:'BLOCKED',failed:['X'],pending:['Y']},label)).toContain('<X> · <Y>'));
 it('error maps known codes and falls back to the code',()=>{expect(outcomeText({versionId:'a',outcome:'ERROR',code:'VERSION_CONFLICT'},label)).toContain('โหลดใหม่');expect(outcomeText({versionId:'a',outcome:'ERROR',code:'ZZZ'},label)).toContain('ZZZ');});
});

describe('"มีผลใน HIS แล้ว" on the board (Owner 2026-11-09)',()=>{
 it('any report with a PDF can be selected, linked or not (an unlinked one is linked by the clean rule, else its reason is shown)',()=>{
  expect(canShowOnPatient({versionId:'v',reasons:[{code:'MIGRATION_LINK_REQUIRED'}]})).toBe(true);
  expect(canShowOnPatient({versionId:'v',reasons:[{code:'UNLINKED'}]})).toBe(true);
  expect(canShowOnPatient({versionId:null,reasons:[]})).toBe(false);          // a HALOS row with no report yet
 });
 it('every reason the batch can return has Thai text, and an unknown one still reads as Thai',()=>{
  for(const code of ['HIS_ATTESTATION_LINKED_RESULT_REQUIRED','HIS_ATTESTATION_IDENTITY_MISMATCH','HIS_ATTESTATION_EXISTS','HIS_ATTESTATION_TRANSFER_EXISTS','FORBIDDEN','VERSION_CONFLICT'])expect(attestErrorText(code)).toMatch(/[ก-๙]/);
  expect(attestErrorText('SOMETHING_NEW')).toBe('ทำรายการไม่สำเร็จ');
  expect(attestErrorText('AUTO_MATCH_NOT_UNAMBIGUOUS')).toContain('เลือกผู้ป่วย');
 });
});
