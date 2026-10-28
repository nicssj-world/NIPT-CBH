import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readOperationsOverview} from '../../packages/results/operations-overview';

describe('APP_ADMIN operations overview',()=>{
 const admin={id:randomUUID(),roles:['APP_ADMIN'] as const,unitIds:[],permissions:[]};
 it('denies a LAB user without issuing a database query',async()=>{
  const query=vi.fn();
  await expect(readOperationsOverview({query} as never,{...admin,roles:['LAB_STAFF']},)).rejects.toThrow('FORBIDDEN');
  expect(query).not.toHaveBeenCalled();
 });
 it('reports bounded de-identified archive KPIs, exception rows and PDF audit from read-only SQL',async()=>{
  const returns=[
   {rows:[{state:'ARCHIVED',count:4},{state:'FAILED',count:1}]},
   {rows:[{count:3}]},
   {rows:[{purpose:'ANC_RESULT_PRINT_VIEW',count:2}]},
   {rows:[{id:randomUUID(),state:'FAILED',attempts:5,last_error:'ARCHIVE_ENOENT',updated_at:'2026-10-29T00:00:00Z'}]},
   {rows:[{actor_name:'Synthetic Staff',version_id:randomUUID(),purpose:'ANC_RESULT_PRINT_VIEW',accessed_at:'2026-10-29T00:00:00Z'}]}
  ];
  const query=vi.fn().mockImplementation(async()=>returns.shift());
  const result=await readOperationsOverview({query} as never,admin);
  expect(result.archiveCounts).toEqual([{state:'ARCHIVED',count:4},{state:'FAILED',count:1}]);
  expect(result.released24h).toBe(3);
  expect(result.pdfAudit[0]?.actor_name).toBe('Synthetic Staff');
  expect(result.exceptions).toHaveLength(1);
  expect(query).toHaveBeenCalledTimes(5);
  const sql=query.mock.calls.map(([statement])=>String(statement)).join('\n');
  expect(sql).toContain("state='FAILED'");
  expect(sql).toContain('LIMIT 30');
  expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
  expect(sql).not.toContain('root_path');
  expect(sql).not.toContain('patient_name');
 });
});
