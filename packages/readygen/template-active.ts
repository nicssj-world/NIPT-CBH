import type {Queryable} from '../db/connection';
import type {TemplateKind} from './docx';

/** The Active registry revision for a kind, or null (then the Owner's installed, SHA-256-locked master is used). */
export async function activeTemplate(db:Queryable,kind:TemplateKind){
 const r=(await db.query<{id:string;version:number;file_sha256:string;template_code:string|null}>(`SELECT v.id,v.version,v.file_sha256,v.template_code FROM report_template_active a JOIN report_template_revision v ON v.id=a.revision_id WHERE a.kind=$1 AND v.state='Active'`,[kind])).rows[0];
 return r?{revisionId:r.id,version:r.version,sha256:r.file_sha256,code:r.template_code??'UNSPECIFIED'}:null;
}
