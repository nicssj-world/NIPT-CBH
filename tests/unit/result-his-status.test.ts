import {describe,it,expect} from 'vitest';
import {hisDeliveryStatus,hisSendErrorText} from '../../packages/results/his-status';

describe('patient HIS delivery status',()=>{
 it('does not confuse a report, an outbox entry and a delivered file with an HIS acknowledgement',()=>{
  expect(hisDeliveryStatus({}).code).toBe('NOT_RELEASED');
  expect(hisDeliveryStatus({released:true}).code).toBe('QUEUED');
  expect(hisDeliveryStatus({released:true,jobState:'Failed'}).code).toBe('FAILED');
  for(const transferState of ['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','OK_OBSERVED']){
   const status=hisDeliveryStatus({released:true,transferState});
   expect(status.code).toBe('DELIVERED_UNCONFIRMED');expect(status.label).toContain('รอยืนยัน');
  }
  expect(hisDeliveryStatus({released:true,transferState:'SYNTHETIC_CONFIRMED'}).code).toBe('NEEDS_ATTENTION');
 });
 it('shows retry, reconciliation, suppression and active transfer separately',()=>{
  expect(hisDeliveryStatus({released:true,transferState:'PDF_VERIFIED'}).code).toBe('SENDING');
  expect(hisDeliveryStatus({released:true,transferState:'RETRY_PENDING'}).code).toBe('RETRY');
  expect(hisDeliveryStatus({released:true,transferState:'UNKNOWN_TIMEOUT'}).code).toBe('NEEDS_ATTENTION');
  expect(hisDeliveryStatus({released:true,transferState:'FAILED_NEEDS_ADMIN'}).code).toBe('FAILED');
  expect(hisDeliveryStatus({released:true,attested:true}).code).toBe('ATTESTED');
  expect(hisDeliveryStatus({released:true,eqa:true}).code).toBe('NOT_APPLICABLE');
 });
});

describe('simple "ส่ง HIS" status (Owner 2026-11-11)',()=>{
 it('shows one badge: sent, sending, failed with the reason, or not sent yet',()=>{
  const sent=hisDeliveryStatus({released:true,sendResult:{sent:true}});
  expect(sent.code).toBe('SENT');expect(sent.label).toBe('ส่ง HIS แล้ว');expect(sent.tone).toBe('good');
  const failed=hisDeliveryStatus({released:true,sendResult:{sent:false,error:'SHARE_PATH_NOT_FOUND'}});
  expect(failed.code).toBe('FAILED');expect(failed.error).toBe('SHARE_PATH_NOT_FOUND');
  expect(hisDeliveryStatus({released:true}).label).toBe('กำลังส่ง HIS');
  expect(hisDeliveryStatus({released:true,stale:true}).code).toBe('STUCK');
  expect(hisDeliveryStatus({released:true,attested:true,sendResult:{sent:true}}).code).toBe('ATTESTED');
 });
 it('explains a failure in Thai and falls back to the code',()=>{
  expect(hisSendErrorText('SHARE_PERMISSION_DENIED')).toContain('สิทธิ์');
  expect(hisSendErrorText('SOMETHING_NEW')).toContain('SOMETHING_NEW');
 });
});
