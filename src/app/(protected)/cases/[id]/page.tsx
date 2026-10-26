import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {CaseWorkspace} from "../../../../components/p2/case-workspace";
import {CasePdfIntake} from "../../../../components/p5/case-pdf-intake";
import {authorize} from "../../../../../packages/security/policy";
export default async function CaseDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{opened?:string}>}){const {id}=await params;const {opened}=await searchParams;const user=await currentUser();if(!user)redirect("/login");const reader=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER","APP_ADMIN"].includes(r));
 // Registration of an LN that already exists (same HN, in scope) opens the existing case; say so instead of looking like a new one (§11A G4).
 return <>{opened==="existing"&&<p className="notice warning-notice" role="status">LN นี้ลงทะเบียนไว้แล้ว — เปิดเคสเดิม (ไม่ได้สร้างเคสใหม่)</p>}<CaseWorkspace key={id} canReadDocuments={reader} ancView={user.roles.some(r=>r==="ANC_NURSE"||r==="ANC_SUPERVISOR")} caseId={id}/>{authorize(user,"result.review",{},"read")&&<CasePdfIntake caseId={id}/>}</>;}
