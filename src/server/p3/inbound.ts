import {readFile} from "node:fs/promises";
import path from "node:path";
import {NextResponse} from "next/server";
import {ZodError} from "zod";
import {pool} from "../../../packages/db/connection";
import {FileStore} from "../../../packages/storage";
import {readActiveSettings} from "../../../packages/settings/service";
import {SETTINGS} from "../../../packages/settings/catalog";
import {inboundHealth} from "../../../packages/inbound/health";
import {inboundQueue} from "../../../packages/inbound/queue";
import {ResolutionError} from "../../../packages/inbound/resolution";
import type {Principal} from "../../../packages/security/policy";
import {apiError} from "../http";

export const noStore={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function inboundSettings(){const s=await readActiveSettings(pool());return SETTINGS.his_inbound.schema.parse(s.his_inbound??SETTINGS.his_inbound.default);}
export const inboundStore=()=>new FileStore(path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORE_ROOT||"data/files"));
export async function inboundDeps(){return {store:inboundStore(),lookupKey:await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??"")};}

export async function inboundPageData(user:Principal){
 const settings=await inboundSettings();
 const [health,queue,test]=await Promise.all([
  inboundHealth(pool(),settings),inboundQueue(pool(),user,300),
  pool().query<{result:{passed:boolean;checks:{code:string;passed:boolean}[];dayFolders:number;pairedPetFiles:number;sampleParse:string;errorCode:string|null};completed_at:Date}>("SELECT r.result,r.completed_at FROM integration_job_receipt r JOIN job_outbox o ON o.id=r.outbox_id WHERE o.kind='synthetic_inbound_test' ORDER BY r.completed_at DESC LIMIT 1")
 ]);
 return {settings:{enabled:settings.enabled,intervalSeconds:settings.intervalSeconds,lookbackDays:settings.lookbackDays},health,queue,lastTest:test.rows[0]??null};
}

const messages:Record<string,string>={
 ISSUE_NOT_OPEN:"รายการนี้มีผู้เสนอการแก้ไขแล้ว หรือปิดไปแล้ว กรุณาโหลดหน้าใหม่",ISSUE_NOT_PROPOSED:"ยังไม่มีข้อเสนอให้ตัดสิน หรือมีผู้ตัดสินแล้ว กรุณาโหลดหน้าใหม่",
 SECOND_PERSON_REQUIRED:"ผู้เสนอไม่สามารถอนุมัติรายการของตนเองได้ ต้องให้ผู้รับรองอีกคนตัดสิน",ACTION_NOT_ALLOWED_FOR_ISSUE:"การแก้ไขนี้ใช้กับชนิดปัญหานี้ไม่ได้",
 CASE_REQUIRED:"ต้องระบุเคสที่จะเชื่อม",CASE_LN_MISMATCH:"LN ของเคสที่เลือกไม่ตรงกับไฟล์ — การแก้ LN ต้องทำผ่านการลงทะเบียน",S1_ALREADY_RECEIVED:"รอบที่ 1 ของเคสนี้รับจาก HIS แล้ว เชื่อมซ้ำไม่ได้",
 INTAKE_NOT_UNLINKED:"ไฟล์นี้ไม่อยู่ในสถานะรอเชื่อมแล้ว",HISTORICAL_LINK_PROHIBITED:"เคสย้อนหลังเชื่อมกับไฟล์จาก HIS ไม่ได้",ISSUE_NOT_FOUND:"ไม่พบรายการ",FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้"
};
export function p3Error(error:unknown){
 if(error instanceof ZodError)return NextResponse.json({code:"VALIDATION_ERROR",error:"กรุณาระบุเหตุผลอย่างน้อย 8 ตัวอักษรและตรวจข้อมูลที่เลือก"},{status:422,headers:noStore});
 if(error instanceof ResolutionError)return NextResponse.json({code:error.message,error:messages[error.message]??"ทำรายการไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง"},{status:error.status,headers:noStore});
 if(error instanceof Error&&error.message==="SECOND_PERSON_REQUIRED")return NextResponse.json({code:error.message,error:messages.SECOND_PERSON_REQUIRED},{status:403,headers:noStore});
 return apiError(error);
}
