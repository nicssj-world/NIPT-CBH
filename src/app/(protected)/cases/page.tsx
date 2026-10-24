import {operationalDataEnabled} from "../../../../packages/security/runtime";
import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {Registry} from "../../../components/p2/registry";
export default async function CasesPage({searchParams}:{searchParams:Promise<{register?:string;registration?:string}>}){const query=await searchParams;const user=await currentUser();if(!user)redirect("/login");return <Registry operational={operationalDataEnabled()} initialAncRegistration={query.register==="anc"} showRemovalNotice={query.registration==="removed"} canAnc={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r))} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER","APP_ADMIN"].includes(r))}/>;}
