import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,audit,LabError,type Staff} from '../lab/core';
export const MANUAL_STAGES=['TASK_LIST','QC','POOLING','SEQUENCING'] as const;
export async function manualStages(db:Queryable,user:Staff,draftId:string){
 await assertSession(db,user);need(user,'history.read','read');
 if(!(await db.query('SELECT 1 FROM historical_draft WHERE id=$1',[uuid.parse(draftId)])).rows.length)throw new LabError('NOT_FOUND',404);
 return (await db.query<{stage:typeof MANUAL_STAGES[number];performed:boolean;actor_id:string;recorded_at:Date}>('SELECT DISTINCT ON(stage) stage,performed,actor_id,recorded_at FROM lab_manual_paper_stage WHERE draft_id=$1 ORDER BY stage,sequence DESC',[draftId])).rows;
}
export async function recordManualStages(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'history.draft');
 const d=z.strictObject({draftId:uuid,stages:z.strictObject({TASK_LIST:z.boolean(),QC:z.boolean(),POOLING:z.boolean(),SEQUENCING:z.boolean()})}).parse(input);
 await db.query('SELECT id FROM historical_draft WHERE id=$1 FOR UPDATE',[d.draftId]);const previous=await manualStages(db,user,d.draftId);
 let changed=0;for(const stage of MANUAL_STAGES)if((previous.find(p=>p.stage===stage)?.performed??false)!==d.stages[stage]){await db.query('INSERT INTO lab_manual_paper_stage(draft_id,stage,performed,actor_id) VALUES($1,$2,$3,$4)',[d.draftId,stage,d.stages[stage],user.id]);changed++;}
 await audit(db,user,'LAB_MANUAL_PAPER_STAGES_RECORDED','historical_draft',d.draftId,{count:changed,outcome:'USER_CONFIRMED_MANUAL_NO_NATIVE_QC'});
 return manualStages(db,user,d.draftId);
}
