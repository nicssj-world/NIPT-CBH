/** Historical doctor registry (Owner 2026-11-02). The only evidence of the ordering doctor of a Genomic-CBH case is the "Referring Doctor:" line of the report PDF
 *  that case was issued with, so the doctors are read from those PDFs (the exact stored files of the linked result versions). Idempotent; adds no unit, signature,
 *  approval or p2_doctor_version, and invents nothing: a report that does not name a doctor adds none. */
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {pdfText} from '../results/extract';
import {assertSession,need,type Staff} from '../lab/core';
import type {FileStore} from '../storage';
import {P2Error} from '../p2/service';

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

export type HistoricalDoctor={id:string;name:string;cases:number};
/** Everyone who may read the doctor registry may read the historical entries (names only; cases are counted, not listed). */
export async function listHistoricalDoctors(db:Queryable,user:Staff):Promise<HistoricalDoctor[]>{
 await assertSession(db,user);
 if(!user.roles.some(x=>['ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','APP_ADMIN','CLINICAL_APPROVER'].includes(x)))throw new P2Error('FORBIDDEN',403);
 return (await db.query<HistoricalDoctor>('SELECT d.id,d.name,count(c.case_id)::int cases FROM migration_doctor d LEFT JOIN migration_doctor_case c ON c.doctor_id=d.id GROUP BY d.id ORDER BY d.name')).rows;
}
export async function referringDoctorOfCase(db:Queryable,caseId:string):Promise<string|null>{
 return (await db.query<{name:string}>('SELECT d.name FROM migration_doctor_case c JOIN migration_doctor d ON d.id=c.doctor_id WHERE c.case_id=$1 ORDER BY c.created_at LIMIT 1',[caseId])).rows[0]?.name??null;
}
