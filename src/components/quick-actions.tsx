import Link from "next/link";
import {NavigationIcon} from "./navigation";

export type QuickAction={href:string;label:string;hint:string};
/** Role-aware shortcuts on the overview: the same destinations the sidebar already grants, with a one-line purpose each.
 * Links only: no counts, no new data and no extra step in any workflow. */
export function QuickActions({items}:{items:QuickAction[]}){
 if(!items.length)return null;
 return <nav className="quick-actions" aria-label="ทางลัดงานของคุณ"><ul>{items.map(i=><li key={i.href}><Link href={i.href}><NavigationIcon href={i.href}/><span><strong>{i.label}</strong><span className="muted">{i.hint}</span></span></Link></li>)}</ul></nav>;
}
