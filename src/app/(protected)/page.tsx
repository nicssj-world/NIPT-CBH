import {operationalDataEnabled} from "../../../packages/security/runtime";
import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {authorize} from "../../../packages/security/policy";
import {Registry} from "../../components/p2/registry";
import {AncDashboard} from "../../components/anc/dashboard";
import {QuickActions,type QuickAction} from "../../components/quick-actions";
export default async function Overview(){const user=await currentUser();if(!user)redirect("/login");const anc=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r));
 if(anc)return <AncDashboard/>;
 // Same permission checks as the sidebar (layout.tsx); a shortcut appears only where the user can already go.
 const can=(p:Parameters<typeof authorize>[1])=>authorize(user,p,{},"read");
 const items:QuickAction[]=[
  ...(can("his.scan")?[{href:"/inbound",label:"รับใบสั่งจาก HIS",hint:"PET/OK ที่รอรับและจับคู่"}]:[]),
  ...(can("worksheet.read")?[{href:"/lab",label:"งาน Lab",hint:"คิว FIFO และการรับตัวอย่าง"},{href:"/lab/batches",label:"Batch / Task List",hint:"Task List 1–3, QC, Pooling, Sequencing"}]:[]),
  ...(can("result.review")?[{href:"/results",label:"ผลตรวจ NIPT",hint:"สแกนโฟลเดอร์ PDF และตรวจทานผล"}]:[]),
  ...(can("settings.read")?[{href:"/settings",label:"ตั้งค่าระบบ",hint:"HIS, ที่เก็บไฟล์ และผู้ใช้"}]:[]),
  ...(can("health.read")?[{href:"/health",label:"สถานะระบบ",hint:"ฐานข้อมูล, Worker และการสำรองข้อมูล"}]:[]),
 ];
 return <Registry operational={operationalDataEnabled()} overview canAnc={false} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER"].includes(r))} actions={<QuickActions items={items}/>}/>;}
