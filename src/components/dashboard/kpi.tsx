import Link from "next/link";
import type {ReactNode} from "react";
import "./dashboard.css";

const n=(v:number|undefined|null)=>v===undefined||v===null?"—":v.toLocaleString("th-TH");
/**
 * A Dashboard KPI that opens its list (Owner 2026-11-14). The label says what is counted and over which period; `value` null or undefined
 * means the source could not be read, so it shows "—" and never a 0. A tone colours the number only when it is above 0, and always beside words.
 */
export function Kpi({label,value,unit="ราย",sub,href,tone}:{label:string;value:number|null|undefined;unit?:string;sub:ReactNode;href:string;tone?:"bad"|"warn"|"good"}){
 const known=value!==null&&value!==undefined;
 return <li className="dash-kpi-cell"><Link href={href} className={"dash-kpi is-link"+(tone&&known&&value>0?" is-"+tone:"")}>
  <span className="k-label">{label}</span><span className={"k-value num"+(known?"":" is-unknown")}>{n(value)}{known&&<small> {unit}</small>}</span><span className="k-sub">{sub}</span></Link></li>;
}
