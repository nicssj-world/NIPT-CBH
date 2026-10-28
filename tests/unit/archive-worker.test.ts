import {describe,expect,it,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {runArchiveCycle} from '../../packages/results/archive-worker';

describe('independent archive worker',()=>{
 it('claims a job, verifies its source identity, and records a verified publication',async()=>{
  const bytes=Buffer.from('synthetic pdf'),sha256=createHash('sha256').update(bytes).digest('hex');
  const job={id:randomUUID(),claim_token:randomUUID(),release_id:randomUUID(),case_id:randomUUID(),version_id:randomUUID(),source_sha256:sha256,root_path:'fixture',attempts:1};
  const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[job]}).mockResolvedValueOnce({rows:[{release_id:job.release_id,case_id:job.case_id,version_id:job.version_id,sha256,byte_size:bytes.length,media_type:'application/pdf'}]}).mockResolvedValueOnce({rows:[]});
  const publish=vi.fn().mockResolvedValue({state:'ARCHIVED',sha256});
  await runArchiveCycle({query} as never,{get:async()=>bytes} as never,publish);
  expect(publish).toHaveBeenCalledOnce();
  expect(query.mock.calls[3][0]).toContain("state='ARCHIVED'");
  expect(query.mock.calls[3][1]).toEqual([job.id,job.claim_token]);
 });
 it('records a failed publication without invoking any clinical or HIS operation',async()=>{
  const bytes=Buffer.from('synthetic pdf'),sha256=createHash('sha256').update(bytes).digest('hex');
  const job={id:randomUUID(),claim_token:randomUUID(),release_id:randomUUID(),case_id:randomUUID(),version_id:randomUUID(),source_sha256:sha256,root_path:'fixture',attempts:1};
  const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[job]}).mockResolvedValueOnce({rows:[{release_id:job.release_id,case_id:job.case_id,version_id:job.version_id,sha256,byte_size:bytes.length,media_type:'application/pdf'}]}).mockResolvedValueOnce({rows:[]});
  await runArchiveCycle({query} as never,{get:async()=>bytes} as never,async()=>({state:'FAILED',sha256,reason:'ARCHIVE_IO_FAILED'}));
  expect(query.mock.calls[3][0]).toContain("state=CASE");
  expect(query.mock.calls.every(call=>!/INSERT INTO (result_release|job_outbox|p6_transfer)/i.test(call[0]))).toBe(true);
 });
});
