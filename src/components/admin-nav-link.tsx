"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";

/** Settings sub-navigation link that announces the current page (same convention as the main sidebar). */
export function AdminNavLink({href,children}:{href:string;children:React.ReactNode}){
 const path=usePathname();
 return <Link href={href} aria-current={path===href?"page":undefined}>{children}</Link>;
}
