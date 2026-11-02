/** Read-only, counts-only report of the LAB queue: categories, blocking gate codes and the historical cases reported by the previous system.
 *  Run from the installed release: nipt-admin ops-run --root <root> --script tools\migration\lab-gate-report.ts
 *  Prints no LN, HN or name. The only write is the usual PHI-access audit row of a worklist read, made as the first APP_ADMIN. */
import {pool} from '../../packages/db/connection';
import {labWorklist} from '../../packages/lab/worklist';
import type {Staff} from '../../packages/lab/core';
import {listHistoricalRuns,historicalRunDetail} from '../../packages/lab/historical-run';

const db=pool();
const tally=(xs:string[])=>xs.reduce<Record<string,number>>((m,x)=>{m[x]=(m[x]??0)+1;return m;},{});
const admin=(await db.query<{id:string}>("SELECT u.id FROM app_user u JOIN role_assignment r ON r.user_id=u.id AND r.role='APP_ADMIN' AND r.effective_from<=now() AND (r.expires_at IS NULL OR r.expires_at>now()) WHERE u.enabled ORDER BY u.created_at LIMIT 1")).rows[0];
if(!admin)throw Error('APP_ADMIN_ACTOR_NOT_AVAILABLE');
const w=await labWorklist(db,{id:admin.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]});
const blocked=w.attempts.filter(a=>a.category==='GATE_BLOCKED');
const count=async(sql:string)=>Number((await db.query<{n:number}>(sql)).rows[0]?.n??0);
const actor:Staff={id:admin.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]};
const runs=await listHistoricalRuns(db,actor);
const runDetail:Record<string,unknown>={};for(const r of runs){const d=await historicalRunDetail(db,actor,r.runLabel);runDetail[r.runLabel]=d?{slots:d.slots.length,sampleSlots:d.slots.filter(s=>s.kind==='SAMPLE').length,controlSlots:d.slots.filter(s=>s.kind==='CONTROL').length,repeatRows:d.slots.filter(s=>s.kind==='REPEAT').length,emptySlots:d.slots.filter(s=>s.kind==='EMPTY').length,withPdf:d.withPdf}:null;}
console.log(JSON.stringify({
 historicalRuns:runs,runDetail,
 historicalDoctors:{names:await count('SELECT count(*)::int n FROM migration_doctor'),registryEntries:await count("SELECT count(DISTINCT doctor_version_id)::int n FROM migration_doctor_registry"),casesLinked:await count('SELECT count(DISTINCT case_id)::int n FROM migration_doctor_case'),registryWithoutSignature:await count('SELECT count(*)::int n FROM p2_doctor_version WHERE signature_png IS NULL')},
 pregnancyDefaulted:w.attempts.filter(a=>a.pregnancyDefaulted).length,
 attempts:w.attempts.length,
 byCategory:tally(w.attempts.map(a=>a.category)),
 gateBlocked:blocked.length,
 gateBlockedByFailedCode:tally(blocked.flatMap(a=>(a.gate?.failed??[]).map(String))),
 gateBlockedByPendingCode:tally(blocked.flatMap(a=>(a.gate?.pending??[]).map(String))),
 redrawExpected:w.expected.length,lnHalosMissing:w.missing.length,
 historicalReportedByPreviousSystem:await count('SELECT count(*)::int n FROM historical_reported_result'),
 historicalAttemptsInQueue:w.attempts.filter(a=>a.category!=='OTHER').length,
},null,1));
await db.end();
