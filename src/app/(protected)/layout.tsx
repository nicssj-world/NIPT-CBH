import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {authorize} from "../../../packages/security/policy";
import {operationalDataEnabled} from '../../../packages/security/runtime';
import {Navigation,LogoutButton} from "../../components/navigation";
import {readActiveSettings} from '../../../packages/settings/service';
import {SETTINGS} from '../../../packages/settings/catalog';
import {pool} from '../../../packages/db/connection';
export default async function ProtectedLayout({children}:{children:React.ReactNode}){
 const user=await currentUser();if(!user)redirect("/login");
 if(user.mustChangePassword)redirect('/password');
 const active=await readActiveSettings(pool());const identity=SETTINGS.general.schema.parse(active.general??SETTINGS.general.default);
 const cases=user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER","ANC_NURSE","ANC_SUPERVISOR"].includes(r));
 return <div className="app-shell"><aside className="sidebar"><div><div className="brand">{identity.systemName}</div><div>ทะเบียนกลาง · ANC / Lab</div></div><Navigation canSeeHealth={authorize(user,"health.read",{},"read")} canSeeCases={cases} canSeeSettings={authorize(user,"settings.read",{},"read")} canSeeInbound={authorize(user,"his.scan",{},"read")} canSeeLab={authorize(user,"worksheet.read",{},"read")} canSeeResults={authorize(user,"result.review",{},"read")} canSeeHistorical={authorize(user,"history.draft",{},"write")||authorize(user,"history.promote",{},"approve")} canSeeDoctors={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER","APP_ADMIN","CLINICAL_APPROVER"].includes(r))}/><div className="session"><p>{user.roles.join(" · ")}</p><a href="/password">เปลี่ยนรหัสผ่านของฉัน</a><LogoutButton/></div></aside><main id="main-content" className="workspace"><div className="scope-banner">{operationalDataEnabled()?<strong>ระบบปฏิบัติงาน NIPT · ใช้สิทธิ์และหลักฐานของรอบปัจจุบัน</strong>:<><strong>ข้อมูลจำลอง — ไม่ใช้ทางคลินิก</strong> · ยังไม่รับข้อมูลผู้ป่วยจริงหรือส่งผลตรวจ</>}</div>{children}</main></div>;
}
