import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {uuid,type Staff} from '../lab/core';
import {reportCandidate,type ReportDeps} from './reports';

export async function previewReportBatch(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 const d=z.strictObject({rowIds:z.array(uuid).min(1).max(100),reissue:z.boolean().optional(),replaceReleased:z.boolean().optional()}).parse(input),items=[];
 for(const rowId of [...new Set(d.rowIds)])items.push(await reportCandidate(db,user,deps,{rowId,reissue:d.reissue,replaceReleased:d.replaceReleased}));
 return {items};
}
