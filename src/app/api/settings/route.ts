import {NextResponse,type NextRequest} from "next/server";
import {requestHisTest} from "../../../../packages/settings/his";
import {protect,apiError,readJson} from "../../../server/http";
import {settingsError} from "../../../server/settings-errors";
import {pool,withTransaction} from "../../../../packages/db/connection";
import {SETTINGS} from "../../../../packages/settings/catalog";
import {proposeSetting,validateSetting,approveSetting,activateSetting,rollbackSetting,readActiveSettings,readSettingRevisions} from "../../../../packages/settings/service";
import {SETTING_FORMS} from "../../../../packages/settings/fields";
import {SETTINGS_COVERAGE,COVERAGE_CATEGORIES} from "../../../../packages/settings/coverage";
import {resultFolderSettingValid} from "../../../../packages/results/folder";
import {formTemplateSettingValid} from "../../../../packages/forms/registry";
import {authorize} from "../../../../packages/security/policy";
import {simulatorRoot} from "../../../../packages/integrations/scanner";
import {templateProblems} from "../../../../packages/readygen/filename";
import {reportMastersInstalled} from "../../../../packages/readygen/reports";
import {resultStore} from "../../../server/p5";
export async function GET(request:NextRequest){try{const user=await protect(request,"settings.read");const revisions=await readSettingRevisions(pool());return NextResponse.json({catalog:Object.entries(SETTINGS).map(([key,d])=>({key,category:d.category,risk:d.risk,default:d.default,canPropose:!["storage_backup","doctor_registry"].includes(key)&&authorize(user,d.risk==="CLINICAL"?"settings.clinical.propose":d.risk==="INTEGRATION"?"settings.integration.propose":"settings.general.change",{},["CLINICAL","INTEGRATION"].includes(d.risk)?"propose":"write"),canActivate:!["storage_backup","doctor_registry"].includes(key)&&authorize(user,["CLINICAL","INTEGRATION"].includes(d.risk)?"settings.approve":"settings.general.change",{},["CLINICAL","INTEGRATION"].includes(d.risk)?"approve":"write")})),certifierUsers:(await pool().query("SELECT DISTINCT u.id,u.display_name FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.enabled AND a.role IN ('LAB_CERTIFIER','CLINICAL_APPROVER') AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) ORDER BY u.display_name")).rows,userId:user.id,canRetry:authorize(user,"his.retry",{},"write"),canApprove:authorize(user,"settings.approve",{},"approve"),revisions,active:await readActiveSettings(pool()),forms:SETTING_FORMS,coverage:SETTINGS_COVERAGE,coverageCategories:COVERAGE_CATEGORIES});}catch(e){return apiError(e);}}
export async function POST(request:NextRequest){let key:string|undefined;try{const user=await protect(request,"settings.read");const input=await readJson(request);key=typeof input.key==="string"?input.key:undefined;const id=await withTransaction(async db=>{
 const operation=String(input.operation),revisionId=String(input.id??"");
 if(operation==="propose")return proposeSetting(db,user,String(input.key),input.value,String(input.reason??""));
 if(!/^[a-f0-9-]{36}$/.test(revisionId))throw new Error("REVISION_REQUIRED");
 if(operation==="validate"){const revision=(await db.query<{setting_key:string}>("SELECT setting_key FROM settings_revision WHERE id=$1",[revisionId])).rows[0];if(revision&&["his_inbound","his_outbound"].includes(revision.setting_key))return requestHisTest(db,user,revisionId);
 await validateSetting(db,user,revisionId,async(key,value)=>{
  // P5: the result folder must be a synthetic folder that exists; the worker Test Path on the Results page checks readability.
  if(key==="request_consent")return formTemplateSettingValid(value);
  if(key==="result_management")return resultFolderSettingValid(simulatorRoot(),String((value as {pdfSourcePath:string}).pdfSourcePath));
  // Task 3: the download-name template must render a Windows-safe identifying name; an interpretation approval needs the
  // installed, hash-verified Owner masters it applies to.
  if(key==="report_output")return templateProblems(String((value as {downloadNameTemplate:string}).downloadNameTemplate)).length===0;
  if(key==="report_interpretation")return reportMastersInstalled(value as {singletonApprovedProduct:string;twinApprovedProduct:string},db,resultStore());return true;});return revisionId;}
 if(operation==="approve"){await approveSetting(db,user,revisionId);return revisionId;}
 if(operation==="activate"){await activateSetting(db,user,revisionId);return revisionId;}
 if(operation==="rollback")return rollbackSetting(db,user,revisionId,String(input.reason??"SYNTHETIC_ROLLBACK"));
 throw new Error("INVALID_OPERATION");
 });return NextResponse.json(typeof id==="string"?{id}:id);}catch(e){return settingsError(e,key);}}
