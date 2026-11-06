import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {uuid,type Staff} from '../lab/core';
import {reportCandidate,type ReportDeps} from './reports';

export async function previewReportBatch(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 const d=z.strictObject({rowIds:z.array(uuid).min(1).max(100)}).parse(input),items=[];
 for(const rowId of [...new Set(d.rowIds)])items.push(await reportCandidate(db,user,deps,{rowId}));
 return {items};
}
