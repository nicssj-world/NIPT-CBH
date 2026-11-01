import type {Parsed} from '../results/parser';
export function migrationResultSummary(input:{audience:'LAB'|'ANC';released:boolean;parsed?:Parsed|null;halos?:Record<string,unknown>|null}){
 if(input.audience==='ANC'&&!input.released)return null;
 if(input.parsed){const p=input.parsed;return {source:'OFFICIAL_PDF' as const,released:input.released,label:input.released?'ผลจากรายงาน PDF ที่รับรองแล้ว':'ผลจากรายงาน PDF — ยังไม่ปล่อยผล',discrepancies:input.halos?Object.entries(p.results).filter(([k,v])=>v?.value!==null&&input.halos?.[k]!==undefined&&input.halos[k]!==null&&(k==='fetalFraction'&&Number.isFinite(Number(input.halos[k]))&&Number.isFinite(Number(v.value))?Number(input.halos[k])!==Number(v.value):String(input.halos[k])!==String(v.value))).map(([key])=>key):[],values:Object.fromEntries(Object.entries(p.results).map(([k,v])=>[k,v?.value??null]))};}
 if(input.audience==='LAB'&&input.halos)return {source:'HALOS' as const,released:false,label:'ข้อมูลวิเคราะห์ HALOS — ยังไม่ปล่อยผล',values:input.halos};
 return null;
}
import {assertSession,caseVisible,LabError,need,uuid,type Staff} from '../lab/core';
import type {Queryable} from '../db/connection';
/** LAB-only projection. ANC continues to use the existing released-result service. */
export async function readMigrationResultSummary(db:Queryable,user:Staff,caseId:string){
 await assertSession(db,user);need(user,'result.review','read');uuid.parse(caseId);
 const c=(await db.query<{registration_origin:string;unit_id:string|null}>('SELECT c.registration_origin,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id FROM nipt_case c WHERE c.id=$1',[caseId])).rows[0];
 if(!c||!caseVisible(user,c))throw new LabError('NOT_FOUND',404);
 const official=(await db.query<{parsed:Parsed;attempt_id:string}>(`SELECT v.parsed,v.attempt_id FROM nipt_case c JOIN result_release r ON r.case_id=c.id AND r.round_id=c.current_round_id AND r.kind='RESULT' AND r.state='Active' JOIN result_report_version v ON v.id=r.version_id AND v.case_id=c.id AND v.round_id=r.round_id AND v.state='CertifiedReleased' WHERE c.id=$1 AND EXISTS(SELECT 1 FROM migration_record m WHERE m.case_id=c.id)`,[caseId])).rows[0];
 const row=(await db.query<{interpretation:{values?:Record<string,unknown>;holds?:unknown[]}|null;values:Record<string,unknown>;parsed:Parsed|null;released:boolean;attempt_id:string}>(`SELECT a.interpretation,a.values,v.parsed,a.attempt_id,(v.id IS NOT NULL) released
 FROM migration_record m JOIN nipt_case c ON c.id=m.case_id JOIN migration_analysis a ON a.record_id=m.id AND a.attempt_id=m.attempt_id AND a.is_current AND a.classification='ANALYSIS'
 LEFT JOIN result_release r ON (r.case_id,r.round_id)=(m.case_id,m.round_id) AND r.state='Active' AND r.kind='RESULT'
 LEFT JOIN result_report_version v ON v.id=r.version_id AND v.attempt_id=m.attempt_id AND v.state='CertifiedReleased'
 WHERE m.case_id=$1 AND m.round_id=c.current_round_id AND m.state='IMPORTED'`,[caseId])).rows;
 if(official&&(row.length!==1||row[0].attempt_id!==official.attempt_id))return {summary:migrationResultSummary({audience:'LAB',released:true,parsed:official.parsed}),holds:[]};
 if(row.length!==1)return {summary:null};
 const r=row[0],halos=r.interpretation?.values?{...r.interpretation.values,fetalSex:r.interpretation.values.fetalGender??null}:{t21:r.values.testChr21??null,t18:r.values.testChr18??null,t13:r.values.testChr13??null,qc:r.values.sampleQc??null,fetalFraction:r.values.fetalFraction??null};
 return {summary:migrationResultSummary({audience:'LAB',released:!!official||r.released,parsed:official?.parsed??r.parsed,halos}),holds:r.interpretation?.holds??[]};
}
