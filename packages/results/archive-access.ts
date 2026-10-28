import type {Queryable} from '../db/connection';
import {assertSession,LabError,need,uuid,type Staff} from '../lab/core';
import {authorize,type ResourceScope} from '../security/policy';

/** Return no storage details and apply report and case authorization to the exact version. */
export async function readArchiveStatus(db:Queryable,user:Staff,versionId:string){
 await assertSession(db,user);need(user,'result.review','read');
 const row=(await db.query<{case_id:string;registration_origin:ResourceScope['origin'];unit_id:string|null;state:string|null}>(`
  SELECT r.case_id,c.registration_origin,
   (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id,j.state
  FROM result_report_version v JOIN result_release r ON r.version_id=v.id AND r.case_id=v.case_id AND r.round_id=v.round_id
  JOIN nipt_case c ON c.id=r.case_id LEFT JOIN pdf_archive_job j ON j.release_id=r.id AND j.version_id=v.id AND j.case_id=c.id
  WHERE v.id=$1 AND r.state='Active'`,[uuid.parse(versionId)])).rows[0];
 const scope={unitId:row?.unit_id??undefined,origin:row?.registration_origin};
 if(!row||!authorize(user,'case.read',scope,'read')||!authorize(user,'result.read.released',scope,'read'))throw new LabError('NOT_FOUND',404);
 return {state:row.state};
}
