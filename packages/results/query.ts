import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,audit,LabError,type Staff} from '../lab/core';
import type {Parsed} from './parser';

export const RESULT_BUCKETS={all:[],unlinked:['Unlinked'],conflict:['LinkConflict'],blocked:['ValidationBlocked'],pending:['PendingCertification'],closed:['RejectedImport','Superseded','Voided','CertifiedReleased']} as const;
const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;});
const schema=z.strictObject({dateField:z.enum(['IMPORTED','REPORTED']).default('IMPORTED'),q:z.string().trim().max(100).refine(s=>!/[\u0000-\u001f\u007f]/.test(s)).default(''),gender:z.enum(['ALL','Male','Female','UNKNOWN']).default('ALL'),qc:z.enum(['ALL','PASS','FAIL','UNKNOWN']).default('ALL'),from:iso.optional(),to:iso.optional(),risk:z.enum(['ALL','HIGH','LOW','UNKNOWN']).default('ALL'),bucket:z.enum(['all','unlinked','conflict','blocked','pending','closed']).default('all'),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(300).default(100)}).refine(q=>!q.from||!q.to||q.from<=q.to,{message:'DATE_RANGE_INVALID',path:['to']});
export const parseResultQuery=(input:unknown)=>schema.parse(input);
/** Patient search is permitted only in a CSRF-protected JSON POST body, never a URL. */
export function publicResultQuery(params:URLSearchParams){if(params.has('q'))throw new LabError('PRIVATE_QUERY_REQUIRES_POST',400);return Object.fromEntries(params);}
export type ResultQuery=z.infer<typeof schema>;
export type Risk='HIGH'|'LOW'|'UNKNOWN';
const trisomy=['t21','t18','t13'] as const,sca=['xo','xxx','xxy','xyy'] as const;
/** Filter labels describe parsed evidence, never a clinical interpretation. Incomplete/fallback evidence cannot be LOW. */
export function riskOf(p:Parsed):Risk{
 if(!['SINGLETON','TWIN'].includes(p.templateKind))return 'UNKNOWN';
 if(trisomy.some(k=>p.results[k]?.value==='High Risk')||(p.templateKind==='SINGLETON'&&sca.some(k=>p.results[k]?.value==='Detected')))return 'HIGH';
 const fields=[...trisomy,...(p.templateKind==='SINGLETON'?sca:[])] as (keyof Parsed['results'])[];
 return !p.needsManualReview&&fields.every(k=>p.results[k]?.method==='ANCHORED'&&p.results[k]?.value===(trisomy.includes(k as typeof trisomy[number])?'Low Risk':'Not Detected'))?'LOW':'UNKNOWN';
}
const val=(k:string)=>`v.parsed->'results'->'${k}'->>'value'`,method=(k:string)=>`v.parsed->'results'->'${k}'->>'method'`;
const riskSql=`CASE WHEN v.template_kind NOT IN ('SINGLETON','TWIN') THEN 'UNKNOWN'
 WHEN (${trisomy.map(k=>`${val(k)}='High Risk'`).join(' OR ')}) OR (v.template_kind='SINGLETON' AND (${sca.map(k=>`${val(k)}='Detected'`).join(' OR ')})) THEN 'HIGH'
 WHEN coalesce(v.parsed->>'needsManualReview','true')='false' AND ${trisomy.map(k=>`${val(k)}='Low Risk' AND ${method(k)}='ANCHORED'`).join(' AND ')}
 AND (v.template_kind='TWIN' OR (${sca.map(k=>`${val(k)}='Not Detected' AND ${method(k)}='ANCHORED'`).join(' AND ')})) THEN 'LOW' ELSE 'UNKNOWN' END`;
export function resultQuerySql(q:ResultQuery){
 const values:unknown[]=[],where:string[]=[];const param=(v:unknown)=>{values.push(v);return '$'+values.length;};
 // Reported dates are parser ISO evidence; validate calendar shape/day before lexical comparison, with missing/invalid values NULL.
 const reported="v.parsed->'identifiers'->'reportedDate'->>'value'";
 const safeReported=`CASE WHEN ${reported} ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN CASE WHEN substring(${reported},9,2)::int<=extract(day FROM (make_date(substring(${reported},1,4)::int,substring(${reported},6,2)::int,1)+interval '1 month - 1 day')) THEN ${reported} END END`;
 if(q.dateField==='REPORTED'){
  if(q.from)where.push(`(${safeReported})>=${param(q.from)}`);
  if(q.to)where.push(`(${safeReported})<=${param(q.to)}`);
 }else{
  // Hospital calendar semantics: 00:00 Bangkok through the following midnight.
  if(q.from)where.push(`v.imported_at>=(${param(q.from)}::date::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  if(q.to)where.push(`v.imported_at<((${param(q.to)}::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')`);
 }
 if(q.q){const term=param(q.q);where.push(`(${['hn','labNumber','patientName'].map(k=>`strpos(lower(coalesce(v.parsed->'identifiers'->'${k}'->>'value','')),lower(${term}))>0`).join(' OR ')})`);}
 if(q.gender!=='ALL')where.push(q.gender==='UNKNOWN'?`coalesce(${val('fetalSex')},'') NOT IN ('Male','Female')`:`${val('fetalSex')}=${param(q.gender)}`);
 if(q.qc!=='ALL')where.push(q.qc==='UNKNOWN'?`coalesce(${val('qc')},'') NOT IN ('PASS','FAIL')`:`${val('qc')}=${param(q.qc)}`);
 if(q.bucket!=='all')where.push(`v.state=ANY(${param(RESULT_BUCKETS[q.bucket])}::text[])`);
 if(q.risk!=='ALL')where.push(`(${riskSql})=${param(q.risk)}`);
 // P5H reports have a different evidence/lifecycle contract and do not enter the live P5 queue/export.
 where.push("(v.case_id IS NULL OR EXISTS(SELECT 1 FROM nipt_case c WHERE c.id=v.case_id AND c.registration_origin<>'HISTORICAL'))");
 const text=`SELECT v.id,v.sha256,v.parser_version,v.template_version,v.parsed,v.kind,v.template_kind,v.state,v.imported_at,v.state_changed_at,i.original_name,i.relative_path,i.member_name,
 v.parsed->'identifiers'->'hn'->>'value' hn,v.parsed->'identifiers'->'labNumber'->>'value' lab,v.parsed->'identifiers'->'collectionDate'->>'value' collection,
 r.round_number,l.ln,(v.parsed->>'abnormal')::boolean abnormal,v.row_version,(${riskSql}) risk,
 EXISTS(SELECT 1 FROM result_report_version o JOIN result_intake_file oi ON oi.id=o.intake_file_id WHERE o.id<>v.id AND o.sha256<>v.sha256 AND lower(coalesce(oi.member_name,oi.original_name))=lower(coalesce(i.member_name,i.original_name))) name_conflict,
 EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=v.id AND e.event='PROPOSED' AND NOT EXISTS(SELECT 1 FROM result_link_event y WHERE y.version_id=v.id AND y.event IN ('APPROVED','REJECTED','UNLINKED') AND y.sequence>e.sequence)) proposal
 FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id LEFT JOIN specimen_round r ON r.id=v.round_id LEFT JOIN case_ln l ON l.id=r.case_ln_id
 WHERE ${where.join(' AND ')} ORDER BY v.state_changed_at DESC,v.id DESC LIMIT ${param(q.pageSize+1)} OFFSET ${param((q.page-1)*q.pageSize)}`;
 return {text,values};
}
export type ResultRow={sha256?:string;parser_version?:string;template_version?:string;parsed?:Parsed;name_conflict?:boolean;proposal?:boolean;abnormal?:boolean;row_version?:number;state_changed_at?:Date|string;kind?:string;id:string;state:string;risk:Risk;hn:string|null;lab:string|null;original_name:string;member_name:string|null;relative_path:string|null;imported_at:Date|string;template_kind:string;ln:string|null;round_number:number|null;collection:string|null};
export async function queryResults(db:Queryable,user:Staff,input:unknown={}){
 await assertSession(db,user);need(user,'result.review','read');const q=parseResultQuery(input),sql=resultQuerySql(q);
 const found=(await db.query<ResultRow>(sql.text,sql.values)).rows;
 return {rows:found.slice(0,q.pageSize),page:{number:q.page,size:q.pageSize,hasNext:found.length>q.pageSize,scope:'BOUNDED_PAGE' as const},filters:q};
}
/** Apostrophe prefixes are literal text protection, never ="..." formulas. CSV consumers must import IDs as text. */
export function csvCell(value:unknown){let s=value==null?'':String(value);if(/^[\s\uFEFF]*[=+@-]/u.test(s)||/^0\d+$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function resultCsv(rows:ResultRow[]){
 const ids=['patientName','dob','collectionDate','receivedDate','reportedDate','gestationalAgeDays'] as const;
 const results=['t21','t18','t13','fetalSex','xo','xxx','xxy','xyy','yChromosome','fetalFraction','qc'] as const;
 const header=['Report ID','HN (text)','Lab (text)','LN (text)','รอบ','ชนิด','สถานะ','ความเสี่ยงตามค่าที่อ่าน (ไม่ใช่การรับรอง)','วันที่นำเข้า (UTC)','วันที่เก็บ','ไฟล์','ชื่อที่อ่านได้','วันเกิดที่อ่านได้','วันที่เก็บที่อ่านได้','วันที่รับที่อ่านได้','วันที่รายงานที่อ่านได้','GA วัน ที่อ่านได้',...results.map(k=>`${k} ที่อ่านได้`),'ต้องตรวจมือ','abnormal ตาม Parser','Parser version','Template version','SHA-256','คุณภาพการอ่านแต่ละค่า','ขอบเขต'];
 const rowsOf=rows.map(r=>[r.id,r.hn,r.lab,r.ln,r.round_number,r.template_kind,r.state,r.risk,r.imported_at instanceof Date?r.imported_at.toISOString():r.imported_at,r.collection,r.member_name??r.relative_path??r.original_name,
  ...ids.map(k=>r.parsed?.identifiers[k]?.value??'UNKNOWN'),...results.map(k=>{const f=r.parsed?.results[k];return f?.method==='NOT_APPLICABLE'?'NOT_APPLICABLE':f?.value??'UNKNOWN';}),
  r.parsed?.needsManualReview??'UNKNOWN',r.parsed?.abnormal??'UNKNOWN',r.parser_version??'UNKNOWN',r.template_version??'UNKNOWN',r.sha256??'UNKNOWN',
  r.parsed?JSON.stringify({identifiers:Object.fromEntries(Object.entries(r.parsed.identifiers).map(([k,f])=>[k,f.method])),results:Object.fromEntries(Object.entries(r.parsed.results).map(([k,f])=>[k,f.method]))}):'UNKNOWN','SYNTHETIC_PARSED_NOT_CERTIFIED']);
 return '\uFEFF'+[header,...rowsOf].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export async function exportResultPage(db:Queryable,user:Staff,input:unknown){
 if(!user.sessionId)throw new LabError('UNAUTHENTICATED',401);await assertSession(db,user);
 need(user,'result.review','read');need(user,'report.export');if(!user.roles.some(r=>r==='LAB_STAFF'||r==='LAB_CERTIFIER'))throw new LabError('FORBIDDEN',403);
 const result=await queryResults(db,user,input);
 const evidence=(await db.query<{id:string}>('INSERT INTO result_query_export_evidence(actor_id,session_id,filters,page,page_size,has_next,version_ids) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[user.id,user.sessionId,JSON.stringify(result.filters),result.page.number,result.page.size,result.page.hasNext,result.rows.map(r=>r.id)])).rows[0];
 await audit(db,user,'RESULT_QUEUE_CSV_EXPORTED','RESULT_QUERY_EXPORT',evidence.id,{count:result.rows.length,outcome:'BOUNDED_PAGE'});
 return {...result,csv:resultCsv(result.rows)};
}

