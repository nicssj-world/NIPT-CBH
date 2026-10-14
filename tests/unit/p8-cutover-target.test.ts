import {describe,it,expect} from 'vitest';
import {assertCutoverTarget} from '../../tools/p8/cutover-rehearsal';

const target='postgresql://nipt_p8_synthetic_owner@127.0.0.1:55461/nipt_p8_synthetic_admin';
describe('P8 retained cutover rehearsal target isolation',()=>{
 it('requires explicit mode and dedicated target even when DATABASE_URL exists',()=>{
  expect(()=>assertCutoverTarget({DATABASE_URL:target})).toThrow('EXPLICIT_P8_CUTOVER_CLUSTER_REQUIRED');
  expect(()=>assertCutoverTarget({NIPT_MODE:'synthetic',DATABASE_URL:target})).toThrow('EXPLICIT_P8_CUTOVER_CLUSTER_REQUIRED');
 });
 it('rejects remote, alternate loopback/port, current app and existing rehearsal databases',()=>{
  for(const url of [target.replace('127.0.0.1','example.com'),target.replace('127.0.0.1','localhost'),target.replace('55461','5432'),target.replace('nipt_p8_synthetic_admin','nipt_synthetic_app'),target.replace('nipt_p8_synthetic_admin','nipt_p8_synthetic_cutover_123')])
   expect(()=>assertCutoverTarget({NIPT_MODE:'synthetic',NIPT_P8_OPS_URL:url})).toThrow('DEDICATED_P8_CUTOVER_CLUSTER_REQUIRED');
 });
 it('rejects target option/identity overrides and non-PostgreSQL schemes',()=>{
  for(const url of [target+'?options=-csearch_path=other',target+'#fragment',target.replace('postgresql:','https:'),target.replace('nipt_p8_synthetic_owner','postgres')])
   expect(()=>assertCutoverTarget({NIPT_MODE:'synthetic',NIPT_P8_OPS_URL:url})).toThrow('DEDICATED_P8_CUTOVER_CLUSTER_REQUIRED');
 });
 it('returns a dedicated URL without changing inherited environment',()=>{
  const env={NIPT_MODE:'synthetic',NIPT_P8_OPS_URL:target,DATABASE_URL:'postgresql://existing.example/production'};
  expect(assertCutoverTarget(env).pathname).toBe('/nipt_p8_synthetic_admin');
  expect(env.DATABASE_URL).toBe('postgresql://existing.example/production');
 });
});
