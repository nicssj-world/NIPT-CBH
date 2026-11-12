import Link from "next/link";
import "./dashboard.css";

/**
 * Administrator home (Owner 2026-11-12): the administrator has system-wide read access, so the home page offers both overviews.
 * Plain links to `/?view=…` (no client state, nothing in the hash, which the Lab tabs below use): the server fetches only the chosen view.
 */
export type HomeView="anc"|"lab";
const VIEWS:{id:HomeView;label:string;href:string}[]=[{id:"anc",label:"ภาพรวม ANC",href:"/"},{id:"lab",label:"ภาพรวม Lab",href:"/?view=lab"}];
export function AdminHomeSwitch({view}:{view:HomeView}){
 return <nav className="home-tabs home-view-switch" aria-label="เลือกภาพรวม">{VIEWS.map(v=><Link key={v.id} href={v.href} replace scroll={false} className="home-tab" aria-current={v.id===view?"page":undefined}>{v.label}</Link>)}</nav>;
}
