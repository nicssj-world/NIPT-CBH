import type {Queryable} from '../db/connection';

export type CurrentPatient={name:string|null;dob:string|null;source:'HIS_PET_RECEIPT'|'ANC';inboundFileId:string|null;roundId:string|null};

/** Current demographics are a read projection of an applied, identity-matched PET.
 * Never overlay the clinical workspace: signed documents retain their original patient snapshot.
 * Use the most recent applied round, including while a later redraw is still Expected. */
export const currentPetPatientJoin=`LEFT JOIN LATERAL (
 SELECT NULLIF(btrim(f.parsed->>'name'),'') AS name,left(f.parsed->>'dob',10) AS dob,
 f.id AS inbound_file_id,pr.id AS round_id
 FROM his_order_current po JOIN case_ln pl ON pl.id=po.case_ln_id
 JOIN specimen_round_current pr ON pr.id=po.round_id AND pr.case_id=pl.case_id
 JOIN his_inbound_file_current f ON f.id=po.inbound_file_id
 WHERE pl.case_id=c.id AND pl.verification='VERIFIED_BY_PET'
 AND f.parsed->>'ln'=pl.ln AND f.parsed->>'hn'=i.hn
 AND pr.received_source='HIS_PET_RECEIPT'
 ORDER BY pr.round_number DESC,po.his_received_at DESC,f.id DESC LIMIT 1
) pet_patient ON true`;

export async function currentPatient(db:Queryable,caseId:string):Promise<CurrentPatient>{
 const row=(await db.query<CurrentPatient>(`SELECT
 CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.name ELSE anc_patient.name END name,
 CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.dob ELSE anc_patient.dob END dob,
 CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN 'HIS_PET_RECEIPT' ELSE 'ANC' END source,
 pet_patient.inbound_file_id AS "inboundFileId",pet_patient.round_id AS "roundId"
 FROM nipt_case c LEFT JOIN p2_case_identity i ON i.case_id=c.id
 ${currentPetPatientJoin}
 LEFT JOIN LATERAL anc_workspace_patient(c.id) anc_patient ON true WHERE c.id=$1`,[caseId])).rows[0];
 return row??{name:null,dob:null,source:'ANC',inboundFileId:null,roundId:null};
}
