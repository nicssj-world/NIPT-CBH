import {pool} from "../../packages/db/connection";
import {readActiveSettings} from "../../packages/settings/service";
import {SETTINGS} from "../../packages/settings/catalog";
import {workerHealth} from "../../packages/jobs/health";
export async function systemHealth(){
 const [heartbeat,backlog,reconciliation,settings]=await Promise.all([
  pool().query<{observed_at:Date;details:{lastSuccess?:string;lastError?:string}}>("SELECT observed_at,details FROM worker_heartbeat WHERE worker_id='synthetic-worker'"),
  pool().query<{count:string;oldest:Date|null}>("SELECT count(*)::text AS count,min(o.created_at) AS oldest FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.state<>'Cancelled' AND r.outbox_id IS NULL"),pool().query<{count:string;oldest:Date|null}>("SELECT count(*)::text AS count,min(completed_at) AS oldest FROM integration_job_receipt WHERE result->>'state'='RECONCILIATION_REQUIRED'"),readActiveSettings(pool())
 ]);
 const s=SETTINGS.his_inbound.schema.parse(settings.his_inbound??SETTINGS.his_inbound.default),h=heartbeat.rows[0],b=backlog.rows[0];
 const base=workerHealth({enabled:s.enabled,observedAt:h?.observed_at??null,lastSuccess:h?.details.lastSuccess?new Date(h.details.lastSuccess):null,lastError:h?.details.lastError??null,backlog:Number(b.count),oldestPendingAt:b.oldest});
 const unresolvedReconciliation=Number(reconciliation.rows[0].count);
 return {...base,healthy:base.healthy&&unresolvedReconciliation===0,unresolvedReconciliation,reconciliationOldestAt:reconciliation.rows[0].oldest,observedAt:h?.observed_at??null,heartbeatAge:h?.observed_at?Math.max(0,Math.round((Date.now()-h.observed_at.getTime())/1000)):null};
}
