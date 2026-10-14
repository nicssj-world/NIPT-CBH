import type {Queryable} from '../db/connection';
import {operationalDataEnabled} from '../security/runtime';
import {LabError} from './core';
/** Both runtime and the deliberately configured database must select operational use. */
export async function operationalWorkflow(db:Queryable):Promise<boolean>{
 if(!operationalDataEnabled())return false;
 if(!(await db.query<{enabled:boolean}>('SELECT nipt_operational_enabled() enabled')).rows[0]?.enabled)throw new LabError('OPERATIONAL_DATABASE_MODE_REQUIRED',423);
 return true;
}
