import type {Metadata} from "next";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "./globals.css";
export const metadata:Metadata={title:{default:"NIPT CBH",template:"%s · NIPT CBH"},description:"ระบบ NIPT CBH — Foundation ข้อมูลจำลอง"};
export const dynamic="force-dynamic";
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="th"><body><a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>{children}</body></html>;
}
