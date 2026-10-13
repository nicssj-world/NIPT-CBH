import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {authorize} from "../../../packages/security/policy";
import {Navigation,LogoutButton} from "../../components/navigation";
export default async function ProtectedLayout({children}:{children:React.ReactNode}){
 const user=await currentUser();if(!user)redirect("/login");
 const cases=user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER","ANC_NURSE","ANC_SUPERVISOR"].includes(r));
 return <div className="app-shell"><aside className="sidebar"><div><div className="brand">NIPT CBH</div><div>ทะเบียนกลาง · ANC / Lab</div></div><Navigation canSeeCases={cases} canSeeSettings={authorize(user,"settings.read",{},"read")} canSeeInbound={authorize(user,"his.scan",{},"read")} canSeeLab={authorize(user,"worksheet.read",{},"read")} canSeeResults={authorize(user,"result.review",{},"read")} canSeeDoctors={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER","APP_ADMIN","CLINICAL_APPROVER"].includes(r))}/><div className="session"><p>{user.roles.join(" · ")}</p><LogoutButton/></div></aside><main id="main-content" className="workspace"><div className="scope-banner"><strong>ข้อมูลจำลอง — ไม่ใช้ทางคลินิก</strong> · ยังไม่รับข้อมูลผู้ป่วยจริงหรือส่งผลตรวจ</div>{children}</main></div>;
}
