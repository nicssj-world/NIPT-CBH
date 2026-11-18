import {createHash,randomBytes} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {authorize} from '../security/policy';
import {identityLookup} from '../security/envelope';
import {assertStaff,paperReview,saveRequest,documentTemplate,P2Error,type Staff} from '../p2/service';
import {paperSchema,type RequestDraft} from '../p2/schema';
import {appendAudit} from '../db/audit';
import {operationalDataEnabled} from '../security/runtime';
import {doctorKey} from '../migration/doctors';
import {parseHisAncWorkbook,isDoctorName,HisAncError,type HisAncRow} from './parse';

// Owner 2026-11-18: the HIS ANC export only fills blanks on cases already in the system, after PET matching.
// The plan is read-only; applying it saves "ตรวจใบขอส่งตรวจ" through the same service as the form.
export type HisAncOutcome='FILL'|'NOT_A_DOCTOR'|'NOT_MATCHED'|'ALREADY_CHECKED'|'ELECTRONIC_REQUEST'|'HIS_INCOMPLETE'|'DUPLICATE_IN_FILE';
export const HIS_ANC_OUTCOMES:readonly HisAncOutcome[]=['FILL','NOT_A_DOCTOR','NOT_MATCHED','ALREADY_CHECKED','ELECTRONIC_REQUEST','HIS_INCOMPLETE','DUPLICATE_IN_FILE'];
export type HisAncFills={doctor?:{name:string;versionId:string|null};gaWeeks?:number;gaDays?:number;gravida?:number;pregnancyType?:'Singleton'|'Twins';weightKg?:number;heightCm?:number};
export type HisAncItem={rowNo:number;hn:string;outcome:HisAncOutcome;reason:string|null;caseId:string|null;ln:string|null;fills:HisAncFills};
export type HisAncPlan={fileSha256:string;counts:Record<HisAncOutcome,number>;items:HisAncItem[]};

type Draft={pregnancy?:{weightKg?:number|null;heightCm?:number|null;gravida?:number|null;type?:string|null;edd?:string|null};ordering?:{doctorVersionId?:string|null}};
type Target={case_id:string;round_id:string;ln:string;unit_id:string|null;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';request_mode:string|null;checked:boolean;collected:string|null;draft:Draft|null};
type Doctor={id:string;name:string;key:string};
const DAY=86400000;
const patientKey=(r:Pick<HisAncRow,'cid'|'hn'>)=>JSON.stringify([r.cid,r.hn.replace(/^0+/,'')]);
const ACTIVE_CHECK="EXISTS(SELECT 1 FROM p2_paper_review p WHERE p.round_id=c.current_round_id AND p.kind='REQUEST' AND p.status NOT IN ('Replaced','Amended'))";
const countOf=(items:readonly HisAncItem[])=>Object.fromEntries(HIS_ANC_OUTCOMES.map(o=>[o,items.filter(i=>i.outcome===o).length])) as Record<HisAncOutcome,number>;

/** The case whose stored PET carries this CID and HN, on its current round. Several cases → ambiguous (never guessed). */
async function findTarget(db:Queryable,row:HisAncRow,lookupKey:Buffer):Promise<{target:Target|null;ambiguous:boolean}>{
 const rows=(await db.query<Target>(`SELECT DISTINCT ON (c.id) c.id case_id,c.current_round_id round_id,l.ln,s.unit_id,c.registration_origin origin,w.request_mode,w.draft,${ACTIVE_CHECK} checked,
   COALESCE((SELECT collection_date::text FROM p2_collection_fact WHERE round_id=c.current_round_id ORDER BY sequence DESC LIMIT 1),(SELECT collection_date::text FROM specimen_round_current WHERE id=c.current_round_id)) collected
  FROM his_inbound_file f JOIN his_order_current o ON o.inbound_file_id=f.id JOIN nipt_case c ON c.current_round_id=o.round_id
  JOIN case_ln l ON l.case_id=c.id AND l.verification<>'RETIRED' LEFT JOIN case_unit_scope s ON s.case_id=c.id LEFT JOIN p2_workspace w ON w.round_id=c.current_round_id
  WHERE f.parsed->>'identityKey'=$1 AND ltrim(f.parsed->>'hn','0')=ltrim($2,'0') AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)
  ORDER BY c.id,l.version DESC`,[identityLookup(row.cid,lookupKey),row.hn])).rows;
 return {target:rows.length===1?rows[0]:null,ambiguous:rows.length>1};
}

/** The selectable registry: newest effective version of each doctor, not suspended (as paperReview accepts). */
async function registry(db:Queryable):Promise<Doctor[]>{
 return (await db.query<{id:string;name:string}>(`SELECT v.id,v.name FROM p2_doctor_version v WHERE v.effective_from<=now()
  AND NOT EXISTS(SELECT 1 FROM p2_doctor_version n WHERE n.doctor_key=v.doctor_key AND n.version>v.version AND n.effective_from<=now())
  AND (SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) IS DISTINCT FROM 'Suspended'`)).rows.map(d=>({...d,key:doctorKey(d.name)}));
}
/** Same doctor only when the name is the same apart from title, dots, spacing and case; one letter off is another doctor (review 2026-11-18). */
export function matchDoctor(doctors:readonly Doctor[],provider:string):Doctor|null{
 const key=doctorKey(provider);return doctors.find(d=>d.key===key)??null;
}

export async function previewHisAnc(db:Queryable,user:Staff,bytes:Buffer,lookupKey:Buffer):Promise<HisAncPlan>{
 await assertStaff(db,user);
 if(!authorize(user,'paper.verify',{origin:'LAB_DIRECT'},'write'))throw new Error('FORBIDDEN');
 const rows=parseHisAncWorkbook(bytes),doctors=await registry(db);
 // One visit per patient: the newest complete row wins.
 const newest=new Map<string,HisAncRow>();
 for(const r of rows)if(!r.incomplete){const k=patientKey(r),seen=newest.get(k);if(!seen||r.visitDate>seen.visitDate||r.visitDate===seen.visitDate&&r.rowNo>seen.rowNo)newest.set(k,r);}
 const items:HisAncItem[]=[];
 for(const r of rows){
  const item=(outcome:HisAncOutcome,reason:string|null=null,t:Target|null=null,fills:HisAncFills={}):HisAncItem=>({rowNo:r.rowNo,hn:r.hn,outcome,reason,caseId:t?.case_id??null,ln:t?.ln??null,fills});
  if(r.incomplete){items.push(item('HIS_INCOMPLETE',r.incomplete));continue;}
  if(newest.get(patientKey(r))!==r){items.push(item('DUPLICATE_IN_FILE'));continue;}
  const {target:t,ambiguous}=await findTarget(db,r,lookupKey);
  if(ambiguous){items.push(item('NOT_MATCHED','AMBIGUOUS'));continue;}
  if(!t||t.origin==='HISTORICAL'||!authorize(user,'paper.verify',{unitId:t.unit_id??undefined,origin:t.origin},'write')){items.push(item('NOT_MATCHED'));continue;}
  // No workspace yet: a LAB_DIRECT case starts on paper, as the service creates it.
  if((t.request_mode??(t.origin==='LAB_DIRECT'?'Paper':'Electronic'))!=='Paper'){items.push(item('ELECTRONIC_REQUEST',null,t));continue;}
  if(t.checked){items.push(item('ALREADY_CHECKED',null,t));continue;}
  if(!isDoctorName(r.provider)){items.push(item('NOT_A_DOCTOR',null,t));continue;}
  if(!t.collected){items.push(item('NOT_MATCHED','NO_COLLECTION_DATE',t));continue;}
  // Fill blanks only: the check copies type, EDD and doctor onto the request, so values already there are sent back unchanged.
  const p=t.draft?.pregnancy??{},own=doctors.find(d=>d.id===t.draft?.ordering?.doctorVersionId)??null,hit=own??matchDoctor(doctors,r.provider);
  const fromEdd=p.edd?280-Math.round((Date.parse(p.edd)-Date.parse(t.collected))/DAY):null;
  const total=fromEdd!==null&&fromEdd>=0?fromEdd:r.ga!.weeks*7+r.ga!.days+Math.round((Date.parse(t.collected)-Date.parse(r.visitDate))/DAY);
  // The check accepts 8+0 to 45+6 on the blood-draw date; outside it the check would not be Verified.
  if(total<8*7||total>45*7+6){items.push(item('HIS_INCOMPLETE','GA_OUT_OF_RANGE',t));continue;}
  const fills:HisAncFills={doctor:{name:hit?.name??r.provider,versionId:hit?.id??null},gaWeeks:Math.floor(total/7),gaDays:total%7,pregnancyType:p.type==='Twins'?'Twins':'Singleton'};
  if(r.gravida!==null&&p.gravida==null)fills.gravida=r.gravida;
  if(r.weightKg!==null&&p.weightKg==null)fills.weightKg=r.weightKg;
  if(r.heightCm!==null&&p.heightCm==null)fills.heightCm=r.heightCm;
  items.push(item('FILL',null,t,fills));
 }
 return {fileSha256:createHash('sha256').update(bytes).digest('hex'),counts:countOf(items),items};
}

/** A doctor named on the HIS row but not in the registry: added like the historical registration (no unit, no signature, Approved). */
async function addDoctor(db:Queryable,user:Staff,provider:string):Promise<string>{
 // One import at a time per name: whoever comes second finds the doctor the first one added.
 const key=doctorKey(provider);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432803))',['HIS-ANC-DOCTOR:'+key]);
 const existing=matchDoctor(await registry(db),provider);if(existing)return existing.id;
 const real=operationalDataEnabled(),hex=randomBytes(8).toString('hex').toUpperCase(),bare=provider.replace(/^(พญ|นพ)\.\s*/,'');
 // Synthetic names must start with SYNTHETIC (data contract); dropping the title keeps the same doctorKey as the HIS spelling.
 const name=real?provider:/^(SYNTHETIC|จำลอง)/.test(bare)?bare:'SYNTHETIC '+bare;
 const v=(await db.query<{id:string}>('INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by) VALUES($1,1,$2,NULL,now(),$3,NULL,NULL,NULL,$4) RETURNING id',   /* now(): selectable by paperReview in this same transaction */
  [(real?'HIS-':'SYNTHETIC-HIS-')+hex,name,(real?'':'SYNTHETIC_')+'IMPORTED_FROM_HIS_ANC_EXPORT',user.id])).rows[0];
 await db.query('INSERT INTO p2_doctor_registration(doctor_version_id,actor_id,authorized) VALUES($1,$2,true)',[v.id,user.id]);
 await db.query("INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,'Approved',$2,'IMPORTED_FROM_HIS_ANC_EXPORT')",[v.id,user.id]);
 return v.id;
}

/** One FILL case: re-checked under the case lock (a check saved meanwhile wins), then saved through the same services as the form. */
export async function applyItem(db:Queryable,user:Staff,item:HisAncItem,added:Map<string,string>):Promise<'APPLIED'|'ALREADY_CHECKED'>{
 const c=(await db.query<{checked:boolean}>(`SELECT ${ACTIVE_CHECK} checked FROM nipt_case c WHERE c.id=$1 FOR UPDATE`,[item.caseId])).rows[0];
 if(!c||c.checked)return 'ALREADY_CHECKED';
 const x=item.fills,key=doctorKey(x.doctor!.name);
 const doctorVersionId=x.doctor!.versionId??added.get(key)??await addDoctor(db,user,x.doctor!.name);
 if(!x.doctor!.versionId)added.set(key,doctorVersionId);
 const panel={...Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])),doctorVersionId,gaWeeks:x.gaWeeks!,gaDays:x.gaDays!,gravida:x.gravida??null,pregnancyType:x.pregnancyType??'Singleton'};
 const review=await paperReview(db,user,item.caseId!,{kind:'REQUEST',templateVersion:documentTemplate('REQUEST'),panel,operation:'Review',previousId:null});
 // Only a Verified check is kept; anything else rolls this case back so staff check it by hand.
 if(review.status!=='Verified')throw new HisAncError('CHECK_NOT_VERIFIED');
 if(x.weightKg!==undefined||x.heightCm!==undefined){
  const w=(await db.query<{version:number;draft:RequestDraft}>('SELECT w.version,w.draft FROM p2_workspace w JOIN nipt_case c ON c.current_round_id=w.round_id WHERE c.id=$1',[item.caseId])).rows[0];
  const draft=structuredClone(w.draft);
  if(x.weightKg!==undefined&&draft.pregnancy.weightKg==null)draft.pregnancy.weightKg=x.weightKg;
  if(x.heightCm!==undefined&&draft.pregnancy.heightCm==null)draft.pregnancy.heightCm=x.heightCm;
  await saveRequest(db,user,item.caseId!,{expectedVersion:w.version,draft});
 }
 return 'APPLIED';
}

/** Re-plans the same file (never trusts the preview) and fills each FILL case in its own savepoint. */
export async function applyHisAnc(db:Queryable,user:Staff,bytes:Buffer,lookupKey:Buffer,expectedSha256:string):Promise<HisAncPlan&{applied:number;failed:{rowNo:number;code:string}[]}>{
 const plan=await previewHisAnc(db,user,bytes,lookupKey);
 if(plan.fileSha256!==expectedSha256)throw new HisAncError('HIS_ANC_FILE_CHANGED');
 const added=new Map<string,string>(),failed:{rowNo:number;code:string}[]=[],items=plan.items.map(i=>({...i}));let applied=0;
 for(const item of items){
  if(item.outcome!=='FILL'||!item.caseId)continue;
  const before=new Map(added);
  await db.query('SAVEPOINT his_anc_case');
  try{
   if(await applyItem(db,user,item,added)==='ALREADY_CHECKED')item.outcome='ALREADY_CHECKED';else applied++;
   await db.query('RELEASE SAVEPOINT his_anc_case');
  }catch(e){
   await db.query('ROLLBACK TO SAVEPOINT his_anc_case');await db.query('RELEASE SAVEPOINT his_anc_case');
   added.clear();for(const [k,v] of before)added.set(k,v);   // a doctor added inside the rolled-back case is gone with it
   // Known codes are shown as they are; anything else (database or validation text) never reaches the screen.
   failed.push({rowNo:item.rowNo,code:e instanceof HisAncError||e instanceof P2Error?e.code:'SAVE_FAILED'});
  }
 }
 await appendAudit(db,{actorId:user.id,action:'HIS_ANC_IMPORT_APPLIED',resourceType:'his_anc_import',details:{count:applied,outcome:failed.length?'PARTIAL':'APPLIED',origin:'HIS_ANC_EXPORT'}});
 return {fileSha256:plan.fileSha256,counts:countOf(items),items,applied,failed};
}
