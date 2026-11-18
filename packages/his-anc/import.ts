import {createHash,randomBytes} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {authorize} from '../security/policy';
import {identityLookup} from '../security/envelope';
import {assertStaff,paperReview,documentTemplate,type Staff} from '../p2/service';
import {paperSchema,type RequestDraft} from '../p2/schema';
import {appendAudit} from '../db/audit';
import {operationalDataEnabled} from '../security/runtime';
import {doctorSkeleton,within1} from '../migration/doctors';
import {parseHisAncWorkbook,isDoctorName,HisAncError,type HisAncRow} from './parse';

// Owner 2026-11-18: the HIS ANC export only fills blanks on cases already in the system, after PET matching.
// The plan is read-only; applying it saves "ตรวจใบขอส่งตรวจ" through the same service as the form.
export type HisAncOutcome='FILL'|'NOT_A_DOCTOR'|'NOT_MATCHED'|'ALREADY_CHECKED'|'ELECTRONIC_REQUEST'|'HIS_INCOMPLETE'|'DUPLICATE_IN_FILE';
export const HIS_ANC_OUTCOMES:readonly HisAncOutcome[]=['FILL','NOT_A_DOCTOR','NOT_MATCHED','ALREADY_CHECKED','ELECTRONIC_REQUEST','HIS_INCOMPLETE','DUPLICATE_IN_FILE'];
export type HisAncFills={doctor?:{name:string;versionId:string|null};gaWeeks?:number;gaDays?:number;gravida?:number;pregnancyType?:'Singleton';weightKg?:number;heightCm?:number};
export type HisAncItem={rowNo:number;hn:string;outcome:HisAncOutcome;reason:string|null;caseId:string|null;ln:string|null;fills:HisAncFills};
export type HisAncPlan={fileSha256:string;counts:Record<HisAncOutcome,number>;items:HisAncItem[]};

type Draft={pregnancy?:{weightKg?:number|null;heightCm?:number|null;gravida?:number|null}};
type Target={case_id:string;round_id:string;ln:string;unit_id:string|null;origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';request_mode:string|null;checked:boolean;collected:string|null;draft:Draft|null};
type Doctor={id:string;name:string;skeleton:string};
const DAY=86400000;
const patientKey=(r:Pick<HisAncRow,'cid'|'hn'>)=>JSON.stringify([r.cid,r.hn.replace(/^0+/,'')]);

/** The one case whose stored PET carries this CID and HN, on its current round; none or several → null. */
async function findTarget(db:Queryable,row:HisAncRow,lookupKey:Buffer):Promise<Target|null>{
 const rows=(await db.query<Target>(`SELECT DISTINCT c.id case_id,c.current_round_id round_id,l.ln,s.unit_id,c.registration_origin origin,w.request_mode,w.draft,
   EXISTS(SELECT 1 FROM p2_paper_review p WHERE p.round_id=c.current_round_id AND p.kind='REQUEST' AND p.status NOT IN ('Replaced','Amended')) checked,
   COALESCE((SELECT collection_date::text FROM p2_collection_fact WHERE round_id=c.current_round_id ORDER BY sequence DESC LIMIT 1),(SELECT collection_date::text FROM specimen_round_current WHERE id=c.current_round_id)) collected
  FROM his_inbound_file f JOIN his_order_current o ON o.inbound_file_id=f.id JOIN nipt_case c ON c.current_round_id=o.round_id
  JOIN case_ln l ON l.case_id=c.id AND l.verification<>'RETIRED' LEFT JOIN case_unit_scope s ON s.case_id=c.id LEFT JOIN p2_workspace w ON w.round_id=c.current_round_id
  WHERE f.parsed->>'identityKey'=$1 AND ltrim(f.parsed->>'hn','0')=ltrim($2,'0') AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)`,
  [identityLookup(row.cid,lookupKey),row.hn])).rows;
 return rows.length===1?rows[0]:null;
}

/** The selectable registry: newest effective version of each doctor, not suspended (as paperReview accepts). */
async function registry(db:Queryable):Promise<Doctor[]>{
 return (await db.query<{id:string;name:string}>(`SELECT v.id,v.name FROM p2_doctor_version v WHERE v.effective_from<=now()
  AND NOT EXISTS(SELECT 1 FROM p2_doctor_version n WHERE n.doctor_key=v.doctor_key AND n.version>v.version AND n.effective_from<=now())
  AND (SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) IS DISTINCT FROM 'Suspended'`)).rows.map(d=>({...d,skeleton:doctorSkeleton(d.name)}));
}
/** Same doctor written with or without title, dots, spacing or one letter off (as the historical registry merges spellings). */
export function matchDoctor(doctors:readonly Doctor[],provider:string):Doctor|null{
 const sk=doctorSkeleton(provider);return doctors.find(d=>d.skeleton===sk)??doctors.find(d=>within1(d.skeleton,sk))??null;
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
  const t=await findTarget(db,r,lookupKey);
  if(!t||t.origin==='HISTORICAL'||!authorize(user,'paper.verify',{unitId:t.unit_id??undefined,origin:t.origin},'write')){items.push(item('NOT_MATCHED'));continue;}
  // No workspace yet: a LAB_DIRECT case starts on paper, as the service creates it.
  if((t.request_mode??(t.origin==='LAB_DIRECT'?'Paper':'Electronic'))!=='Paper'){items.push(item('ELECTRONIC_REQUEST',null,t));continue;}
  if(t.checked){items.push(item('ALREADY_CHECKED',null,t));continue;}
  if(!isDoctorName(r.provider)){items.push(item('NOT_A_DOCTOR',null,t));continue;}
  if(!t.collected){items.push(item('NOT_MATCHED','NO_COLLECTION_DATE',t));continue;}
  const total=r.ga!.weeks*7+r.ga!.days+Math.round((Date.parse(t.collected)-Date.parse(r.visitDate))/DAY);
  const hit=matchDoctor(doctors,r.provider),p=t.draft?.pregnancy??{};
  const fills:HisAncFills={doctor:{name:hit?.name??r.provider,versionId:hit?.id??null},gaWeeks:Math.floor(total/7),gaDays:total%7,pregnancyType:'Singleton'};
  if(r.gravida!==null&&p.gravida==null)fills.gravida=r.gravida;
  if(r.weightKg!==null&&p.weightKg==null)fills.weightKg=r.weightKg;
  if(r.heightCm!==null&&p.heightCm==null)fills.heightCm=r.heightCm;
  items.push(item('FILL',null,t,fills));
 }
 const counts=Object.fromEntries(HIS_ANC_OUTCOMES.map(o=>[o,items.filter(i=>i.outcome===o).length])) as Record<HisAncOutcome,number>;
 return {fileSha256:createHash('sha256').update(bytes).digest('hex'),counts,items};
}

/** A doctor named on the HIS row but not in the registry: added like the historical registration (no unit, no signature, Approved). */
async function addDoctor(db:Queryable,user:Staff,provider:string):Promise<string>{
 const real=operationalDataEnabled(),hex=randomBytes(8).toString('hex').toUpperCase();
 const name=real||/^(SYNTHETIC|จำลอง)/.test(provider)?provider:'SYNTHETIC '+provider;
 const v=(await db.query<{id:string}>('INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by) VALUES($1,1,$2,NULL,now(),$3,NULL,NULL,NULL,$4) RETURNING id',   /* now(): selectable by paperReview in this same transaction */
  [(real?'HIS-':'SYNTHETIC-HIS-')+hex,name,(real?'':'SYNTHETIC_')+'IMPORTED_FROM_HIS_ANC_EXPORT',user.id])).rows[0];
 await db.query('INSERT INTO p2_doctor_registration(doctor_version_id,actor_id,authorized) VALUES($1,$2,true)',[v.id,user.id]);
 await db.query("INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,'Approved',$2,'IMPORTED_FROM_HIS_ANC_EXPORT')",[v.id,user.id]);
 return v.id;
}

/** Re-plans the same file (never trusts the preview) and fills each FILL case in its own savepoint. */
export async function applyHisAnc(db:Queryable,user:Staff,bytes:Buffer,lookupKey:Buffer,expectedSha256:string):Promise<HisAncPlan&{applied:number;failed:{rowNo:number;code:string}[]}>{
 const plan=await previewHisAnc(db,user,bytes,lookupKey);
 if(plan.fileSha256!==expectedSha256)throw new HisAncError('HIS_ANC_FILE_CHANGED');
 const added=new Map<string,string>(),failed:{rowNo:number;code:string}[]=[];let applied=0;
 for(const item of plan.items){
  if(item.outcome!=='FILL'||!item.caseId)continue;
  const x=item.fills,sk=doctorSkeleton(x.doctor!.name);
  await db.query('SAVEPOINT his_anc_case');
  try{
   const doctorVersionId=x.doctor!.versionId??added.get(sk)??await addDoctor(db,user,x.doctor!.name);
   const panel={...Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null])),doctorVersionId,gaWeeks:x.gaWeeks!,gaDays:x.gaDays!,gravida:x.gravida??null,pregnancyType:'Singleton'};
   await paperReview(db,user,item.caseId,{kind:'REQUEST',templateVersion:documentTemplate('REQUEST'),panel,operation:'Review',previousId:null});
   if(x.weightKg!==undefined||x.heightCm!==undefined){
    const w=(await db.query<{round_id:string;draft:RequestDraft}>('SELECT w.round_id,w.draft FROM p2_workspace w JOIN nipt_case c ON c.current_round_id=w.round_id WHERE c.id=$1 FOR UPDATE OF w',[item.caseId])).rows[0];
    const draft=structuredClone(w.draft);let changed=false;
    if(x.weightKg!==undefined&&draft.pregnancy.weightKg==null){draft.pregnancy.weightKg=x.weightKg;changed=true;}
    if(x.heightCm!==undefined&&draft.pregnancy.heightCm==null){draft.pregnancy.heightCm=x.heightCm;changed=true;}
    if(changed)await db.query('UPDATE p2_workspace SET draft=$2,version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE round_id=$1',[w.round_id,draft,user.id]);
   }
   await db.query('RELEASE SAVEPOINT his_anc_case');
   if(!x.doctor!.versionId&&!added.has(sk))added.set(sk,doctorVersionId);
   applied++;
  }catch(e){
   await db.query('ROLLBACK TO SAVEPOINT his_anc_case');await db.query('RELEASE SAVEPOINT his_anc_case');
   failed.push({rowNo:item.rowNo,code:(e as {code?:string}).code??(e instanceof Error?e.message:'FAILED')});
  }
 }
 await appendAudit(db,{actorId:user.id,action:'HIS_ANC_IMPORT_APPLIED',resourceType:'his_anc_import',details:{count:applied,outcome:failed.length?'PARTIAL':'APPLIED',origin:'HIS_ANC_EXPORT'}});
 return {...plan,applied,failed};
}
