import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {authorize} from '../security/policy';
import {identityLookup} from '../security/envelope';
import {assertStaff,type Staff} from '../p2/service';
import {doctorSkeleton,within1} from '../migration/doctors';
import {parseHisAncWorkbook,isDoctorName,type HisAncRow} from './parse';

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
