/** Historical doctor registry (Owner 2026-11-02). The only evidence of the ordering doctor of a Genomic-CBH case is the "Referring Doctor:" line of the report PDF
 *  that case was issued with, so the doctors are read from those PDFs (the exact stored files of the linked result versions). Idempotent; adds no unit, signature,
 *  approval or p2_doctor_version, and invents nothing: a report that does not name a doctor adds none. */
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {pdfText} from '../results/extract';
import {assertSession,need,type Staff} from '../lab/core';
import type {FileStore} from '../storage';

const TITLE=/^(นายแพทย์|แพทย์หญิง|แพทย์ชาย|นพ\.?|พญ\.?|ผศ\.?|รศ\.?|ศ\.?|ดร\.?|dr\.?|mrs?\.?|ms\.?)\s*/i;
/** "Referring Doctor: <name> Sample Type: ..." -> the name, or null when the line is absent or says nothing ("-"). */
export function referringDoctor(text:string):string|null{
 const t=text.replace(/\s+/g,' ');
 const m=/Referring Doctor:\s*(.+?)\s+(?:Sample Type:|Hospital\/Clinic:|Referral reason:|Lab No|HN:|$)/i.exec(t);
 const name=m?.[1]?.trim().replace(/\s+/g,' ')??'';
 return name.length>=2&&!/^[-–—.]+$/.test(name)&&!/[\u0000-\u001f<>]/.test(name)?name.slice(0,200):null;
}
/** The same doctor written with or without title, dots or spacing is one registry entry. */
export function doctorKey(name:string):string{
 let k=name.normalize('NFC').trim();
 for(let i=0;i<3&&TITLE.test(k);i++)k=k.replace(TITLE,'');
 return k.replace(/[\s.]+/g,'').toLowerCase();
}
export type DoctorImportResult={versions:number;parsed:number;noDoctorNamed:number;doctorsAdded:number;doctorsExisting:number;casesLinked:number;casesAlreadyLinked:number;unreadable:number};

export async function importHistoricalDoctors(db:Queryable,user:Staff,store:FileStore):Promise<DoctorImportResult>{
 await assertSession(db,user);need(user,'result.import');
 const rows=(await db.query<{version_id:string;case_id:string;sha256:string}>('SELECT h.version_id,h.case_id,v.sha256 FROM historical_reported_result h JOIN result_report_version v ON v.id=h.version_id ORDER BY h.imported_at,h.version_id')).rows;
 const r:DoctorImportResult={versions:rows.length,parsed:0,noDoctorNamed:0,doctorsAdded:0,doctorsExisting:0,casesLinked:0,casesAlreadyLinked:0,unreadable:0};
 for(const row of rows){
  let name:string|null;
  try{name=referringDoctor((await pdfText(await store.get(row.sha256))).text);}catch{r.unreadable++;continue;}
  if(!name){r.noDoctorNamed++;continue;}
  r.parsed++;
  const key=doctorKey(name);if(key.length<2){r.noDoctorNamed++;continue;}
  const ins=await db.query<{id:string}>('INSERT INTO migration_doctor(doctor_key,name,created_by) VALUES($1,$2,$3) ON CONFLICT(doctor_key) DO NOTHING RETURNING id',[key,name,user.id]);
  let id=ins.rows[0]?.id;
  if(id)r.doctorsAdded++;else{id=(await db.query<{id:string}>('SELECT id FROM migration_doctor WHERE doctor_key=$1',[key])).rows[0].id;r.doctorsExisting++;}
  const link=await db.query('INSERT INTO migration_doctor_case(doctor_id,case_id,version_id,evidence_sha256,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING case_id',[id,row.case_id,row.version_id,row.sha256,user.id]);
  if(link.rows.length)r.casesLinked++;else r.casesAlreadyLinked++;
 }
 await appendAudit(db,{actorId:user.id,action:'MIGRATION_DOCTOR_REGISTRY_IMPORTED',resourceType:'migration_doctor',details:{count:r.casesLinked,outcome:'IMPORTED',origin:'HISTORICAL'}});
 return r;
}

export async function referringDoctorOfCase(db:Queryable,caseId:string):Promise<string|null>{
 return (await db.query<{name:string}>('SELECT COALESCE(rv.name,d.name) name FROM migration_doctor_case c JOIN migration_doctor d ON d.id=c.doctor_id LEFT JOIN migration_doctor_registry g ON g.migration_doctor_id=d.id LEFT JOIN p2_doctor_version rv ON rv.id=g.doctor_version_id WHERE c.case_id=$1 ORDER BY c.created_at LIMIT 1',[caseId])).rows[0]?.name??null;
}

/** Letters only: tone marks, vowels above/below, the thanthakhat and spacing are dropped and sara am reads as sara aa, because the report PDFs of the previous
 *  system sometimes extract the same name with a stray mark. Used only to recognise the SAME doctor written two ways; it never changes a stored name. */
export function doctorSkeleton(name:string):string{
 return doctorKey(name).replace(/[ัิ-ฺ็-๎]/g,'').replace(/ํ?า|ำ/g,'า');
}
function within1(a:string,b:string):boolean{
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;
 if(i===a.length&&i===b.length)return true;
 return a.slice(i+1)===b.slice(i+1)||a.slice(i+1)===b.slice(i)||a.slice(i)===b.slice(i+1);
}
export type RegistryImportResult={names:number;registryDoctorsAdded:number;registryDoctorsExisting:number;namesMapped:number;mergedSpellings:number};
/** The historical doctors become ordinary registry entries (p2_doctor_version): same page, search and edit as any doctor. No unit and no signature are invented, so
 *  an entry is listed but not selectable on a request until an administrator adds the signature. Spellings of one doctor that differ by at most one letter
 *  or mark map to the most frequently written spelling. Idempotent. */
export async function registerHistoricalDoctors(db:Queryable,user:Staff):Promise<RegistryImportResult>{
 await assertSession(db,user);need(user,'doctor.manage','write');
 const names=(await db.query<{id:string;name:string;cases:number}>('SELECT d.id,d.name,count(c.case_id)::int cases FROM migration_doctor d LEFT JOIN migration_doctor_case c ON c.doctor_id=d.id GROUP BY d.id ORDER BY count(c.case_id) DESC,d.name')).rows;
 const r:RegistryImportResult={names:names.length,registryDoctorsAdded:0,registryDoctorsExisting:0,namesMapped:0,mergedSpellings:0};
 const canon:{skeleton:string;name:string;versionId:string|null;members:string[]}[]=[];
 for(const n of names){
  const sk=doctorSkeleton(n.name),hit=canon.find(c=>within1(c.skeleton,sk));
  if(hit){hit.members.push(n.id);r.mergedSpellings++;}else canon.push({skeleton:sk,name:n.name,versionId:null,members:[n.id]});
 }
 for(const c of canon){
  const key='HIST-'+(await import('node:crypto')).createHash('sha256').update(c.skeleton).digest('hex').slice(0,16);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432803))',[key]);
  let v=(await db.query<{id:string}>('SELECT id FROM p2_doctor_version WHERE doctor_key=$1 ORDER BY version DESC LIMIT 1',[key])).rows[0];
  if(v)r.registryDoctorsExisting++;
  else{
   v=(await db.query<{id:string}>("INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by) VALUES($1,1,$2,NULL,clock_timestamp(),'IMPORTED_FROM_GENOMIC_CBH_REPORTS',NULL,NULL,NULL,$3) RETURNING id",[key,c.name,user.id])).rows[0];
   await db.query('INSERT INTO p2_doctor_registration(doctor_version_id,actor_id,authorized) VALUES($1,$2,true)',[v.id,user.id]);
   await db.query("INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,'Approved',$2,'IMPORTED_FROM_GENOMIC_CBH_REPORTS')",[v.id,user.id]);
   r.registryDoctorsAdded++;
  }
  for(const m of c.members){const x=await db.query('INSERT INTO migration_doctor_registry(migration_doctor_id,doctor_version_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING migration_doctor_id',[m,v.id,user.id]);if(x.rows.length)r.namesMapped++;}
 }
 await appendAudit(db,{actorId:user.id,action:'MIGRATION_DOCTORS_REGISTERED',resourceType:'p2_doctor_version',details:{count:r.registryDoctorsAdded,outcome:'IMPORTED',origin:'HISTORICAL'}});
 return r;
}
