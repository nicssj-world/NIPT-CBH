import type {Queryable} from '../db/connection';

export type PetFileRow={
 id:string;state:string;errorCode:string|null;dayFolder:string|null;pathVersion:number|null;byteSize:number|null;
 sha256Prefix:string|null;sightings:number;discoveredAt:string;processedAt:string|null;roundNumber:number|null;verifiedReceipt:boolean;
};
export type PetRoundRow={roundId:string;roundNumber:number;state:string;receivedSource:string|null;receivedAt:string|null;
 files:number;verifiedHisReceipt:boolean};
/** Four counts that are NOT interchangeable. Each is read from existing immutable records, never inferred. */
export type CasePetEvidence={
 evidence:'PRESENT'|'NONE';
 counts:{
  /** PET files the intake recorded for this case (one per discovered path+content). */
  petFiles:number;
  /** Distinct file contents (SHA-256) among them; resends of identical content do not add a version. */
  distinctContents:number;
  /** Times identical bytes were seen again at another path or time (recorded as a source sighting, never a new version). */
  resendSightings:number;
  /** Rounds with a verified HIS receipt (his_order exists for the round). */
  verifiedHisReceipts:number;
  /** Specimen rounds (S1, S2, …) — a physical recollection, not a scan or a file. */
  specimenRounds:number;
 };
 /** Scan executions cannot be attributed to one case (a scan covers a whole folder). */
 scanExecutions:'NOT_ATTRIBUTABLE_TO_CASE';
 rounds:PetRoundRow[];files:PetFileRow[];
};

/** Read-only provenance for one case. The caller has already authorised access to the case. */
export async function readCasePetEvidence(db:Queryable,caseId:string):Promise<CasePetEvidence>{
 const files=(await db.query<{
  id:string;state:string;error_code:string|null;day_folder:string|null;path_version:number|null;byte_size:number|null;
  sha256:string|null;sightings:number;discovered_at:Date;processed_at:Date|null;round_number:number|null;verified:boolean}>(
  `SELECT f.id,f.state,f.error_code,split_part(f.source_path,'/',2) day_folder,f.path_version,f.byte_size,
    (SELECT s.sha256 FROM his_inbound_source s WHERE s.inbound_file_id=f.id ORDER BY s.first_seen_at LIMIT 1) sha256,
    (SELECT count(*)::int FROM his_inbound_source s WHERE s.inbound_file_id=f.id) sightings,
    f.discovered_at,f.processed_at,r.round_number,(o.id IS NOT NULL) verified
   FROM his_inbound_file f
   LEFT JOIN his_order o ON o.inbound_file_id=f.id
   LEFT JOIN specimen_round r ON r.id=o.round_id
   WHERE f.case_id=$1 AND f.source_path IS NOT NULL
   ORDER BY f.discovered_at,f.id`,[caseId])).rows;
 const rounds=(await db.query<{id:string;round_number:number;state:string;received_source:string|null;received_at:Date|null;verified:boolean}>(
  `SELECT r.id,r.round_number,r.state,r.received_source,r.received_at,EXISTS(SELECT 1 FROM his_order o WHERE o.round_id=r.id) verified
   FROM specimen_round_current r WHERE r.case_id=$1 ORDER BY r.round_number,r.id`,[caseId])).rows;
 const perRound=new Map<number,number>();
 for(const f of files)if(f.round_number!==null)perRound.set(f.round_number,(perRound.get(f.round_number)??0)+1);
 const iso=(d:Date|null)=>d?new Date(d).toISOString():null;
 return {
  evidence:files.length?'PRESENT':'NONE',
  counts:{
   petFiles:files.length,
   distinctContents:new Set(files.map(f=>f.sha256).filter(Boolean)).size,
   resendSightings:files.reduce((n,x)=>n+Math.max(0,x.sightings-1),0),
   verifiedHisReceipts:rounds.filter(r=>r.verified).length,
   specimenRounds:rounds.length
  },
  scanExecutions:'NOT_ATTRIBUTABLE_TO_CASE',
  rounds:rounds.map(r=>({roundId:r.id,roundNumber:r.round_number,state:r.state,receivedSource:r.received_source,receivedAt:iso(r.received_at),
   files:perRound.get(r.round_number)??0,verifiedHisReceipt:r.verified})),
  files:files.map(f=>({id:f.id,state:f.state,errorCode:f.error_code,dayFolder:f.day_folder,pathVersion:f.path_version,byteSize:f.byte_size,
   sha256Prefix:f.sha256?f.sha256.slice(0,12):null,sightings:f.sightings,discoveredAt:iso(f.discovered_at)!,processedAt:iso(f.processed_at),roundNumber:f.round_number,verifiedReceipt:f.verified}))
 };
}
