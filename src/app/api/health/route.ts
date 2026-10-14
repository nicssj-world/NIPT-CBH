import {NextResponse} from 'next/server';
import {assertRuntime,runtimeMode} from '../../../../packages/security/runtime';
import {pool,assertDatabaseMode} from '../../../../packages/db/connection';
export async function GET(){try{assertRuntime();await assertDatabaseMode(pool());return NextResponse.json({status:'ok',mode:runtimeMode()},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({status:'blocked'},{status:503,headers:{'Cache-Control':'no-store'}});}}
