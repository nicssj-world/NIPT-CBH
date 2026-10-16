import {redirect} from 'next/navigation';
import {currentUser} from '../../server/http';
import {PasswordEditor} from '../../components/password-editor';
export default async function PasswordPage(){const user=await currentUser();if(!user)redirect('/login');return <main className="workspace"><h1>เปลี่ยนรหัสผ่านของฉัน</h1>{user.mustChangePassword&&<p role="alert">กรุณาเปลี่ยนรหัสผ่านก่อนเข้าใช้งานระบบ</p>}<PasswordEditor/></main>;}
