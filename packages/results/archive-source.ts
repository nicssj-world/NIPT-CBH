import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';

type SourceRow={release_id:string;case_id:string;version_id:string;sha256:string;byte_size:string|number;media_type:string};

/** Resolve the source through the certified release, never through an uploaded filename. */
export async function resolveArchiveSource(db:Queryable,store:Pick<FileStore,'get'>,releaseId:string){
 const result=await db.query<SourceRow>(`SELECT r.id release_id,r.case_id,v.id version_id,a.sha256,a.byte_size,a.media_type
 FROM result_release r JOIN result_report_version v ON v.id=r.version_id AND v.case_id=r.case_id AND v.round_id=r.round_id
 JOIN file_asset a ON a.sha256=v.sha256 WHERE r.id=$1`,[releaseId]);
 const row=result.rows[0];
 if(!row)throw Error('ARCHIVE_SOURCE_NOT_FOUND');
 if(row.media_type!=='application/pdf')throw Error('ARCHIVE_SOURCE_NOT_PDF');
 const bytes=await store.get(row.sha256);
 if(bytes.length!==Number(row.byte_size)||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('ARCHIVE_SOURCE_INTEGRITY_FAILED');
 return {releaseId:row.release_id,caseId:row.case_id,versionId:row.version_id,sha256:row.sha256,bytes};
}
