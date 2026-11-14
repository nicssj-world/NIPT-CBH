import {operationalDataEnabled} from "../../../../packages/security/runtime";
import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {Registry} from "../../../components/p2/registry";
import {readFilters} from "../../../components/p2/registry-filters";
/** `?status=…&flag=…&unitId=…&from=…&to=…&sort=…&page=…` open the registry filtered (Dashboard links, Owner 2026-11-14); the search text is never in the URL. */
export default async function CasesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;const user=await currentUser();if(!user)redirect("/login");
 const one=(k:string)=>{const v=query[k];return typeof v==="string"?v:null;};
 return <Registry operational={operationalDataEnabled()} initialFilters={readFilters({get:one})} initialAncRegistration={one("register")==="anc"} showRemovalNotice={one("registration")==="removed"} canVoid={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r))} voidAnyOrigin={user.roles.includes("APP_ADMIN")} canAnc={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r))} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER","APP_ADMIN"].includes(r))}/>;}
