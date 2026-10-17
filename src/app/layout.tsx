import type {Metadata} from "next";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "./globals.css";
export const metadata:Metadata={title:{default:"NIPT CBH",template:"%s · NIPT CBH"},description:"ระบบ NIPT CBH — ข้อมูลจำลองสำหรับ Local UAT",icons:{icon:"/brand/desktop-compact.ico",apple:"/brand/ui-logo.png"}};
export const dynamic="force-dynamic";
export default function RootLayout({children}:{children:React.ReactNode}){
 const localUat=process.env.NIPT_LOCAL_UAT_BANNER==="1";
 return <html lang="th"><body>{localUat&&<div className="local-uat-banner" role="note">TRAINING / LOCAL UAT — NOT FOR CLINICAL USE</div>}<a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>{children}</body></html>;
}
