import {describe,it,expect} from 'vitest';
import {hisDeliveryStatus} from '../../packages/results/his-status';

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
