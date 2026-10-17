import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {Registry} from "../../../components/p2/registry";
export default async function CasesPage({searchParams}:{searchParams:Promise<{register?:string}>}){const query=await searchParams;const user=await currentUser();if(!user)redirect("/login");return <Registry initialAncRegistration={query.register==="anc"} canAnc={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r))} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER"].includes(r))}/>;}
