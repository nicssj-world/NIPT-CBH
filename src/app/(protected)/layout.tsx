/* eslint-disable @next/next/no-img-element -- static brand assets; next/image injects an inline style attribute that the CSP (style-src nonce) blocks */
import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {authorize} from "../../../packages/security/policy";
import {operationalDataEnabled} from '../../../packages/security/runtime';
import {AppFrame} from "../../components/app-frame";
import {Navigation,LogoutButton} from "../../components/navigation";
import {readActiveSettings} from '../../../packages/settings/service';
import {SETTINGS} from '../../../packages/settings/catalog';
import {pool} from '../../../packages/db/connection';
export default async function ProtectedLayout({children}:{children:React.ReactNode}){
 const user=await currentUser();if(!user)redirect("/login");
 if(user.mustChangePassword)redirect('/password');
 const active=await readActiveSettings(pool());const identity=SETTINGS.general.schema.parse(active.general??SETTINGS.general.default);
 const cases=user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER","ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r));
 const ancHasRole=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r));
 const ancWorkspace=ancHasRole&&user.roles.every(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r));
 const navigationProps={operational:operationalDataEnabled(),canSeeHealth:authorize(user,"health.read",{},"read"),canSeeCases:cases,canSeeSettings:authorize(user,"settings.read",{},"read"),canSeeInbound:authorize(user,"his.scan",{},"read"),canSeeLab:authorize(user,"worksheet.read",{},"read"),canSeePhotos:authorize(user,"photo.read",{},"read"),canSeeResults:authorize(user,"result.review",{},"read"),canSeeHistorical:authorize(user,"history.draft",{},"write")||authorize(user,"history.promote",{},"approve"),canSeeDoctors:user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER","APP_ADMIN","CLINICAL_APPROVER"].includes(r))};
 const profile=(await pool().query<{display_name:string;username:string}>("SELECT display_name,username FROM app_user WHERE id=$1 AND enabled=true",[user.id])).rows[0];
 const userName=profile?.display_name?.trim()||profile?.username||"บัญชีผู้ใช้";
 return <AppFrame ancWorkspace={ancWorkspace} ancUserName={userName} ancNavigation={<Navigation {...navigationProps} mode="anc" showOverview={ancHasRole} className="anc-navigation" label="เมนู ANC"/>} sidebar={<><div className="brand-lockup"><img src="/brand/ui-logo.png" width="48" height="48" alt=""/><div><div className="brand">{identity.systemName}</div><small>PRENATAL DNA CARE</small></div></div><p className="nav-caption">พื้นที่ทำงาน</p><Navigation {...navigationProps}/><div className="session"><p>{user.roles.join(" · ")}</p><a href="/password">เปลี่ยนรหัสผ่านของฉัน</a><LogoutButton/></div></>}><main id="main-content" className="workspace"><div className="scope-banner">{operationalDataEnabled()?<><strong>TRAINING / LOCAL UAT — NOT FOR CLINICAL USE</strong> · ระบบปฏิบัติงาน NIPT · ใช้สิทธิ์และหลักฐานของรอบปัจจุบัน</>:<><strong>ข้อมูลจำลอง — ไม่ใช้ทางคลินิก</strong> · ยังไม่รับข้อมูลผู้ป่วยจริงหรือส่งผลตรวจ</>}</div>{children}</main></AppFrame>;
}
