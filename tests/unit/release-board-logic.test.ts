import {describe,expect,it} from 'vitest';
import {batchSignature,canSend,outcomeText,reasonOk,sendTicks,selectedRows,type SendableRow} from '../../src/components/p5/release-board-logic';

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
 it('reason needs 8 characters',()=>{expect(reasonOk('1234567')).toBe(false);expect(reasonOk(' 12345678 ')).toBe(true);});
});
