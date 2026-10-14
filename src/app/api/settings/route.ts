import {NextResponse,type NextRequest} from "next/server";
import {requestHisTest} from "../../../../packages/settings/his";
import {stat} from "node:fs/promises";
import {protect,apiError,readJson} from "../../../server/http";
import {pool,withTransaction} from "../../../../packages/db/connection";
import {SETTINGS} from "../../../../packages/settings/catalog";
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting,readActiveSettings} from "../../../../packages/settings/service";
import {SETTING_FORMS} from "../../../../packages/settings/fields";
import {SETTINGS_COVERAGE,COVERAGE_CATEGORIES} from "../../../../packages/settings/coverage";
import {resultFolder} from "../../../../packages/results/folder";
import {confined} from "../../../../packages/storage";
import {authorize} from "../../../../packages/security/policy";
import {simulatorRoot} from "../../../../packages/integrations/scanner";
export async function GET(request:NextRequest){try{const user=await protect(request,"settings.read");const revisions=await pool().query("SELECT id,setting_key,version,state,created_by,approved_by,created_at,test_passed,value FROM settings_revision ORDER BY created_at DESC LIMIT 100");return NextResponse.json({catalog:Object.entries(SETTINGS).map(([key,d])=>({key,category:d.category,risk:d.risk,default:d.default,canPropose:authorize(user,d.risk==="CLINICAL"?"settings.clinical.propose":d.risk==="INTEGRATION"?"settings.integration.propose":"settings.general.change",{},["CLINICAL","INTEGRATION"].includes(d.risk)?"propose":"write"),canActivate:authorize(user,["CLINICAL","INTEGRATION"].includes(d.risk)?"settings.approve":"settings.general.change",{},["CLINICAL","INTEGRATION"].includes(d.risk)?"approve":"write")})),userId:user.id,canRetry:authorize(user,"his.retry",{},"write"),canApprove:authorize(user,"settings.approve",{},"approve"),revisions:revisions.rows,active:await readActiveSettings(pool()),forms:SETTING_FORMS,coverage:SETTINGS_COVERAGE,coverageCategories:COVERAGE_CATEGORIES});}catch(e){return apiError(e);}}
export async function POST(request:NextRequest){try{const user=await protect(request,"settings.read");const input=await readJson(request);const id=await withTransaction(async db=>{
 const operation=String(input.operation),revisionId=String(input.id??"");
 if(operation==="propose")return proposeSetting(db,user,String(input.key),input.value,String(input.reason??""));
 if(!/^[a-f0-9-]{36}$/.test(revisionId))throw new Error("REVISION_REQUIRED");
 if(operation==="validate"){const revision=(await db.query<{setting_key:string}>("SELECT setting_key FROM settings_revision WHERE id=$1",[revisionId])).rows[0];if(revision&&["his_inbound","his_outbound"].includes(revision.setting_key))return requestHisTest(db,user,revisionId);
 await validateSetting(db,user,revisionId,async(key,value)=>{
  // P5: the result folder must be a synthetic folder that exists; the worker Test Path on the Results page checks readability.
  if(key==="result_management"){try{const d=await stat(await confined(simulatorRoot(),resultFolder(String((value as {pdfSourcePath:string}).pdfSourcePath))));return d.isDirectory();}catch{return false;}}return true;});return revisionId;}
 if(operation==="approve"){await approveSetting(db,user,revisionId);return revisionId;}
 if(operation==="activate"){await activateSetting(db,user,revisionId);return revisionId;}
 if(operation==="rollback")return rollbackSetting(db,user,revisionId,String(input.reason??"SYNTHETIC_ROLLBACK"));
 throw new Error("INVALID_OPERATION");
 });return NextResponse.json(typeof id==="string"?{id}:id);}catch(e){return apiError(e);}}
