import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {assertSession,need,uuid,reasonText,LabError,audit,type Staff} from '../lab/core';
import {lockBatch} from '../lab/batch';
import {operationalWorkflow} from '../lab/operational';
import {storedPool} from '../sequencing/service';
import {fixtureMember} from '../sequencing/schemas';
import {generateHalosWorkbook,verifyHalosWorkbook,type OperationalHalosInput} from '../halos-export/workbook';
import {digest} from './calculation';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export type HalosExport={id:string;pool_snapshot_id:string;dnb_date:string;file_sha256:string;source:OperationalHalosInput;manifest:Record<string,unknown>;revision:number};
/** Accepted Pool -> real vendor XLSX. Generation/readback never asserts that a device imported it. */
export async function exportAcceptedPool(db:Queryable,user:Staff,input:unknown,store:FileStore){
 await assertSession(db,user);need(user,'handoff.create');if(!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423);
 const d=z.strictObject({batchId:uuid,poolSnapshotId:uuid,expectedVersion:z.number().int().nonnegative(),dnbDate:z.iso.date(),mappingReference:reasonText,members:z.array(fixtureMember).length(47)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion),{snapshot,p}=await storedPool(db,b.id,d.poolSnapshotId);
 if(snapshot.payload.acceptance!=='Accepted'||snapshot.payload.synthetic)throw new LabError('POOL_ACCEPTED_REQUIRED',409);
 if(snapshot.payload.members.length!==47)throw new LabError('MAPPING_UNAVAILABLE_PARTIAL_SOURCE',409);
 for(const m of d.members){const actual=snapshot.payload.members.find(s=>s.slot===m.physicalPosition);
  if(!actual||m.memberKey!==(actual.attemptId??`${actual.kind}:${actual.slot}`)||m.role!==actual.kind||m.printedSampleId!==(actual.printedSampleId??actual.printedControlId)||m.role==='PATIENT'&&m.lnHalos!==actual.lnHalos)throw new LabError('MAPPING_SOURCE_IDENTITY_MISMATCH',409);
 }
 const revision=(await db.query<{n:number}>('SELECT COALESCE(max(revision),0)+1 n FROM p4b_halos_export WHERE pool_snapshot_id=$1',[snapshot.id])).rows[0].n;
 const source:OperationalHalosInput={batch:{id:b.id,revision:b.version||1,sha256:p.sha256},placement:{id:digest(snapshot.payload.placements),revision:1,sha256:digest(snapshot.payload.placements)},pool:{id:snapshot.id,revision:snapshot.revision,sha256:snapshot.sha256},dnb:{id:`DNB${d.dnbDate.replaceAll('-','')}`,workDate:d.dnbDate,dateBasis:'intended'},mapping:{id:d.mappingReference,revision,sha256:digest(d.members)},excludedBlank:{physicalPosition:40,role:'BLANK'},members:d.members};
 const generated=generateHalosWorkbook(source),manifest=verifyHalosWorkbook(source,generated.bytes),fileHash=await store.put(generated.bytes);
 const row=(await db.query<{id:string}>(`INSERT INTO p4b_halos_export(pool_snapshot_id,revision,dnb_date,file_sha256,source,manifest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[snapshot.id,revision,d.dnbDate,fileHash,JSON.stringify(source),JSON.stringify(manifest),user.id])).rows[0];
 await audit(db,user,'HALOS_XLSX_EXPORTED','p4b_halos_export',row.id,{outcome:'EXPORTED_READBACK_VALIDATED',count:47});
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[b.id]);
 return {...row,bytes:generated.bytes,fileHash,manifest};
}
export async function verifyOperationalHalos(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'handoff.verify');if(!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423);
 const d=z.strictObject({batchId:uuid,exportId:uuid,expectedVersion:z.number().int().nonnegative(),fileHash:hash,observedDnbId:z.string(),observedRows:z.array(fixtureMember).length(47),evidenceReference:reasonText,evidenceHash:hash}).parse(input);
 await lockBatch(db,d.batchId,d.expectedVersion);
 const e=(await db.query<HalosExport>('SELECT *,dnb_date::text FROM p4b_halos_export WHERE id=$1',[d.exportId])).rows[0];if(!e)throw new LabError('NOT_FOUND',404);
 await storedPool(db,d.batchId,e.pool_snapshot_id);
 const latest=(await db.query<{id:string}>('SELECT id FROM p4b_halos_export WHERE pool_snapshot_id=$1 ORDER BY revision DESC LIMIT 1',[e.pool_snapshot_id])).rows[0];
 if(latest.id!==e.id)throw new LabError('HANDOFF_NOT_CURRENT',409);
 if(e.file_sha256!==d.fileHash||e.source.dnb.id!==d.observedDnbId||digest(e.source.members)!==digest(d.observedRows))throw new LabError('HANDOFF_EXACT_MATCH_REQUIRED',409);
 const row=(await db.query<{id:string}>('INSERT INTO p4b_halos_verification(export_id,observed,evidence_reference,evidence_hash,reviewer_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[e.id,JSON.stringify(d),d.evidenceReference,d.evidenceHash,user.id])).rows[0];
 await audit(db,user,'HALOS_IMPORT_REVIEWED','p4b_halos_verification',row.id,{outcome:'MATCH'});
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[d.batchId]);return row;
}
export async function operationalHalos(db:Queryable,dnbId:string){return (await db.query<HalosExport>(`SELECT e.*,e.dnb_date::text FROM p4b_halos_export e JOIN p4c_dnb_attempt d ON d.pool_snapshot_id=e.pool_snapshot_id AND d.actual_date=e.dnb_date WHERE d.id=$1 ORDER BY e.revision DESC LIMIT 1`,[dnbId])).rows[0]??null;}
