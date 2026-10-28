import {describe,it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {resolveArchiveSource} from '../../packages/results/archive-source';

describe('archive source resolution',()=>{
 it('uses the database release, report version and asset identity and verifies the stored bytes',async()=>{
  const bytes=Buffer.from('%PDF-1.7 synthetic');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const releaseId=randomUUID(),caseId=randomUUID(),versionId=randomUUID();
  const query=vi.fn().mockResolvedValue({rows:[{release_id:releaseId,case_id:caseId,version_id:versionId,sha256,byte_size:bytes.length,media_type:'application/pdf'}]});
  const get=vi.fn().mockResolvedValue(bytes);
  const result=await resolveArchiveSource({query} as never,{get} as never,releaseId);
  expect(result).toEqual({releaseId,caseId,versionId,sha256,bytes});
  expect(get).toHaveBeenCalledWith(sha256);
  expect(query.mock.calls[0][0]).toMatch(/result_release[\s\S]*result_report_version[\s\S]*file_asset/);
 });
 it('rejects missing or mismatched source bytes and non-PDF assets',async()=>{
  const bytes=Buffer.from('synthetic'),sha256=createHash('sha256').update(bytes).digest('hex');
  const row={release_id:randomUUID(),case_id:randomUUID(),version_id:randomUUID(),sha256,byte_size:bytes.length,media_type:'application/pdf'};
  const db={query:vi.fn().mockResolvedValue({rows:[row]})};
  await expect(resolveArchiveSource(db as never,{get:async()=>Buffer.from('wrong')} as never,row.release_id)).rejects.toThrow('ARCHIVE_SOURCE_INTEGRITY_FAILED');
  db.query.mockResolvedValue({rows:[{...row,media_type:'text/plain'}]});
  await expect(resolveArchiveSource(db as never,{get:async()=>bytes} as never,row.release_id)).rejects.toThrow('ARCHIVE_SOURCE_NOT_PDF');
  db.query.mockResolvedValue({rows:[]});
  await expect(resolveArchiveSource(db as never,{get:async()=>bytes} as never,row.release_id)).rejects.toThrow('ARCHIVE_SOURCE_NOT_FOUND');
 });
});
