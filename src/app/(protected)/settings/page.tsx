import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {SettingsEditor} from "../../../components/settings-editor";
import {PdfArchiveSettings} from "../../../components/pdf-archive-settings";
export default async function SettingsPage(){const user=(await currentUser())!;if(!authorize(user,"settings.read",{},"read"))redirect("/");return <><header className="page-header"><div><h1>ตั้งค่าระบบ</h1><p className="muted">ร่าง ทดสอบ อนุมัติ และเปิดใช้ตามรุ่น พร้อมประวัติการเปลี่ยนแปลง</p></div></header><PdfArchiveSettings/><SettingsEditor/></>;}
