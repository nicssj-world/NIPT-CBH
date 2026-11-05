import type {NextRequest} from 'next/server';
import {pool} from '../../../../../packages/db/connection';
import {migrationRequest} from '../../../../server/migration';

export async function GET(request:NextRequest){
 return migrationRequest(request,async()=>({rows:(await pool().query<{created_at:Date;row:unknown}>(`SELECT e.created_at,h.value row
  FROM migration_execution e CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.plan->'lnHalosHeld','[]'::jsonb)) h
  WHERE e.plan->>'lnHalosImport'='true' ORDER BY e.created_at DESC LIMIT 1000`)).rows}));
}
