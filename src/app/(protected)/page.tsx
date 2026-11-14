import {operationalDataEnabled} from "../../../packages/security/runtime";
import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {authorize} from "../../../packages/security/policy";
import {withTransaction} from "../../../packages/db/connection";
import {inboundQueuePage} from "../../../packages/inbound/queue";
import {labWorklistPage} from "../../../packages/lab/worklist";
import {releaseQueue} from "../../../packages/results/release-queue";
import {reportDeps} from "../../server/task3";
import {AncDashboard} from "../../components/anc/dashboard";
import {LabWorkload,type WorkloadStage} from "../../components/lab-workload";
import {labOverview} from "../../../packages/lab/overview";
import {registrySummary} from "../../../packages/p2/service";
import {AdminHomeSwitch,type HomeView} from "../../components/dashboard/admin-home-switch";

/** A queue that cannot be read shows "—" on its own sign; it never blocks the others or the page. */
const safe=async<T,>(name:string,run:()=>Promise<T>):Promise<T|null>=>{try{return await run();}catch(e){console.warn(`[dashboard] ${name} queue unavailable:`,e instanceof Error?e.message:"unknown");return null;}};   // code only, never patient data

export default async function Overview({searchParams}:{searchParams:Promise<{view?:string}>}){const user=await currentUser();if(!user)redirect("/login");const anc=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r));
 // Owner 2026-11-12: the administrator (system-wide read) chooses between the ANC and the Lab overview; ANC roles keep ANC, every other role keeps Lab.
 const admin=user.roles.includes("APP_ADMIN"),{view}=await searchParams;
 const current:HomeView=admin?(view==="lab"?"lab":"anc"):anc?"anc":"lab";
 const ancHome=<AncDashboard operational={operationalDataEnabled()}/>;
 if(current==="anc")return admin?<><AdminHomeSwitch view="anc"/>{ancHome}</>:ancHome;
 // Same permission checks as the sidebar (layout.tsx): a sign appears only where the user can already go.
 const can=(p:Parameters<typeof authorize>[1])=>authorize(user,p,{},"read");
 // Read-only counts from the queues each page already owns (same functions, same rules); no new counting logic here.
 const [his,lab,board,overview,registry]=await Promise.all([
  can("his.scan")?safe("his",()=>withTransaction(db=>inboundQueuePage(db,user))):Promise.resolve(undefined),
  can("worksheet.read")?safe("lab",()=>withTransaction(db=>labWorklistPage(db,user))):Promise.resolve(undefined),
  can("result.review")?safe("results",()=>withTransaction(db=>releaseQueue(db,user,reportDeps(),{tab:"ACTION",pageSize:10}))):Promise.resolve(undefined),
  // Dashboard 2026-11-11: TAT, GA over 18 weeks, open Runs and six months of quality; null (not readable) never blocks the signs above.
  can("worksheet.read")?safe("overview",()=>withTransaction(db=>labOverview(db,user,new Date(),{rows:false}))):Promise.resolve(undefined),
  // Owner 2026-11-14: HOLD and GA over 18 weeks are counted by the central registry's own filters, so a click lists exactly those cases.
  safe("registry",()=>withTransaction(db=>registrySummary(db,user,{}))),
 ]);
 const stages:WorkloadStage[]=[];
 if(his!==undefined)stages.push({key:"his",href:"/inbound",label:"รับตัวอย่างจาก HIS",n:his?.review.page.total??null,parts:his?[{label:"รอไฟล์ .ok จาก HIS",n:his.waiting.total}]:[],go:"ไปรับตัวอย่าง"});
 if(lab!==undefined)stages.push(
  {key:"ready",href:"/lab",label:"พร้อมเข้าตรวจ",n:lab?.counts.READY??null,parts:lab?[{label:"ยังเข้าตรวจไม่ได้",n:lab.counts.GATE_BLOCKED},{label:"รอรับเจาะซ้ำ (รอบที่ 2+)",n:lab.counts.REDRAW_EXPECTED}]:[],go:"ไปงาน Lab"},
  {key:"batch",href:"/lab/batches",label:"อยู่ใน Batch / กำลังทำ",n:lab?.counts.IN_BATCH??null,parts:lab?[{label:"ต้องตัดสินใจ (QC ไม่ผ่าน / หยุด)",n:lab.counts.DECISION}]:[],go:"ไป Batch / Task List",hot:!!lab?.counts.DECISION});
 if(board!==undefined)stages.push({key:"results",href:"/results",label:"ผลตรวจ: ต้องจัดการ",n:board?.counts.ACTION??null,parts:board?[{label:"รออนุมัติผลและส่ง HIS",n:board.counts.READY},{label:"ส่งแล้ว",n:board.counts.SENT}]:[],go:"ไปผลตรวจ NIPT"});
 const alerts=lab?.counts.LN_HALOS_MISSING?[{text:`ไม่มี LN Halos ${lab.counts.LN_HALOS_MISSING} รายการ`,href:"/lab?tab=LN_HALOS_MISSING"}]:[];
 const labHome=<LabWorkload stages={stages} alerts={alerts} overview={overview} registry={registry??null} decisions={lab?.counts.DECISION??null} generatedAt={new Date().toISOString()}/>;
 return admin?<><AdminHomeSwitch view="lab"/>{labHome}</>:labHome;}
