import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {migrationHealth} from '../../../../server/health';
const headers={'Cache-Control':'no-store'};
/** What this installation actually runs (APP_ADMIN only): environment, application version, deployment release ID, Git commit and schema.
 *  Values come from the supervisor (install-state.json) and the database ledger, never from package.json. */
export async function GET(request:NextRequest){try{
 await protect(request,'settings.read');
 const releaseId=process.env.NIPT_RELEASE_VERSION??null;
 const ledger=(await pool().query<{applied:number;last:string|null}>('SELECT count(*)::int applied,max(name) last FROM schema_migration')).rows[0];
 return NextResponse.json({environment:process.env.NIPT_ENVIRONMENT??null,releaseId,appVersion:releaseId?.split('-')[0]??null,revision:process.env.NIPT_SOURCE_SHA??null,
  schema:{applied:ledger.applied,last:ledger.last,checksumsMatch:await migrationHealth(pool())}},{headers});
}catch(e){return apiError(e);}}
