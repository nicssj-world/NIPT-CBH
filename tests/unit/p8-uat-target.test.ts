import {describe,it,expect} from 'vitest';
import {uatAdminTarget} from '../../tools/p8/prepare-uat';

describe('P8 UAT provisioning target safety',()=>{
 const safe='postgresql://nipt_p8_synthetic_owner@127.0.0.1:55461/nipt_p8_synthetic_admin';
 it('requires explicit dedicated local synthetic authority',()=>{
  expect(uatAdminTarget(safe,'synthetic').pathname).toBe('/nipt_p8_synthetic_admin');
  for(const raw of [undefined,'',safe.replace('127.0.0.1','hospital.example'),safe.replace('55461','5432'),safe.replace('nipt_p8_synthetic_admin','nipt_synthetic_compose'),safe+'?sslmode=disable',safe.replace('nipt_p8_synthetic_owner','nipt_web')])expect(()=>uatAdminTarget(raw,'synthetic')).toThrow('P8_UAT_DEDICATED_LOCAL_TARGET_REQUIRED');
  expect(()=>uatAdminTarget(safe,'production')).toThrow('P8_UAT_SYNTHETIC_ONLY');
 });
});
