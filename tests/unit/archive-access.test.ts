import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readArchiveStatus} from '../../packages/results/archive-access';
import type {Principal} from '../../packages/security/policy';

const user=(role:Principal['roles'][number],units:string[]=[]):Principal=>({id:randomUUID(),roles:[role],unitIds:units,permissions:[]});
describe('archive report authorization',()=>{
 it('does not reveal a status for a missing report or unrelated case',async()=>{
  const db={query:vi.fn().mockResolvedValue({rows:[]})};
  await expect(readArchiveStatus(db as never,user('LAB_STAFF'),randomUUID())).rejects.toThrow('NOT_FOUND');
  expect(db.query).toHaveBeenCalledTimes(1);
 });
 it('denies an ANC user even for a report in another unit',async()=>{
  const db={query:vi.fn().mockResolvedValue({rows:[{case_id:randomUUID(),registration_origin:'ANC',unit_id:randomUUID(),state:'ARCHIVED'}]})};
  await expect(readArchiveStatus(db as never,user('ANC_NURSE',[randomUUID()]),randomUUID())).rejects.toThrow('FORBIDDEN');
 });
 it('returns only status for an authorized LAB report',async()=>{
  const db={query:vi.fn().mockResolvedValue({rows:[{case_id:randomUUID(),registration_origin:'ANC',unit_id:randomUUID(),state:'ARCHIVED',root_path:'must not escape'}]})};
  expect(await readArchiveStatus(db as never,user('LAB_STAFF'),randomUUID())).toEqual({state:'ARCHIVED'});
 });
});
