import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readWorkerQueueOverview} from '../../packages/jobs/admin-center';
const user={id:randomUUID(),roles:['APP_ADMIN'] as const,unitIds:[],permissions:[]};
it('P1 queue admin overview denies non-admin without querying the database',async()=>{
 const query=vi.fn();
 await expect(readWorkerQueueOverview({query} as never,{...user,roles:['LAB_STAFF']} as never)).rejects.toThrow();
 expect(query).not.toHaveBeenCalled();
});
it('P1 outbox and archive list exposes statuses but no payload or PHI',async()=>{
 const data=[
  {rows:[{kind:'result_release_completed',state:'Dispatched',completed:true,count:1}]},
  {rows:[{state:'FAILED',count:2}]},
  {rows:[{id:randomUUID(),kind:'synthetic_scan',state:'Pending',created_at:new Date(),completed:false}]},
  {rows:[{id:randomUUID(),state:'FAILED',created_at:new Date(),attempts:2,claimed:false}]}
 ];
 const query=vi.fn(async(sql:string)=>{expect(typeof sql).toBe('string');return data.shift();});
 const result=await readWorkerQueueOverview({query} as never,user);
 expect(result.archive[0].count).toBe(2);
 expect(result.items[0].kind).toBe('synthetic_scan');
 expect(query).toHaveBeenCalledTimes(4);
 const sql=query.mock.calls.map(x=>String(x[0])).join('\n');
 expect(sql).toContain('integration_job_receipt');
 expect(sql).not.toContain('payload');
 expect(sql).not.toContain('UPDATE');
 expect(sql).not.toContain('DELETE');
});
