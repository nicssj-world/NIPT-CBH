import type {Queryable} from '../db/connection';
import {assertSession,need,type Staff} from './core';

/** Owner 2026-11-11: the Lab operator fields offer the active Lab people (LAB_STAFF / LAB_CERTIFIER) by first name only; the field keeps their
 *  Initial Names joined by " / " (e.g. "SJ / SC"), which is what the worksheet and its PDF print. A person without an Initial Name is listed but cannot be chosen. */
export const LAB_OPERATOR_ROLES=['LAB_STAFF','LAB_CERTIFIER'] as const;
export const OPERATOR_SEPARATOR=' / ';
const TITLES=['นางสาว','น.ส.','นาง','นาย','ดร.','ด.ร.','ภก.','ภญ.','ทนพ.','ทนพญ.','Dr.','Mr.','Mrs.','Ms.','Miss'];
/** First name without a title or surname: "นางสาว สมใจ ใจดี" → "สมใจ". */
export function firstNameOf(displayName:string){
 let rest=displayName.trim().replace(/\s+/g,' ');
 for(let again=true;again;){again=false;for(const t of TITLES)if(rest.toLowerCase().startsWith(t.toLowerCase())&&rest.length>t.length){rest=rest.slice(t.length).trim();again=true;}}
 return rest.split(' ')[0]||displayName.trim();
}
/** "SJ / SC" → ["SJ","SC"]; a free-text value typed before this rule is kept as one item, never dropped. */
export function splitOperators(value:string|null|undefined){return (value??'').split('/').map(s=>s.trim()).filter(Boolean);}
export function joinOperators(items:readonly string[]){return [...new Set(items.map(s=>s.trim()).filter(Boolean))].join(OPERATOR_SEPARATOR);}

export type LabOperator={id:string;firstName:string;initialName:string|null};
export async function listLabOperators(db:Queryable,user:Staff):Promise<LabOperator[]>{
 await assertSession(db,user);need(user,'worksheet.read','read');
 const rows=(await db.query<{id:string;display_name:string;initial_name:string|null}>(
  `SELECT u.id,u.display_name,u.initial_name FROM app_user u WHERE u.enabled AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role=ANY($1::text[])
    AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())) ORDER BY u.display_name`,[[...LAB_OPERATOR_ROLES]])).rows;
 return rows.map(r=>({id:r.id,firstName:firstNameOf(r.display_name),initialName:r.initial_name}));
}
