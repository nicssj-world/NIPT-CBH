import {createHash} from 'node:crypto';
import {z} from 'zod';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,audit,LabError,type Staff} from './core';
import {authorize} from '../security/policy';
import {buildStorageSampleLabel} from './storage-label';

export const STORAGE_TYPES=['BACKUP','BUFFY_COAT'] as const;
export type StorageType=typeof STORAGE_TYPES[number];
export type StorageBoxType=StorageType|'LEGACY_UNCLASSIFIED';
export const storagePosition=(slot:number)=>`${'ABCDEFGHI'[(slot-1)%9]}${Math.floor((slot-1)/9)+1}`;

const typeSchema=z.enum(STORAGE_TYPES);
const boxFilterSchema=z.enum(['ALL',...STORAGE_TYPES]).default('ALL');
const BOX_LABEL:Record<StorageBoxType,string>={BACKUP:'Backup Box',BUFFY_COAT:'Buffy Coat Box',LEGACY_UNCLASSIFIED:'Legacy Unclassified Box'};

function accessScope(user:Staff,values:unknown[]){
 const alternatives:string[]=[];
 for(const origin of ['ANC','LAB_DIRECT'] as const){
  const probe='00000000-0000-4000-8000-000000000000';
  if(authorize(user,'case.read',{unitId:probe,origin},'read')){alternatives.push(`c.registration_origin='${origin}'`);continue;}
  const units=user.unitIds.filter(unitId=>authorize(user,'case.read',{unitId,origin},'read'));
  if(units.length){values.push(units);alternatives.push(`(c.registration_origin='${origin}' AND EXISTS(SELECT 1 FROM case_unit_scope scope WHERE scope.case_id=c.id AND scope.unit_id=ANY($${values.length}::uuid[])))`);}
 }
 return alternatives.length?`(${alternatives.join(' OR ')})`:'false';
}

/** Uses the issued LN Halos and existing specimen display rules; `-3` is only the Backup storage identity. */
function sampleSource(scope:string){return `WITH received_samples AS (
 SELECT r.id round_id,r.case_id,c.registration_origin,l.ln,i.hn,n.ln_halos,
  (n.original_round_id IS NOT NULL) is_resampling,r.round_number,r.received_at,r.received_source,
  CASE WHEN r.received_source='HIS_PET_RECEIPT' THEN r.received_at + interval '3 years' END retention_due_at,r.state,
  COALESCE(request_pregnancy.pregnancy,lab_registration.pregnancy) pregnancy
 FROM specimen_round_current r
 JOIN nipt_case c ON c.id=r.case_id
 JOIN case_ln l ON l.id=r.case_ln_id
 LEFT JOIN p2_case_identity i ON i.case_id=c.id
 JOIN specimen_lab_number n ON n.round_id=r.id
 LEFT JOIN LATERAL (
  SELECT source.pregnancy FROM (
   SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'type' pregnancy
    FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='REQUEST'
   UNION ALL
   SELECT p.created_at,p.panel->>'pregnancyType' pregnancy
    FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='REQUEST' AND p.status='Verified'
  ) source WHERE source.pregnancy IN ('Singleton','Twins') ORDER BY source.created_at DESC LIMIT 1
 ) request_pregnancy ON true
 LEFT JOIN LATERAL (
  SELECT lr.pregnancy::text pregnancy FROM lab_operational_registration lr
   WHERE lr.case_id=c.id AND (lr.round_id=r.id OR lr.round_id IS NULL)
   ORDER BY (lr.round_id=r.id) DESC,lr.created_at DESC LIMIT 1
 ) lab_registration ON true
 WHERE r.received_at IS NOT NULL AND r.received_source IS NOT NULL
  AND c.registration_origin<>'HISTORICAL' AND n.ln_halos IS NOT NULL AND ${scope}
), sample_labels AS (
 SELECT received_samples.*,
  ln_halos||CASE WHEN pregnancy='Twins' THEN 'D' ELSE '' END||CASE WHEN is_resampling THEN 'R' ELSE '' END display_code
 FROM received_samples
)`;
}

function sampleRowsCte(scope:string){return `${sampleSource(scope)}, sample_rows AS (
 SELECT s.round_id,s.ln,s.hn,s.ln_halos,s.round_number,s.received_at,s.received_source,s.retention_due_at,t.storage_type,
  s.display_code||CASE WHEN t.storage_type='BACKUP' THEN '-3' ELSE '' END storage_label,
  b.id box_uuid,b.box_id,p.slot,(p.id IS NULL) waiting
 FROM sample_labels s CROSS JOIN (VALUES('BUFFY_COAT'::text),('BACKUP'::text)) t(storage_type)
 LEFT JOIN lab_storage_typed_position p ON p.round_id=s.round_id AND p.storage_type=t.storage_type
 LEFT JOIN lab_storage_box b ON b.id=p.box_id
 LEFT JOIN lab_storage_position legacy ON legacy.round_id=s.round_id
 WHERE p.id IS NOT NULL OR (s.state<>'Cancelled' AND legacy.id IS NULL)
 UNION ALL
 SELECT r.id round_id,l.ln,i.hn,n.ln_halos,r.round_number,r.received_at,NULL::text received_source,NULL::timestamptz retention_due_at,'LEGACY_UNCLASSIFIED'::text storage_type,
  NULL::text storage_label,b.id box_uuid,b.box_id,p.slot,false waiting
 FROM lab_storage_position p JOIN lab_storage_box b ON b.id=p.box_id
 JOIN specimen_round_current r ON r.id=p.round_id JOIN nipt_case c ON c.id=r.case_id
 JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN p2_case_identity i ON i.case_id=c.id
 LEFT JOIN specimen_lab_number n ON n.round_id=r.id
 WHERE ${scope}
)`;
}

type StorageRow={round_id:string;ln:string;hn:string|null;ln_halos:string|null;round_number:number;received_at:Date|null;received_source:string|null;retention_due_at:Date|null;storage_type:StorageBoxType;storage_label:string|null;box_uuid:string|null;box_id:string|null;slot:number|null;waiting:boolean};
type BoxRow={id:string;box_id:string;box_type:StorageBoxType;used:number;next_slot:number|null};
type GridCell={slot:number;position:string;occupied:boolean;roundId:string|null;roundNumber:number|null;ln:string|null;hn:string|null;lnHalos:string|null;receivedAt:string|null;retentionDueAt:string|null;retentionVerified:boolean;storageType:StorageBoxType;storageLabel:string|null};
function exposeRow(row:StorageRow){return {roundId:row.round_id,ln:row.ln,hn:row.hn,lnHalos:row.ln_halos,roundNumber:row.round_number,receivedAt:row.received_at?.toISOString()??null,retentionDueAt:row.retention_due_at?.toISOString()??null,retentionVerified:row.received_source==='HIS_PET_RECEIPT',storageType:row.storage_type,storageLabel:row.storage_label,boxUuid:row.box_uuid,boxId:row.box_id,slot:row.slot,position:row.slot?storagePosition(row.slot):null,waiting:row.waiting};}

const BOX_PAGE_SIZE=50;
type BoxPage={rows:{id:string;boxId:string;boxType:StorageBoxType;used:number;available:number;nextSlot:number|null;status:string}[];total:number;page:number;totalPages:number;inUse:number};
async function visibleBoxes(db:Queryable,boxType:'ALL'|StorageType,query:string,requestedPage:number):Promise<BoxPage>{
 const filter=`($1='ALL' OR b.box_type=$1) AND ($2='' OR strpos(lower(b.box_id),lower($2))>0)`;
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM lab_storage_box b WHERE ${filter}`,[boxType,query])).rows[0]?.n??0);
 const inUse=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM lab_storage_box b WHERE ${filter} AND (
  EXISTS(SELECT 1 FROM lab_storage_typed_position p WHERE p.box_id=b.id)
  OR EXISTS(SELECT 1 FROM lab_storage_position p WHERE p.box_id=b.id))`,[boxType,query])).rows[0]?.n??0);
 const page=Math.min(requestedPage,Math.max(1,Math.ceil(total/BOX_PAGE_SIZE)));
 const rows=(await db.query<BoxRow>(`SELECT b.id,b.box_id,b.box_type,COALESCE(count(pos.slot),0)::int used,
  (SELECT candidate.slot FROM generate_series(1,81) candidate(slot)
   WHERE NOT EXISTS(SELECT 1 FROM (
    SELECT p.box_id,p.slot FROM lab_storage_typed_position p
    UNION ALL SELECT p.box_id,p.slot FROM lab_storage_position p
   ) occupied WHERE occupied.box_id=b.id AND occupied.slot=candidate.slot)
   ORDER BY candidate.slot LIMIT 1)::int next_slot
 FROM lab_storage_box b LEFT JOIN (
  SELECT p.box_id,p.slot FROM lab_storage_typed_position p
  UNION ALL SELECT p.box_id,p.slot FROM lab_storage_position p
 ) pos ON pos.box_id=b.id
 WHERE ${filter}
 GROUP BY b.id,b.box_id,b.box_type,b.box_number ORDER BY b.box_number DESC LIMIT $3 OFFSET $4`,[boxType,query,BOX_PAGE_SIZE,(page-1)*BOX_PAGE_SIZE])).rows;
 return {rows:rows.map(b=>({id:b.id,boxId:b.box_id,boxType:b.box_type,used:b.used,available:Math.max(0,81-b.used),nextSlot:b.next_slot,status:b.used>=81?'FULL':b.used>0?'IN_USE':'EMPTY'})),total,page,totalPages:Math.max(1,Math.ceil(total/BOX_PAGE_SIZE)),inUse};
}

async function summaryCounts(db:Queryable,user:Staff){
 const values:unknown[]=[],scope=accessScope(user,values);
 const typeRows=(await db.query<{storage_type:StorageType;waiting:number;stored:number}>(`${sampleSource(scope)}, counts AS (
  SELECT t.storage_type,
   count(*) FILTER(WHERE p.id IS NULL AND legacy.id IS NULL AND s.state<>'Cancelled')::int waiting,
   count(p.id)::int stored
  FROM sample_labels s CROSS JOIN (VALUES('BACKUP'::text),('BUFFY_COAT'::text)) t(storage_type)
  LEFT JOIN lab_storage_typed_position p ON p.round_id=s.round_id AND p.storage_type=t.storage_type
  LEFT JOIN lab_storage_position legacy ON legacy.round_id=s.round_id
  GROUP BY t.storage_type
 ) SELECT storage_type,waiting,stored FROM counts`,values)).rows;
 const physical=(await db.query<{storage_type:StorageType;n:number}>('SELECT storage_type,count(*)::int n FROM lab_storage_typed_position GROUP BY storage_type')).rows;
 const legacy=(await db.query<{n:number}>('SELECT count(*)::int n FROM lab_storage_position')).rows[0]?.n??0;
 const backup=typeRows.find(x=>x.storage_type==='BACKUP'),buffy=typeRows.find(x=>x.storage_type==='BUFFY_COAT');
 return {waitingBackup:backup?.waiting??0,waitingBuffy:buffy?.waiting??0,storedBackup:physical.find(x=>x.storage_type==='BACKUP')?.n??0,storedBuffy:physical.find(x=>x.storage_type==='BUFFY_COAT')?.n??0,legacyStored:legacy};
}

export async function storageSearch(db:Queryable,user:Staff,raw:unknown){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const d=z.strictObject({q:z.string().trim().max(80).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),boxType:boxFilterSchema,activeBoxId:uuid.optional(),boxQuery:z.string().trim().max(80).default(''),boxPage:z.coerce.number().int().min(1).max(100000).default(1)}).parse(raw);
 const values:unknown[]=[],scope=accessScope(user,values),typeParam=values.length+1;values.push(d.boxType);const queryParam=values.length+1;values.push(d.q);
 const where=`($${typeParam}='ALL' OR result.storage_type=$${typeParam}) AND ($${queryParam}<>'' OR result.waiting) AND ($${queryParam}='' OR strpos(lower(result.ln),lower($${queryParam}))>0 OR strpos(lower(coalesce(result.hn,'')),lower($${queryParam}))>0 OR strpos(lower(coalesce(result.ln_halos,'')),lower($${queryParam}))>0 OR strpos(lower(coalesce(result.storage_label,'')),lower($${queryParam}))>0 OR strpos(lower(coalesce(result.box_id,'')),lower($${queryParam}))>0)`;
 const cte=sampleRowsCte(scope);
 const total=Number((await db.query<{n:string}>(`${cte} SELECT count(*)::text n FROM sample_rows result WHERE ${where}`,[...values])).rows[0].n);
 const page=Math.min(d.page,Math.max(1,Math.ceil(total/25))),limitParam=values.length+1,offsetParam=values.length+2;
 const rows=(await db.query<StorageRow>(`${cte} SELECT result.* FROM sample_rows result WHERE ${where}
  ORDER BY result.waiting DESC,result.received_at ASC NULLS LAST,result.storage_type,result.round_id LIMIT $${limitParam} OFFSET $${offsetParam}`,[...values,25,(page-1)*25])).rows;
 const boxPage=await visibleBoxes(db,d.boxType,d.boxQuery,d.boxPage),boxes=boxPage.rows;
 const summary=await summaryCounts(db,user);
 let activeBox:null|{id:string;boxId:string;boxType:StorageBoxType;used:number;available:number;nextSlot:number|null;status:string;grid:GridCell[]}=null;
 if(d.activeBoxId){
  const selected=(await db.query<{id:string;box_id:string;box_type:StorageBoxType}>(`SELECT id,box_id,box_type FROM lab_storage_box WHERE id=$1 AND ($2='ALL' OR box_type=$2)`,[d.activeBoxId,d.boxType])).rows[0];
  if(selected){
   const grid:GridCell[]=Array.from({length:81},(_,i)=>({slot:i+1,position:storagePosition(i+1),occupied:false,roundId:null,roundNumber:null,ln:null,hn:null,lnHalos:null,receivedAt:null,retentionDueAt:null,retentionVerified:false,storageType:selected.box_type,storageLabel:null}));
   const physical=(await db.query<{slot:number;storage_type:StorageBoxType}>(`SELECT slot,storage_type FROM lab_storage_typed_position WHERE box_id=$1
    UNION ALL SELECT slot,'LEGACY_UNCLASSIFIED'::text storage_type FROM lab_storage_position WHERE box_id=$1`,[selected.id])).rows;
   for(const row of physical){if(!row.slot)continue;grid[row.slot-1]={...grid[row.slot-1],occupied:true,storageType:row.storage_type};}
   const gridValues:unknown[]=[],gridScope=accessScope(user,gridValues),boxParam=gridValues.length+1;gridValues.push(selected.id);
   const visible=(await db.query<StorageRow>(`${sampleRowsCte(gridScope)} SELECT result.* FROM sample_rows result WHERE result.box_uuid=$${boxParam}`,[...gridValues])).rows;
   for(const row of visible){if(!row.slot)continue;grid[row.slot-1]={slot:row.slot,position:storagePosition(row.slot),occupied:true,roundId:row.round_id,roundNumber:row.round_number,ln:row.ln,hn:row.hn,lnHalos:row.ln_halos,receivedAt:row.received_at?.toISOString()??null,retentionDueAt:row.retention_due_at?.toISOString()??null,retentionVerified:row.received_source==='HIS_PET_RECEIPT',storageType:row.storage_type,storageLabel:row.storage_label};}
   const used=physical.length,nextSlot=Array.from({length:81},(_,i)=>i+1).find(slot=>!grid[slot-1].occupied)??null;
   activeBox={id:selected.id,boxId:selected.box_id,boxType:selected.box_type,used,available:Math.max(0,81-used),nextSlot,status:used>=81?'FULL':used>0?'IN_USE':'EMPTY',grid};
  }
 }
 return {rows:rows.map(exposeRow),boxes,boxTotal:boxPage.total,boxPage:boxPage.page,boxTotalPages:boxPage.totalPages,boxInUse:boxPage.inUse,activeBox,summary,page,total,totalPages:Math.max(1,Math.ceil(total/25))};
}

type PlanRow={round_id:string;ln:string;hn:string|null;ln_halos:string;round_number:number;received_at:Date;display_code:string;storage_label:string};
const AUTOFILL_BATCH_SIZE=10000;
async function autoFillPlan(db:Queryable,user:Staff,storageType:StorageType,selectedRoundIds?:string[]){
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432832))',[`sample-storage:${storageType}`]);
 const values:unknown[]=[],scope=accessScope(user,values);
 const typeParam=values.length+1;
 const waiting=Number((await db.query<{n:string}>(`${sampleSource(scope)}, waiting AS (
   SELECT s.round_id FROM sample_labels s
    LEFT JOIN lab_storage_typed_position p ON p.round_id=s.round_id AND p.storage_type=$${typeParam}
    LEFT JOIN lab_storage_position legacy ON legacy.round_id=s.round_id
   WHERE s.state<>'Cancelled' AND p.id IS NULL AND legacy.id IS NULL
  ) SELECT count(*)::text n FROM waiting`,[...values,storageType])).rows[0]?.n??0);
 const selectedParam=typeParam+1;
 const queue=(await db.query<PlanRow>(`${sampleSource(scope)}
  SELECT s.round_id,s.ln,s.hn,s.ln_halos,s.round_number,s.received_at,s.display_code,
   s.display_code||CASE WHEN $${typeParam}='BACKUP' THEN '-3' ELSE '' END storage_label
  FROM sample_labels s LEFT JOIN lab_storage_typed_position p ON p.round_id=s.round_id AND p.storage_type=$${typeParam}
  LEFT JOIN lab_storage_position legacy ON legacy.round_id=s.round_id
  WHERE s.state<>'Cancelled' AND p.id IS NULL AND legacy.id IS NULL
   AND ($${selectedParam}::uuid[] IS NULL OR s.round_id=ANY($${selectedParam}::uuid[]))
  ORDER BY s.received_at ASC,s.round_id ASC LIMIT ${AUTOFILL_BATCH_SIZE}`,[...values,storageType,selectedRoundIds??null])).rows;
 if(selectedRoundIds){
  const selected=new Set(selectedRoundIds);
  if(selected.size!==selectedRoundIds.length)throw new LabError('DUPLICATE_ROW_IN_REQUEST',400);
  if(queue.length!==selected.size)throw new LabError('STORAGE_SAMPLE_NOT_WAITING',409);
 }
 const boxRows=(await db.query<{id:string;box_id:string;box_number:string;slot:number|null}>(`SELECT b.id,b.box_id,b.box_number,occupied.slot
  FROM lab_storage_box b LEFT JOIN (
   SELECT box_id,slot FROM lab_storage_typed_position UNION ALL SELECT box_id,slot FROM lab_storage_position
  ) occupied ON occupied.box_id=b.id
  WHERE b.box_type=$1 ORDER BY b.box_number ASC,occupied.slot ASC`,[storageType])).rows;
 const byBox=new Map<string,{id:string;boxId:string;used:Set<number>}>();
 for(const row of boxRows){let box=byBox.get(row.id);if(!box){box={id:row.id,boxId:row.box_id,used:new Set()};byBox.set(row.id,box);}if(row.slot!==null)box.used.add(row.slot);}
 const placements:{roundId:string;ln:string;hn:string|null;lnHalos:string;roundNumber:number;receivedAt:string;storageType:StorageType;storageLabel:string;boxUuid:string;boxId:string;slot:number;position:string}[]=[];
 for(const sample of queue){
  let assigned=false;
  for(const box of byBox.values()){
   let slot=0;for(let candidate=1;candidate<=81;candidate++)if(!box.used.has(candidate)){slot=candidate;break;}
   if(!slot)continue;
   box.used.add(slot);placements.push({roundId:sample.round_id,ln:sample.ln,hn:sample.hn,lnHalos:sample.ln_halos,roundNumber:sample.round_number,receivedAt:sample.received_at.toISOString(),storageType,storageLabel:sample.storage_label,boxUuid:box.id,boxId:box.boxId,slot,position:storagePosition(slot)});assigned=true;break;
  }
  if(!assigned)break;
 }
 const remaining=selectedRoundIds?0:Math.max(0,waiting-queue.length),planHash=createHash('sha256').update(JSON.stringify({storageType,waiting,selected:queue.map(x=>x.round_id),placements:placements.map(p=>[p.roundId,p.boxUuid,p.slot])})).digest('hex');
 return {storageType,waiting,selected:queue.length,batchSize:AUTOFILL_BATCH_SIZE,remaining,planned:placements.length,unplaced:Math.max(0,queue.length-placements.length),placements,planHash};
}

async function autoFillPlans(db:Queryable,user:Staff,storageTypes:StorageType[],selectedRoundIds?:string[]){
 if(selectedRoundIds&&storageTypes.length!==1)throw new LabError('STORAGE_SELECTION_TYPE_INVALID',400);
 const byType=[];
 for(const storageType of [...storageTypes].sort())byType.push(await autoFillPlan(db,user,storageType,selectedRoundIds));
 const placements=byType.flatMap(plan=>plan.placements);
 const planHash=createHash('sha256').update(JSON.stringify(byType.map(plan=>[plan.storageType,plan.planHash]))).digest('hex');
 return {storageTypes:byType.map(plan=>plan.storageType),waiting:byType.reduce((sum,plan)=>sum+plan.waiting,0),selected:byType.reduce((sum,plan)=>sum+plan.selected,0),batchSize:AUTOFILL_BATCH_SIZE,remaining:byType.reduce((sum,plan)=>sum+plan.remaining,0),planned:placements.length,unplaced:byType.reduce((sum,plan)=>sum+plan.unplaced,0),placements,planHash,byType};
}

async function setPosition(db:Queryable,user:Staff,input:{roundId:string;storageType:StorageType;boxId:string;slot:number;fromBoxId?:string;fromSlot?:number}){
 const values:unknown[]=[input.roundId],scope=accessScope(user,values);
 const visible=(await db.query<{allowed:boolean}>(`${sampleSource(scope)} SELECT EXISTS(SELECT 1 FROM sample_labels WHERE round_id=$1 AND state<>'Cancelled') allowed`,values)).rows[0]?.allowed===true;
 if(!visible)throw new LabError('FORBIDDEN',403);
 try{
  const result=(await db.query<{position_id:string;changed:boolean}>('SELECT * FROM lab_storage_set_position($1,$2,$3,$4,$5,$6,$7)',[input.roundId,input.storageType,input.boxId,input.slot,user.id,input.fromBoxId??null,input.fromSlot??null])).rows[0];
  return result;
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(code.startsWith('STORAGE_'))throw new LabError(code,code==='STORAGE_BOX_NOT_FOUND'?404:409);
  throw error;
 }
}

type CreateBoxResult={id:string;boxId:string;boxType:StorageType};
type PositionResult={id:string;changed:boolean};
type AutoFillPlanResult=Awaited<ReturnType<typeof autoFillPlans>>;
type AutoFillCommitResult={stored:number;storageTypes:StorageType[];placements:{boxId:string;slot:number;position:string}[]};
type StorageCommandResult=CreateBoxResult|PositionResult|AutoFillPlanResult|AutoFillCommitResult;
export function storageCommand(db:Queryable,user:Staff,raw:{action:'createBox';boxType:StorageType}):Promise<CreateBoxResult>;
export function storageCommand(db:Queryable,user:Staff,raw:{action:'place';roundId:string;storageType:StorageType;boxId:string;slot:number}):Promise<PositionResult>;
export function storageCommand(db:Queryable,user:Staff,raw:{action:'move';roundId:string;storageType:StorageType;fromBoxId:string;fromSlot:number;toBoxId:string;toSlot:number}):Promise<PositionResult>;
export function storageCommand(db:Queryable,user:Staff,raw:{action:'autoFillPreview';storageTypes:StorageType[];roundIds?:string[]}):Promise<AutoFillPlanResult>;
export function storageCommand(db:Queryable,user:Staff,raw:{action:'autoFillConfirm';storageTypes:StorageType[];planHash:string;roundIds?:string[]}):Promise<AutoFillCommitResult>;
export function storageCommand(db:Queryable,user:Staff,raw:unknown):Promise<StorageCommandResult>;
export async function storageCommand(db:Queryable,user:Staff,raw:unknown):Promise<StorageCommandResult>{
 await assertSession(db,user);need(user,'batch.assign');
 const command=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('createBox'),boxType:typeSchema}),
  z.strictObject({action:z.literal('place'),roundId:uuid,storageType:typeSchema,boxId:uuid,slot:z.number().int().min(1).max(81)}),
  z.strictObject({action:z.literal('move'),roundId:uuid,storageType:typeSchema,fromBoxId:uuid,fromSlot:z.number().int().min(1).max(81),toBoxId:uuid,toSlot:z.number().int().min(1).max(81)}),
  z.strictObject({action:z.literal('autoFillPreview'),storageTypes:z.array(typeSchema).min(1).max(2).refine(types=>new Set(types).size===types.length),roundIds:z.array(uuid).min(1).max(10000).optional()}).refine(command=>!command.roundIds||command.storageTypes.length===1,'Selected samples must use one storage type'),
  z.strictObject({action:z.literal('autoFillConfirm'),storageTypes:z.array(typeSchema).min(1).max(2).refine(types=>new Set(types).size===types.length),planHash:z.string().regex(/^[a-f0-9]{64}$/),roundIds:z.array(uuid).min(1).max(10000).optional()}).refine(command=>!command.roundIds||command.storageTypes.length===1,'Selected samples must use one storage type')
 ]).parse(raw);
 if(command.action==='createBox'){
  const box=(await db.query<{id:string;box_id:string;box_type:StorageType}>('SELECT * FROM lab_storage_create_box($1,$2)',[command.boxType,user.id])).rows[0];
  await audit(db,user,'LAB_STORAGE_BOX_CREATED','lab_storage_box',box.id,{outcome:'CREATED',origin:box.box_type});
  return {id:box.id,boxId:box.box_id,boxType:box.box_type};
 }
 if(command.action==='autoFillPreview')return autoFillPlans(db,user,command.storageTypes,command.roundIds);
 if(command.action==='autoFillConfirm'){
  const plan=await autoFillPlans(db,user,command.storageTypes,command.roundIds);
  if(plan.planHash!==command.planHash)throw new LabError('STORAGE_PLAN_STALE',409);
  for(const placement of plan.placements)await setPosition(db,user,{roundId:placement.roundId,storageType:placement.storageType,boxId:placement.boxUuid,slot:placement.slot});
  for(const typePlan of plan.byType)if(typePlan.placements.length)await audit(db,user,'LAB_STORAGE_AUTO_FILLED','lab_storage_type',undefined,{outcome:'RECORDED',origin:typePlan.storageType,count:typePlan.placements.length});
  return {stored:plan.placements.length,storageTypes:plan.storageTypes,placements:plan.placements.map(p=>({boxId:p.boxId,slot:p.slot,position:p.position}))};
 }
 const result=command.action==='place'
  ?await setPosition(db,user,{roundId:command.roundId,storageType:command.storageType,boxId:command.boxId,slot:command.slot})
  :await setPosition(db,user,{roundId:command.roundId,storageType:command.storageType,boxId:command.toBoxId,slot:command.toSlot,fromBoxId:command.fromBoxId,fromSlot:command.fromSlot});
 if(result.changed)await audit(db,user,command.action==='place'?'LAB_SAMPLE_STORED':'LAB_SAMPLE_MOVED','lab_storage_typed_position',result.position_id,{outcome:'RECORDED',origin:command.storageType});
 return {id:result.position_id,changed:result.changed};
}

export async function storageLabel(db:Queryable,user:Staff,boxId:string){
 await assertSession(db,user);need(user,'label.print');
 const box=(await db.query<{id:string;box_id:string;box_type:StorageBoxType}>('SELECT id,box_id,box_type FROM lab_storage_box WHERE id=$1',[uuid.parse(boxId)])).rows[0];
 if(!box)throw new LabError('NOT_FOUND',404);
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([300,145]);
 page.drawText('NIPT-CBH / Sample Storage',{x:18,y:108,size:13,font});
 page.drawText(box.box_id,{x:18,y:66,size:27,font});
 page.drawText(BOX_LABEL[box.box_type],{x:18,y:32,size:16,font});
 await audit(db,user,'LAB_STORAGE_LABEL_PRINTED','lab_storage_box',box.id,{outcome:'ORIGINAL_OR_REPRINT',origin:box.box_type});
 return Buffer.from(await pdf.save());
}

export async function storageSampleLabel(db:Queryable,user:Staff,raw:{roundId:string;storageType:StorageType}|unknown){
 await assertSession(db,user);need(user,'label.print');
 const input=z.strictObject({roundId:uuid,storageType:typeSchema}).parse(raw);
 const values:unknown[]=[],scope=accessScope(user,values),roundParam=values.length+1,typeParam=values.length+2;
 values.push(input.roundId,input.storageType);
 const row=(await db.query<StorageRow>(`${sampleRowsCte(scope)} SELECT result.* FROM sample_rows result
  WHERE result.round_id=$${roundParam} AND result.storage_type=$${typeParam}`,[...values])).rows[0];
 if(!row?.storage_label||row.storage_type==='LEGACY_UNCLASSIFIED')throw new LabError('NOT_FOUND',404);
 let pdf:Buffer;
 try{pdf=await buildStorageSampleLabel({storageLabel:row.storage_label,ln:row.ln,storageType:input.storageType});}
 catch(error){throw new LabError(error instanceof Error?error.message:'STORAGE_LABEL_INVALID',409);}
 await audit(db,user,'LAB_STORAGE_SAMPLE_LABEL_PRINTED','specimen_round',row.round_id,{outcome:'ORIGINAL_OR_REPRINT',origin:input.storageType});
 return pdf;
}
