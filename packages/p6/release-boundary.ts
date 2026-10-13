import {z} from 'zod';
import type {Queryable} from '../db/connection';

/** No fixture fallback. Even future P5 authority is insufficient without a separately approved
 * outbound release/channel contract and AL-6. This function never enrolls, reserves or writes files. */
export async function readClinicalOutboundCandidate(db:Queryable,releaseId:string):Promise<never> {
  z.uuid().parse(releaseId);
  let authorized:boolean;
  try {
    const rows=await db.query<{authorized:boolean}>('SELECT p5_release_authorized() AS authorized');
    authorized=rows.rows[0]?.authorized===true;
  } catch {throw Error('P6_RELEASE_AUTHORITY_UNAVAILABLE');}
  if(!authorized)throw Error('P6_CLINICAL_RELEASE_HOLD_AL5');
  let release:Record<string,unknown>|undefined;
  try {release=(await db.query('SELECT id,version_id,case_id,round_id,kind,channel,epoch,state,certified_by,certified_at FROM result_release WHERE id=$1',[releaseId])).rows[0];}
  catch {throw Error('P6_RELEASE_AUTHORITY_UNAVAILABLE');}
  if(!release||release.state!=='Active')throw Error('P6_ACTIVE_RELEASE_REQUIRED');
  if(release.channel==='NIPT_ANC_VIEW')throw Error('P6_ANC_VIEW_IS_NOT_OUTBOUND_AUTHORITY');
  throw Error('P6_OUTBOUND_CONTRACT_HOLD_AL6');
}
