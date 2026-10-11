import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {LoginForm} from "../../components/login-form";
export default async function LoginPage(){if(await currentUser())redirect("/");return <main id="main-content" className="login-wrap"><div className="login-panel"><div className="login-brand">NIPT CBH</div><h1>เข้าสู่ระบบ</h1><p className="muted">ระบบงาน NIPT สำหรับเจ้าหน้าที่ ANC และห้องปฏิบัติการ</p><div className="scope-banner">P1 Foundation · ใช้ข้อมูลจำลองเท่านั้น</div><LoginForm/><p className="help">ใช้บัญชีส่วนบุคคลที่ผู้ดูแลจัดให้ หากลืมรหัสผ่านให้ติดต่อผู้ดูแลระบบ</p></div></main>;}
