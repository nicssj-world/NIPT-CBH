import {NextResponse,type NextRequest} from 'next/server';
import {protect,apiError,readJson} from '../../../server/http';
import {pool,withTransaction} from '../../../../packages/db/connection';
import {adminCommand,listUsers,listUnits,listAccessRequests,requireAdministrationRead,SENSITIVE_ROLES} from '../../../../packages/admin/service';
import {authorize,ROLES} from '../../../../packages/security/policy';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){try{
 const user=await protect(request);requireAdministrationRead(user);const input=Object.fromEntries(request.nextUrl.searchParams);
 const [users,units,requests]=await Promise.all([listUsers(pool(),user,input),listUnits(pool(),user,{search:input.unitSearch??'',page:input.unitPage??1}),listAccessRequests(pool(),user)]);
 const ids=[...new Set([...users.rows.flatMap(u=>[...u.unit_ids,...(u.unit_id?[u.unit_id]:[])]),...requests.flatMap(r=>Array.isArray(r.unit_ids)?r.unit_ids.filter((v):v is string=>typeof v==='string'):[])])];
 const referencedUnits=ids.length?(await pool().query('SELECT id,code,name,active,version FROM unit WHERE id=ANY($1::uuid[])',[ids])).rows:[];
 return NextResponse.json({users,units,requests,referencedUnits,roles:ROLES,sensitiveRoles:SENSITIVE_ROLES,userId:user.id,canWrite:authorize(user,'user.manage',{},'write'),canApprove:authorize(user,'user.manage',{},'approve')},{headers});
}catch(e){return apiError(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request);const input=await readJson(request);const result=await withTransaction(db=>adminCommand(db,user,input));return NextResponse.json(result,{headers});}catch(e){return apiError(e);}}
