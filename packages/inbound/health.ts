import type {Queryable} from '../db/connection';
import {backoffSeconds,consecutiveFailures} from './cycle';

export const OK_OVERDUE_MINUTES=15;
export interface InboundHealthInput{enabled:boolean;intervalSeconds:number;lastRun:{outcome:string;finishedAt:Date;errorCode:string|null}|null;lastSuccessAt:Date|null;consecutiveFailures:number;readyBacklog:number;oldestReadyAt:Date|null;waitingOkOverdue:number;openIssues:Record<string,number>;parseErrors24h:number;}

/**
 * Four separate signals (REQ-SET-13 / §13.4): Enabled, Alive, Last Success, Last Error. A disabled integration is never
 * "healthy"; an enabled one without a recent scan is Enabled-but-not-Alive (AT-HISIN-09).
 */
export function summarizeInboundHealth(input:InboundHealthInput,now=new Date()){
 const staleMs=Math.max(3*input.intervalSeconds,90)*1000+backoffSeconds(input.consecutiveFailures,input.intervalSeconds)*1000;
 const alive=!!input.lastRun&&now.getTime()-input.lastRun.finishedAt.getTime()<=staleMs;
 const shareStatus=!input.lastRun?'UNKNOWN':input.lastRun.outcome==='SHARE_UNAVAILABLE'?'DOWN':input.lastRun.outcome==='SKIPPED_BACKOFF'?'BACKOFF':'UP';
 const lastError=input.lastRun&&['SHARE_UNAVAILABLE','FAILED','PARTIAL'].includes(input.lastRun.outcome)?input.lastRun.errorCode??input.lastRun.outcome:null;
 const nextRetryAt=input.consecutiveFailures&&input.lastRun?new Date(input.lastRun.finishedAt.getTime()+backoffSeconds(input.consecutiveFailures,input.intervalSeconds)*1000):null;
 const alerts=[
  ...(input.enabled&&!alive?['INBOUND_NOT_ALIVE']:[]),
  ...(shareStatus==='DOWN'||shareStatus==='BACKOFF'?['INBOUND_SHARE_UNAVAILABLE']:[]),
  ...(input.waitingOkOverdue?['OK_SENTINEL_OVERDUE']:[]),
  ...(input.parseErrors24h?['PET_PARSE_ERRORS']:[]),
  ...(input.lastRun?.outcome==='PARTIAL'?['INBOUND_PARTIAL_FAILURE']:[])
 ];
 return {Enabled:input.enabled,Alive:alive,LastSuccess:input.lastSuccessAt,LastError:lastError,shareStatus,consecutiveFailures:input.consecutiveFailures,nextRetryAt,readyBacklog:input.readyBacklog,oldestReadyAt:input.oldestReadyAt,waitingOkOverdue:input.waitingOkOverdue,openIssues:input.openIssues,parseErrors24h:input.parseErrors24h,alerts,healthy:input.enabled&&alive&&alerts.length===0};
}

export async function inboundHealth(db:Queryable,settings:{enabled:boolean;intervalSeconds:number},now=new Date()){
 const [last,success,ready,waiting,issues,errors,failures]=await Promise.all([
  db.query<{outcome:string;finished_at:Date;error_code:string|null}>('SELECT outcome,finished_at,error_code FROM his_inbound_scan_run ORDER BY finished_at DESC LIMIT 1'),
  db.query<{at:Date|null}>("SELECT max(finished_at) AS at FROM his_inbound_scan_run WHERE outcome='SUCCESS'"),
  db.query<{n:number;oldest:Date|null}>("SELECT count(*)::int AS n,min(discovered_at) AS oldest FROM his_inbound_file WHERE state='Ready'"),
  db.query<{n:number}>("SELECT count(*)::int AS n FROM his_inbound_waiting WHERE ok_seen_at IS NULL AND first_seen_at<$1",[new Date(now.getTime()-OK_OVERDUE_MINUTES*60_000)]),
  db.query<{kind:string;n:number}>("SELECT kind,count(*)::int AS n FROM his_intake_issue WHERE state IN ('Open','Proposed') GROUP BY kind"),
  db.query<{n:number}>("SELECT count(*)::int AS n FROM his_inbound_file WHERE state='ParseError' AND discovered_at>$1",[new Date(now.getTime()-86_400_000)]),
  consecutiveFailures(db)
 ]);
 const l=last.rows[0];
 return summarizeInboundHealth({enabled:settings.enabled,intervalSeconds:settings.intervalSeconds,lastRun:l?{outcome:l.outcome,finishedAt:new Date(l.finished_at),errorCode:l.error_code}:null,lastSuccessAt:success.rows[0]?.at?new Date(success.rows[0].at):null,consecutiveFailures:failures.count,readyBacklog:Number(ready.rows[0].n),oldestReadyAt:ready.rows[0].oldest?new Date(ready.rows[0].oldest):null,waitingOkOverdue:Number(waiting.rows[0].n),openIssues:Object.fromEntries(issues.rows.map(r=>[r.kind,Number(r.n)])),parseErrors24h:Number(errors.rows[0].n)},now);
}
