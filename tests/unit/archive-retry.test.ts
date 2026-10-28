import {afterAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {enableArchive,retryFailedArchive} from '../../packages/results/archive-settings';
import {runArchiveProbeCycle} from '../../packages/results/archive-worker';

vi.mock('../../packages/db/audit',()=>({appendAudit:vi.fn().mockResolvedValue(undefined)}));
const fixtures:string[]=[];
afterAll(async()=>{for(const root of fixtures)await rm(root,{recursive:true,force:true});});

it('rejects a non-admin before touching archive jobs',async()=>{
 const db={query:vi.fn()};
 await expect(retryFailedArchive(db as never,{id:randomUUID(),roles:['LAB_STAFF'],unitIds:[],permissions:[]},randomUUID())).rejects.toThrow('FORBIDDEN');
 expect(db.query).not.toHaveBeenCalled();
});

it('Admin queues an untrusted probe hint but never changes archive job state',async()=>{
 const actor=randomUUID(),jobId=randomUUID(),probeId=randomUUID();
 const query=vi.fn().mockResolvedValueOnce({rows:[{root_path:'fixture-root'}]})
                    .mockResolvedValueOnce({rows:[{id:probeId}]});
 const result=await retryFailedArchive({query} as never,{id:actor,roles:['APP_ADMIN'],unitIds:[],permissions:[]},jobId);
 expect(result).toEqual({probeId,state:'PENDING_PROBE'});
 expect(query).toHaveBeenCalledTimes(2);
 expect(query.mock.calls[0][0]).toContain("j.state='FAILED'");
 expect(query.mock.calls[0][1]).toEqual([jobId]);
 expect(query.mock.calls[1][0]).toContain('INSERT INTO pdf_archive_probe');
 expect(query.mock.calls[1][1]).toEqual(['fixture-root',actor,jobId]);
 expect(query.mock.calls.some(([sql])=>/UPDATE pdf_archive_job|pdf_archive_retry\(/.test(sql))).toBe(false);
});

it('worker probes real storage before any possible FAILED recovery and ignores actor authority',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-worker-recheck-'));fixtures.push(root);
 const id=randomUUID(),claim=randomUUID();
 const query=vi.fn().mockResolvedValueOnce({rows:[{id,claim_token:claim,root_path:root}]})
                    .mockResolvedValueOnce({rows:[{completed_count:1,recovered_count:1}]});
 await runArchiveProbeCycle({query} as never);
 expect(query).toHaveBeenCalledTimes(2);
 const [sql,params]=query.mock.calls[1];
 expect(sql).toContain("p.state='PASSED'");
 expect(sql).toContain("j.state='FAILED'");
 expect(sql).toContain('cfg.enabled');
 expect(sql).toContain('cfg.root_path=p.root_path');
 expect(sql).toContain('w.id=j.window_id');
 expect(sql).toContain("claim_token IS NULL");
 expect(sql).not.toContain('requested_by');
 expect(params[0]).toBe(id);
 expect(params[1]).toBe(claim);
 expect(params[2]).toBe('PASSED');
 expect(params[3]).toBeNull();
});

it('unreachable archive root cannot authorize a worker recovery',async()=>{
 const root=path.join(os.tmpdir(),'missing-nipt-archive-'+randomUUID()),id=randomUUID(),claim=randomUUID();
 const query=vi.fn().mockResolvedValueOnce({rows:[{id,claim_token:claim,root_path:root}]})
                    .mockResolvedValueOnce({rows:[{completed_count:1,recovered_count:0}]});
 await runArchiveProbeCycle({query} as never);
 const [sql,params]=query.mock.calls[1];
 expect(params[2]).toBe('FAILED');
 expect(params[3]).not.toBeNull();
 expect(sql).toContain("p.state='PASSED'");
});

it('recovery probe cannot be reused as an archive activation capability',async()=>{
 const user={id:randomUUID(),roles:['APP_ADMIN'] as const,unitIds:[],permissions:[]};
 const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
 await expect(enableArchive({query} as never,user,randomUUID())).rejects.toThrow('ARCHIVE_TEST_REQUIRED');
 expect(query.mock.calls[1][0]).toContain('retry_job_id IS NULL');
 expect(query.mock.calls).toHaveLength(2);
});
